import { pipeline, env } from "@xenova/transformers";

// Skip local model check
env.allowLocalModels = false;

class PipelineSingleton {
  static task = "text2text-generation";
  static instances = new Map();

  static async getInstance(model, progress_callback = null) {
    if (!this.instances.has(model)) {
      this.instances.set(
        model,
        pipeline(this.task, model, { progress_callback })
      );
    }
    return this.instances.get(model);
  }
}

self.addEventListener("message", async (event) => {
  const { messages, model } = event.data;

  let generator = await PipelineSingleton.getInstance(model, (p) => {
    let progress = 0;
    if (p.status === "download" && p.total > 0) {
      progress = (p.loaded / p.total) * 100;
    } else if (p.progress) {
      progress = p.progress;
    }
    self.postMessage({ status: "progress", progress });
  });

  if (messages && messages.length > 0) {
    const prompt = messages
      .map((msg) => {
        if (msg.role === "system") {
          return msg.content; // System messages are direct instructions
        }
        return `${msg.role}: ${msg.content}`;
      })
      .join("\n") + "\nassistant:";

    const stream = await generator(prompt, {
      max_new_tokens: 200,
      temperature: 0.7,
      top_k: 50,
      do_sample: true,
      repetition_penalty: 1.1,
      stream: true,
    });

    for await (const chunk of stream) {
      const token = chunk.generated_text;
      if (token.trim().toLowerCase() === "user:") {
        break;
      }
      self.postMessage({ status: "update", output: token });
    }
    self.postMessage({ status: "complete" });
  } else {
    self.postMessage({ status: "ready" });
  }
});
