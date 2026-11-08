# Bookish

A private chat app that runs small language models entirely in your browser with [Transformers.js](https://huggingface.co/docs/transformers.js) v4. Models download once from Hugging Face, are cached by the browser, and run on WebGPU (or WASM on the CPU when WebGPU isn't available). Nothing you type leaves your device unless you use web or Wikipedia search.

## Models

| Model | Download | Notes |
|-------|----------|-------|
| [LFM2.5 350M](https://huggingface.co/onnx-community/LFM2.5-350M-ONNX) | 255 MB | Default. Fast, good all-rounder |
| [Gemma 3 270M](https://huggingface.co/onnx-community/gemma-3-270m-it-ONNX) | 323 MB | Smallest; simple prompts only |
| [Qwen3.5 0.8B](https://huggingface.co/onnx-community/Qwen3.5-0.8B-Text-ONNX) | 470 MB | Reasoning mode |
| [Qwen3 0.6B](https://huggingface.co/onnx-community/Qwen3-0.6B-ONNX) | 570 MB | Reasoning mode |
| [Gemma 3 1B](https://huggingface.co/onnx-community/gemma-3-1b-it-ONNX) | 859 MB | Better writing quality |
| [LFM3 1.7B](https://huggingface.co/onnx-community/LFM3-1.7B-ONNX) | 1.1 GB | Most capable; reasoning mode |

On WebGPU with `shader-f16`, models use `q4f16` weights. Gemma models always use `q4` because their activations overflow in fp16 and produce garbled text. The list lives in [`src/lib/models.ts`](src/lib/models.ts).

## Features

- Streaming replies with tokens/sec, stop button, and copy
- **Think** toggle for models with a reasoning mode; the trace is shown in a collapsible panel
- **Web** and **Wiki** modes that ground answers in search results, with source links
- Slash commands: `/search`, `/wiki`, `/summarize`, `/weather`, `/calculate`
- Personas, adjustable sampling settings, and chat history saved in `localStorage`
- Markdown, tables, and LaTeX maths rendering; light and dark themes; mobile layout

## Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Inference runs in a web worker ([`src/app/worker.js`](src/app/worker.js)); the API routes under `src/app/api` only proxy web search, Wikipedia and weather lookups.
