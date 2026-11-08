"use client";

import { MODELS, formatSize } from "@/lib/models";
import { BrainIcon, CheckIcon } from "./icons";
import Modal from "./Modal";

interface ModelPickerProps {
  open: boolean;
  onClose: () => void;
  selected: string;
  loadedModel: string | null;
  onSelect: (id: string) => void;
  backend: string | null;
}

export default function ModelPicker({ open, onClose, selected, loadedModel, onSelect, backend }: ModelPickerProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Choose a model"
      description="Models download once, are cached by your browser, and run on your device."
      wide
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {MODELS.map((m) => {
          const isSelected = m.id === selected;
          return (
            <button
              key={m.id}
              onClick={() => onSelect(m.id)}
              className={`relative rounded-xl border p-4 text-left transition-colors ${
                isSelected
                  ? "border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500 dark:bg-indigo-500/10"
                  : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{m.name}</span>
                {isSelected && <CheckIcon size={16} className="ml-auto text-indigo-600 dark:text-indigo-400" />}
              </div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{m.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {m.family}
                </span>
                <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {formatSize(m.sizeMB)}
                </span>
                {m.thinking && (
                  <span className="flex items-center gap-1 rounded-md bg-violet-100 px-1.5 py-0.5 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
                    <BrainIcon size={12} /> Reasoning
                  </span>
                )}
                {loadedModel === m.id && (
                  <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
                    Loaded
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
        {backend
          ? `Running on ${backend}.`
          : "WebGPU is used when available (Chrome, Edge, Safari 26+); otherwise models fall back to WASM on the CPU, which is slower."}
      </p>
    </Modal>
  );
}
