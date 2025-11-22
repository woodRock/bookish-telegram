import { pipeline, env } from "@xenova/transformers";

// Allow local models
env.allowLocalModels = true;

class PipelineSingleton {
  static task = "text2text-generation";
  static instances = new Map();

  static async getInstance(model, progress_callback = null) {
    if (!this.instances.has(model)) {
      let instance;
      instance = await pipeline(this.task, model, { progress_callback });
      this.instances.set(model, instance);
    }
    return this.instances.get(model);
  }
}

self.addEventListener("message", async (event) => {
  const { messages, model, temperature, topP } = event.data;

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
    const truncatedMessages = messages.slice(-10); // Keep the last 10 messages
    const prompt = truncatedMessages
      .map((msg) => {
        if (msg.role === "system") {
          return msg.content; // System messages are direct instructions
        }
        return `${msg.role}: ${msg.content}`;
      })
      .join("\n") + "\nassistant:";

    const stream = await generator(prompt, {
      max_new_tokens: 200,
      temperature: temperature,
      top_p: topP,
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
