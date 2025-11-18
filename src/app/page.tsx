"use client";

import { useState, useEffect, useRef } from "react";

const MODELS = [    
  { name: "Flan-T5-Small", path: "Xenova/flan-t5-small" },
  { name: "Flan-T5-Base", path: "Xenova/flan-t5-base" },
  { name: "LaMini-T5-61M", path: "Xenova/LaMini-T5-61M" },
];

const INITIAL_MESSAGE = {
  role: "assistant",
  content:
    "Hello! I'm a local AI assistant. You can choose a model from the dropdown and start chatting.",
};

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: string; content: string }[]
  >([]);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log("Uploaded file:", file.name);
      alert(
        "Model upload functionality is not implemented yet. But we see your file!"
      );
    }
  };

  const newChat = () => {
    setMessages([INITIAL_MESSAGE]);
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex flex-col md:flex-row items-center justify-between p-4 border-b dark:border-zinc-800 gap-4">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          Chat
        </h1>
        <div className="flex items-center gap-4 flex-wrap justify-center">
          <button
            className="h-10 px-5 flex items-center gap-2 rounded-md bg-blue-600 text-white font-medium transition-colors hover:bg-blue-700"
            onClick={newChat}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span className="hidden sm:inline">New Chat</span>
          </button>
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
          <a
            href="https://huggingface.co/models?library=transformers.js"
            target="_blank"
            rel="noopener noreferrer"
            className="h-10 px-5 flex items-center gap-2 rounded-md bg-blue-600 text-white font-medium transition-colors hover:bg-blue-700"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="hidden sm:inline">Download</span>
          </a>
          <label className="h-10 px-5 flex items-center gap-2 rounded-md bg-blue-600 text-white font-medium transition-colors hover:bg-blue-700 cursor-pointer">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="hidden sm:inline">Upload</span>
            <input
              type="file"
              className="hidden"
              onChange={handleFileChange}
              multiple
            />
          </label>
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
            className="h-10 px-5 flex items-center justify-center rounded-r-md bg-blue-600 text-white font-medium transition-colors hover:bg-blue-700 disabled:bg-gray-400"
            onClick={sendMessage}
            disabled={status !== "Ready"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </footer>
    </div>
  );
}
