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

/** Total size of the ONNX weight files for this dtype, from the Hub API (0 if unavailable). */
async function expectedWeightBytes(id, dtype) {
  try {
    const res = await fetch(`https://huggingface.co/api/models/${id}/tree/main/onnx`);
    if (!res.ok) return 0;
    const prefix = `onnx/model_${dtype}.onnx`; // matches the graph and its _data chunks
    const files = await res.json();
    return files.filter((f) => f.path.startsWith(prefix)).reduce((sum, f) => sum + (f.size ?? 0), 0);
  } catch {
    return 0;
  }
}

/**
 * Aggregate byte progress over every file a load fetches (tokenizer and model).
 * Transformers.js only learns about some files once they start downloading, so its own
 * total can grow mid-load and the percentage jumps backwards. Flooring the total at the
 * expected weight size and never reporting less than before keeps the bar steady, and
 * posting only on whole-percent changes avoids flooding the page with re-renders.
 */
function createProgressTracker(id, expectedBytes) {
  const files = new Map();
  let best = 0;
  let lastSent = -1;
  return (info) => {
    if (info.status !== "progress" || !info.total) return;
    files.set(info.file, { loaded: info.loaded, total: info.total });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    total = Math.max(total, expectedBytes);
    // Hold at 99% until the model is actually ready.
    best = Math.max(best, Math.min(99, (loaded / total) * 100));
    const percent = Math.floor(best);
    if (percent === lastSent) return;
    lastSent = percent;
    self.postMessage({ status: "progress", model: id, progress: percent, loaded, total });
  };
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

  self.postMessage({ status: "loading", model: id, message: "Downloading weights..." });
  const progress_callback = createProgressTracker(id, await expectedWeightBytes(id, dtype));
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
