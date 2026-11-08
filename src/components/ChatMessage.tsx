"use client";

import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { BrainIcon, CheckIcon, ChevronDownIcon, CopyIcon } from "./icons";

export interface Source {
  title: string;
  link: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  /** Set while the assistant reply is still streaming. */
  pending?: boolean;
  /** The reply was generated with thinking enabled. */
  thinking?: boolean;
  error?: boolean;
  tps?: number;
  numTokens?: number;
  sources?: Source[];
  status?: string;
}

/** Split a reply into its reasoning trace and visible answer. */
export function splitThinking(content: string, thinkingEnabled = false) {
  const open = content.indexOf("<think>");
  const close = content.indexOf("</think>");
  if (open !== -1) {
    const start = open + "<think>".length;
    if (close === -1) return { thought: content.slice(start).trim(), answer: "", thinkingDone: false };
    return { thought: content.slice(start, close).trim(), answer: content.slice(close + 8).trim(), thinkingDone: true };
  }
  // Some chat templates open the <think> tag in the prompt, so only the closing tag is generated.
  if (close !== -1) {
    return { thought: content.slice(0, close).trim(), answer: content.slice(close + 8).trim(), thinkingDone: true };
  }
  if (thinkingEnabled) return { thought: content.trim(), answer: "", thinkingDone: false };
  return { thought: "", answer: content, thinkingDone: true };
}

/** Models often write LaTeX with \( \) and \[ \] delimiters; remark-math expects dollars. */
const normalizeMath = (text: string) =>
  text.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`).replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`);

const Thought = ({ text, done }: { text: string; done: boolean }) => {
  const [open, setOpen] = useState(false);
  const expanded = open || !done;
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Follow the reasoning as it streams in.
  useEffect(() => {
    if (!done && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
  }, [text, done]);
  return (
    <div className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-zinc-900/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-zinc-500 dark:text-zinc-400"
      >
        <BrainIcon size={14} className={done ? "" : "animate-pulse text-indigo-500"} />
        {done ? "Thought process" : "Thinking…"}
        <ChevronDownIcon size={14} className={`ml-auto transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && text && (
        <div
          ref={bodyRef}
          className="max-h-64 overflow-y-auto whitespace-pre-wrap border-t border-zinc-200 px-3 py-2 text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
        >
          {text}
        </div>
      )}
    </div>
  );
};

const TypingDots = ({ label }: { label?: string }) => (
  <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
    <span className="typing-dots" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
    {label}
  </div>
);

function ChatMessage({ message }: { message: Message }) {
  const [copied, setCopied] = useState(false);

  if (message.role === "user") {
    return (
      <div className="flex justify-end animate-message-in">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm">
          {message.content}
        </div>
      </div>
    );
  }

  const split = splitThinking(message.content, message.thinking);
  const { thought } = split;
  // A finished reply that never closed its reasoning ran out of tokens mid-thought.
  const truncated = !message.pending && !split.thinkingDone;
  const thinkingDone = split.thinkingDone || !message.pending;
  const answer = truncated
    ? "_Ran out of tokens while thinking. Raise the max reply length in Settings, or turn off Think._"
    : split.answer;
  const showDots = message.pending && !answer && (!thought || thinkingDone);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable on insecure origins.
    }
  };

  return (
    <div className="group animate-message-in">
      {thought && <Thought text={thought} done={thinkingDone} />}
      {showDots ? (
        <TypingDots label={message.status} />
      ) : (
        <div
          className={`markdown text-[15px] leading-relaxed ${
            message.error ? "text-red-600 dark:text-red-400" : "text-zinc-800 dark:text-zinc-200"
          } ${message.pending ? "streaming" : ""}`}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {normalizeMath(answer)}
          </ReactMarkdown>
        </div>
      )}

      {message.sources && message.sources.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {message.sources.map((s, i) => (
            <a
              key={s.link + i}
              href={s.link}
              target="_blank"
              rel="noreferrer"
              className="max-w-[16rem] truncate rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-indigo-700 dark:hover:text-indigo-400"
              title={s.title}
            >
              <span className="mr-1 text-zinc-400">{i + 1}</span>
              {s.title}
            </a>
          ))}
        </div>
      )}

      {!message.pending && answer && !message.error && !truncated && (
        <div className="mt-2 flex h-6 items-center gap-3 text-xs text-zinc-400 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <button
            onClick={copy}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            aria-label="Copy reply"
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
          {message.tps !== undefined && (
            <span className="tabular-nums">
              {message.numTokens} tokens · {message.tps.toFixed(1)} tok/s
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(ChatMessage);
