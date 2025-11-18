"use client";

import { useState, useEffect, useRef } from "react";

const MODELS = [
  { name: "LaMini-T5-61M", path: "Xenova/LaMini-T5-61M" }
];

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: string; content: string }[]
  >([
    {
      role: "assistant",
      content:
        "Hello! I'm a local AI assistant. You can choose a model from the dropdown and start chatting.",
    },
  ]);
  const [status, setStatus] = useState("Not loaded");
  const [progress, setProgress] = useState(0);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].path);

  const worker = useRef<Worker | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
    }

    const onMessageReceived = (e: MessageEvent) => {
      switch (e.data.status) {
        case "initiate":
          setStatus("Loading model...");
          setProgress(0);
          break;
        case "progress":
          setStatus("Loading model...");
          setProgress(e.data.progress);
          break;
        case "done":
          setStatus("Model loaded");
          setProgress(100);
          break;
        case "ready":
          setStatus("Ready");
          break;
        case "update":
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant") {
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + e.data.output },
              ];
            }
            return [...prev, { role: "assistant", content: e.data.output }];
          });
          break;
        case "complete":
          setStatus("Ready");
          break;
        default:
          break;
      }
    };

    worker.current.addEventListener("message", onMessageReceived);

    // Send a message to the worker to start loading the model
    worker.current.postMessage({ model: selectedModel });

    return () =>
      worker.current?.removeEventListener("message", onMessageReceived);
  }, [selectedModel]);

  const sendMessage = () => {
    if (worker.current && input.trim()) {
      setStatus("Generating...");
      const newMessages = [...messages, { role: "user", content: input }];
      setMessages(newMessages);
      worker.current.postMessage({ messages: newMessages, model: selectedModel });
      setInput("");
    }
  };

  const handleModelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedModel(e.target.value);
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex items-center justify-between p-4 border-b dark:border-zinc-800">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Chat
        </h1>
        <div className="flex items-center gap-4">
          <select
            className="h-10 px-3 rounded-md bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white"
            value={selectedModel}
            onChange={handleModelChange}
          >
            {MODELS.map((model) => (
              <option key={model.path} value={model.path}>
                {model.name}
              </option>
            ))}
          </select>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            Model: {status}
            {status === "Loading model..." && ` (${progress.toFixed(2)}%)`}
          </div>
        </div>
      </header>

      <main
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 space-y-4"
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${
              msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            <div
              className={`max-w-lg rounded-lg px-4 py-2 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-zinc-200 dark:bg-zinc-800 text-black dark:text-white"
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
      </main>

      <footer className="p-4 border-t dark:border-zinc-800">
        <div className="flex items-center">
          <input
            type="text"
            className="flex-1 p-2 border rounded-l-md bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white"
            placeholder="Type your message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && sendMessage()}
            disabled={status !== "Ready"}
          />
          <button
            className="h-10 px-5 rounded-r-md bg-blue-600 text-white font-medium transition-colors hover:bg-blue-700 disabled:bg-gray-400"
            onClick={sendMessage}
            disabled={status !== "Ready"}
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}
