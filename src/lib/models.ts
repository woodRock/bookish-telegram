export interface ModelOption {
  id: string;
  name: string;
  family: string;
  params: string;
  /** Approximate download size of the weights used on WebGPU, in MB. */
  sizeMB: number;
  description: string;
  /** Whether the chat template supports `enable_thinking`. */
  thinking: boolean;
  /** Activations overflow in fp16, so use q4 (fp32 activations) even when WebGPU has shader-f16. */
  avoidFp16?: boolean;
}

// All of these are ONNX exports from onnx-community that run with
// @huggingface/transformers v4 on WebGPU (q4f16) or WASM (q4).
export const MODELS: ModelOption[] = [
  {
    id: "onnx-community/LFM2.5-350M-ONNX",
    name: "LFM2.5 350M",
    family: "Liquid AI",
    params: "350M",
    sizeMB: 255,
    description: "Hybrid edge model. Small download, fast replies, good default.",
    thinking: false,
  },
  {
    id: "onnx-community/gemma-3-270m-it-ONNX",
    name: "Gemma 3 270M",
    family: "Google",
    params: "270M",
    sizeMB: 323,
    description: "Tiny and quick to load. Best for short, simple prompts.",
    thinking: false,
    avoidFp16: true,
  },
  {
    id: "onnx-community/Qwen3.5-0.8B-Text-ONNX",
    name: "Qwen3.5 0.8B",
    family: "Qwen",
    params: "0.8B",
    sizeMB: 470,
    description: "Latest small Qwen. Strong for its size, optional reasoning.",
    thinking: true,
  },
  {
    id: "onnx-community/Qwen3-0.6B-ONNX",
    name: "Qwen3 0.6B",
    family: "Qwen",
    params: "0.6B",
    sizeMB: 570,
    description: "Compact Qwen3 with switchable thinking mode.",
    thinking: true,
  },
  {
    id: "onnx-community/gemma-3-1b-it-ONNX",
    name: "Gemma 3 1B",
    family: "Google",
    params: "1B",
    sizeMB: 859,
    description: "Larger Gemma for better writing quality.",
    thinking: false,
    avoidFp16: true,
  },
  {
    id: "onnx-community/LFM3-1.7B-ONNX",
    name: "LFM3 1.7B",
    family: "Liquid AI",
    params: "1.7B",
    sizeMB: 1088,
    description: "Most capable option. Needs WebGPU to be comfortable.",
    thinking: true,
  },
];

export const DEFAULT_MODEL = MODELS[0].id;

export const getModel = (id: string) => MODELS.find((m) => m.id === id) ?? MODELS[0];

export const formatSize = (mb: number) =>
  mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`;
