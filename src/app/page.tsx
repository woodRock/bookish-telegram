"use client";

import { useState, useEffect, useRef } from "react";

const MODELS = [
  { name: "Flan-T5-Small", path: "Xenova/flan-t5-small" },
  { name: "Flan-T5-Base", path: "Xenova/flan-t5-base" },
  { name: "LaMini-Flan-T5-783M", path: "Xenova/LaMini-Flan-T5-783M" },
  { name: "Flan-Alpaca-Large", path: "Xenova/flan-alpaca-large" },
  { name: "LaMini-T5-61M", path: "Xenova/LaMini-T5-61M" },
];

const SYSTEM_PROMPT = {
  role: "system",
  content: `You are a helpful and friendly AI assistant, designed to run locally in the user's browser. Your goal is to provide accurate, concise, and relevant answers.

**Instructions:**
- Be conversational and approachable.
- If you don't know the answer or a question is beyond your capabilities, be honest and say so.
- Do not make up information. Your knowledge is based on the model you are running.
- Keep your answers concise and to the point, unless the user asks for more detail.
- You can perform web searches if the user enables "Search Mode". Use the provided search results to answer the question.`
};

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
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [isDeepThinkMode, setIsDeepThinkMode] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    { id: string; name: string; messages: { role: string; content: string }[]; timestamp: number }[]
  >([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);

  const worker = useRef<Worker | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
    // Update chat history whenever messages change for the current chat
    if (currentChatId) {
      setChatHistory((prev) =>
        prev.map((chat) =>
          chat.id === currentChatId ? { ...chat, messages: messages, timestamp: Date.now() } : chat
        ).sort((a, b) => b.timestamp - a.timestamp) // Ensure sorting after update
      );
    }
  }, [messages, currentChatId]);

  // Effect to summarize new chats
  useEffect(() => {
    if (currentChatId) {
      const currentChat = chatHistory.find(chat => chat.id === currentChatId);
      // Check if it's a new chat and has at least one user message
      if (currentChat && currentChat.name === "New Chat" && currentChat.messages.length > 1) {
        const firstUserMessage = currentChat.messages.find(msg => msg.role === "user")?.content;
        if (firstUserMessage) {
          fetch("/api/summarize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: firstUserMessage }),
          })
            .then(res => res.json())
            .then(data => {
              if (data.summary) {
                setChatHistory(prev => prev.map(chat =>
                  chat.id === currentChatId ? { ...chat, name: data.summary } : chat
                ));
              } else {
                console.error("Failed to get summary:", data.error);
              }
            })
            .catch(error => console.error("Error summarizing chat:", error));
        }
      }
    }
  }, [currentChatId, chatHistory]);

  useEffect(() => {
    if (!currentChatId) {
      newChat(); // Create a new chat on initial load
    }
  }, [currentChatId]);

  useEffect(() => {
    if (!worker.current) {
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
    }

    const onMessageReceived = async (e: MessageEvent) => {
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
  }, [selectedModel, currentChatId]);

  const sendMessage = async () => {
    if (!input.trim() || !currentChatId) return;

    const userMessage = { role: "user", content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");

    // Update chat history with the new user message
    setChatHistory((prev) =>
      prev.map((chat) =>
        chat.id === currentChatId ? { ...chat, messages: newMessages } : chat
      )
    );

    const isExplicitSearch = input.startsWith("/search ");
    const isImplicitSearch = isSearchMode && !isExplicitSearch;

    let workerMessages = newMessages.filter(msg => msg.role !== 'system');
    let systemPrompt = SYSTEM_PROMPT;

    if (isExplicitSearch || isImplicitSearch) {
      setIsSearching(true);
      setStatus("Searching...");
      const query = isExplicitSearch
        ? input.substring("/search ".length).trim()
        : input.trim();

      try {
        const response = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const { searchResults, pageContent, firstResultLink } = await response.json();
        const formattedResults = searchResults
          .map((result: any, i: number) => `Result ${i + 1}:\nTitle: ${result.title}\nLink: ${result.link}\nSnippet: ${result.snippet}`)
          .join("\n\n");

        let searchPromptContent = `You are an AI assistant. Your task is to answer the user's question based *only* on the provided search results and page content.\n\nUser's Question: "${query}"\n\nSearch Results:\n${formattedResults}`;
        if (pageContent) {
          searchPromptContent += `\n\nContent from First Linked Page (${firstResultLink}):\n${pageContent}`;
        }
        searchPromptContent += "\n\nAnswer the user's question based on the above information.";
        
        systemPrompt = { role: "system", content: searchPromptContent };

      } catch (error) {
        console.error("Search failed:", error);
        const errorMessage = { role: "assistant", content: "Sorry, I couldn't perform the search." };
        setMessages((prev) => [...prev, errorMessage]);
        return; // Stop further processing
      } finally {
        setIsSearching(false);
      }
    } else if (isDeepThinkMode) {
      const deepThinkPrompt = `You are an AI assistant. Think step-by-step to answer the user's request. First, outline your thought process, then provide the final answer.\n\nThought Process:\n1. Analyze the user's request.\n2. Break down the request into smaller, manageable parts.\n3. Consider potential approaches and relevant information.\n4. Formulate a step-by-step plan to address the request.\n\nFinal Answer:`;
      systemPrompt = { role: "system", content: deepThinkPrompt };
    }

    if (worker.current) {
      setStatus("Generating...");
      worker.current.postMessage({ messages: [systemPrompt, ...workerMessages], model: selectedModel });
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
    const newId = crypto.randomUUID();
    const newChatEntry = {
      id: newId,
      name: "New Chat", // Temporary name, will be summarized by LLM
      messages: [SYSTEM_PROMPT, INITIAL_MESSAGE],
      timestamp: Date.now(),
    };
    setChatHistory((prev) => [newChatEntry, ...prev]); // Add new chat to top
    setCurrentChatId(newId);
    setMessages([SYSTEM_PROMPT, INITIAL_MESSAGE]);
  };

  const loadChat = (id: string) => {
    console.log("Loading chat:", id);
    const chat = chatHistory.find((c) => c.id === id);
    if (chat) {
      setCurrentChatId(id);
      setMessages(chat.messages);
    }
  };

  const deleteChat = (id: string) => {
    console.log("Deleting chat:", id);
    setChatHistory((prev) => {
      const updatedHistory = prev.filter((chat) => chat.id !== id);
      console.log("Updated chat history after delete:", updatedHistory);
      return updatedHistory;
    });
    if (currentChatId === id) {
      newChat(); // If the deleted chat was active, start a new one
    }
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex flex-col md:flex-row items-center justify-between p-4 border-b dark:border-zinc-800 gap-4">
        <div className="flex items-center gap-4">
          <button
            className="h-10 w-10 flex items-center justify-center rounded-md bg-blue-600 text-white font-medium transition-colors hover:bg-blue-700"
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            title="Toggle Chat History"
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
              <path d="M19 4v16H5V4h14zm-1 2H6v12h12V6z" />
              <path d="M9 1h6" />
              <path d="M12 17v-6" />
              <path d="M15 14l-3-3-3 3" />
            </svg>
          </button>
          <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
            Chat
          </h1>
        </div>
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

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div
          className={`flex-shrink-0 w-64 bg-zinc-100 dark:bg-zinc-900 border-r dark:border-zinc-800 transition-all duration-300 ease-in-out ${
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4 text-black dark:text-zinc-50">
              Chat History
            </h2>
            <ul className="space-y-2">
              {chatHistory
                .sort((a, b) => b.timestamp - a.timestamp)
                .map((chat) => (
                  <li key={chat.id} className="flex items-center justify-between group">
                    <button
                      className={`flex-1 text-left p-2 rounded-l-md ${
                        chat.id === currentChatId
                          ? "bg-blue-600 text-white"
                          : "bg-zinc-200 dark:bg-zinc-800 text-black dark:text-white hover:bg-zinc-300 dark:hover:bg-zinc-700"
                      }`}
                      onClick={() => loadChat(chat.id)}
                    >
                      {chat.name}
                    </button>
                    <button
                      className="p-2 rounded-r-md bg-red-500 text-white transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation(); // Prevent triggering loadChat
                        deleteChat(chat.id);
                      }}
                      title="Delete Chat"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 6h18" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                        <line x1="10" y1="11" x2="10" y2="17" />
                        <line x1="14" y1="11" x2="14" y2="17" />
                      </svg>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        </div>

        {/* Main Chat Area */}
        <main
          ref={chatContainerRef}
          className="flex-1 overflow-y-auto p-4 space-y-4"
        >
          {messages.filter(msg => msg.role !== 'system').map((msg, i) => (
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
      </div>

      <footer className="p-4 border-t dark:border-zinc-800">
        <div className="flex items-center rounded-md overflow-hidden">
          <input
            type="text"
            className="flex-1 p-2 border-none bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white focus:outline-none"
            placeholder={
              isSearchMode ? "Type your search query..." : "Type your message..."
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && sendMessage()}
            disabled={status !== "Ready" || isSearching}
          />
          <button
            className={`h-10 px-5 flex items-center justify-center ${
              isSearchMode ? "bg-green-600" : "bg-gray-400"
            } text-white font-medium transition-colors ${
              isSearchMode ? "hover:bg-green-700" : "hover:bg-gray-500"
            }`}
            onClick={() => setIsSearchMode(!isSearchMode)}
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
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="hidden sm:inline">Search</span>
          </button>
          <button
            className={`h-10 px-5 flex items-center justify-center ${
              isDeepThinkMode ? "bg-purple-600" : "bg-gray-400"
            } text-white font-medium transition-colors ${
              isDeepThinkMode ? "hover:bg-purple-700" : "hover:bg-gray-500"
            }`}
            onClick={() => setIsDeepThinkMode(!isDeepThinkMode)}
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
              <path d="M12 20h9" />
              <path d="M16.5 17.5L12 13 7.5 17.5" />
              <path d="M7.5 6.5L12 11 16.5 6.5" />
              <path d="M12 3v10" />
            </svg>
            <span className="hidden sm:inline">Deep Think</span>
          </button>
          <button
            className="h-10 px-5 flex items-center justify-center bg-blue-600 text-white font-medium transition-colors hover:bg-blue-700 disabled:bg-gray-400"
            onClick={sendMessage}
            disabled={status !== "Ready" || isSearching}
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
