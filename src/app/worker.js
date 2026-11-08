import {
  AutoTokenizer,
  AutoModelForCausalLM,
  TextStreamer,
  InterruptableStoppingCriteria,
} from "@huggingface/transformers";

const stopping_criteria = new InterruptableStoppingCriteria();

let current = null; // { id, tokenizer, model, device, dtype }
let loading = null; // Promise for the model currently being loaded

async function detectBackend() {
  if (typeof navigator !== "undefined" && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        // q4f16 needs fp16 shaders; fall back to q4 otherwise.
        const dtype = adapter.features.has("shader-f16") ? "q4f16" : "q4";
        return { device: "webgpu", dtype };
      }
    } catch {
      // Fall through to WASM.
    }
  }
  return { device: "wasm", dtype: "q4" };
}

async function load(id, avoidFp16 = false) {
  if (current?.id === id) {
    self.postMessage({ status: "ready", model: id, device: current.device, dtype: current.dtype });
    return;
  }

  if (current) {
    await current.model.dispose?.();
    current = null;
  }

  self.postMessage({ status: "loading", model: id, message: "Checking hardware..." });
  const backend = await detectBackend();
  const device = backend.device;
  const dtype = avoidFp16 ? "q4" : backend.dtype;

  const progress_callback = (info) => {
    if (info.status === "progress_total") {
      self.postMessage({
        status: "progress",
        model: id,
        progress: info.progress,
        loaded: info.loaded,
        total: info.total,
      });
    }
  };

  self.postMessage({ status: "loading", model: id, message: "Downloading weights..." });
  const tokenizer = await AutoTokenizer.from_pretrained(id, { progress_callback });
  const model = await AutoModelForCausalLM.from_pretrained(id, {
    dtype,
    device,
    progress_callback,
  });

  // Run one token through the model so WebGPU shaders compile before the first real message.
  self.postMessage({ status: "loading", model: id, message: "Warming up..." });
  const inputs = tokenizer("a");
  await model.generate({ ...inputs, max_new_tokens: 1 });

  current = { id, tokenizer, model, device, dtype };
  self.postMessage({ status: "ready", model: id, device, dtype });
}

async function generate({ messages, temperature, top_p, max_new_tokens, enable_thinking }) {
  const { tokenizer, model } = current;

  const inputs = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    return_dict: true,
    enable_thinking,
  });

  let startTime;
  let numTokens = 0;
  const token_callback_function = () => {
    startTime ??= performance.now();
    numTokens++;
  };
  const callback_function = (output) => {
    const elapsed = (performance.now() - startTime) / 1000;
    self.postMessage({
      status: "update",
      output,
      numTokens,
      tps: numTokens > 1 && elapsed > 0 ? numTokens / elapsed : undefined,
    });
  };

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function,
    token_callback_function,
  });

  stopping_criteria.reset();
  self.postMessage({ status: "start" });

  await model.generate({
    ...inputs,
    max_new_tokens,
    do_sample: temperature > 0,
    temperature: temperature > 0 ? temperature : undefined,
    top_p,
    repetition_penalty: 1.05,
    streamer,
    stopping_criteria,
  });

  self.postMessage({ status: "complete" });
}

self.addEventListener("message", async (event) => {
  const { type, data } = event.data;
  try {
    switch (type) {
      case "load":
        loading = load(data.model, data.avoidFp16);
        await loading;
        break;
      case "generate":
        if (loading) await loading;
        if (!current) throw new Error("No model is loaded yet.");
        await generate(data);
        break;
      case "interrupt":
        stopping_criteria.interrupt();
        break;
    }
  } catch (error) {
    console.error(error);
    let message = error?.message ?? String(error);
    if (/network error|failed to fetch|quota/i.test(message)) {
      message = `The model download failed (${message}). Check your connection and free browser storage, then retry.`;
    }
    self.postMessage({ status: "error", message });
  }
});
