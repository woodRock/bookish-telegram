"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { evaluate } from "mathjs";
import { superheroPrompts } from "@/lib/superheroPrompts";


const ChatMessage = ({ message }: { message: { role: string; content: string } }) => {
  const { role, content } = message;
  const isUser = role === "user";

  return (
    <div
      className={`flex ${
        isUser ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`max-w-lg md:max-w-2xl rounded-lg px-4 py-2 ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-zinc-200 dark:bg-zinc-800 text-black dark:text-white"
        }`}
      >
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    </div>
  );
};

const INITIAL_MODELS = [
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
- You can perform web searches if the user enables "Search Mode".

**Available Tools:**
- **/search <query>:** Searches the web for information.
- **/summarize <text>:** Summarizes the provided text.
- **/weather <location>:** Gets the current weather for a location.
- **/wiki <query>:** Searches Wikipedia for information.
- **/calculate <expression>:** Calculates a mathematical expression.`
};

const INITIAL_MESSAGE = {
  role: "assistant",
  content:
    "Hello! I'm a local AI assistant. You can choose a model from the dropdown and start chatting.",
};

const COMMANDS = ["/search", "/summarize", "/weather", "/wiki", "/calculate"];


interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

interface ModelConfig {
  architectures?: string[];
  [key: string]: unknown; // Add index signature
}

export default function Home() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<
    { role: string; content: string }[]
  >([]);
  const [status, setStatus] = useState("Not loaded");
  const [progress, setProgress] = useState(0);
  const [models, setModels] = useState(INITIAL_MODELS);
  
  const [selectedModel, setSelectedModel] = useState(INITIAL_MODELS[0].path);
  const [isModelInfoModalOpen, setIsModelInfoModalOpen] = useState(false);
  const [modelInfo, setModelInfo] = useState<Record<string, unknown> | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [isDeepThinkMode, setIsDeepThinkMode] = useState(false);
  const [isWiki, setIsWiki] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCharacterModalOpen, setIsCharacterModalOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<
    { id: string; name: string; messages: { role: string; content: string }[]; timestamp: number }[]
  >([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatHistorySearch, setChatHistorySearch] = useState("");
  const [temperature, setTemperature] = useState(0.5);
  const [topP, setTopP] = useState(0.5);
  const [systemPrompt, setSystemPrompt] = useState(SYSTEM_PROMPT.content);
  const [selectedSuperheroKey, setSelectedSuperheroKey] = useState<string | null>(null);

  const handleCharacterSelect = (key: string) => {
    const character = superheroPrompts[key];
    if (character) {
      setSystemPrompt(character.prompt);
      setSelectedSuperheroKey(key);
      setIsCharacterModalOpen(false);
    }
  };

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
          fetch("/api/summarize-title", {
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

  const newChat = useCallback(() => {
    const newId = crypto.randomUUID();
    const newChatEntry = {
      id: newId,
      name: "New Chat", // Temporary name, will be summarized by LLM
      messages: [{ role: "system", content: systemPrompt }, INITIAL_MESSAGE],
      timestamp: Date.now(),
    };
    setChatHistory((prev) => [newChatEntry, ...prev]); // Add new chat to top
    setCurrentChatId(newId);
    setMessages([{ role: "system", content: systemPrompt }, INITIAL_MESSAGE]);
  }, [systemPrompt]);

  useEffect(() => {
    const isMobile = window.innerWidth < 768;
    if (isMobile) {
      setIsSidebarOpen(false);
    }
    if (!currentChatId) {
      newChat(); // Create a new chat on initial load
    }
  }, [currentChatId, newChat]);

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
          setIsGenerating(false);
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

  

  

  const showModelInfo = async () => {
    setStatus("Fetching model info...");
    try {
      let configData: ModelConfig;
      if (selectedModel.startsWith('local_models/')) {
        const configUrl = `/api/local-model-file?modelPath=${selectedModel}&fileName=config.json`;
        const configRes = await fetch(configUrl);
        if (!configRes.ok) throw new Error(`Failed to fetch config.json for ${selectedModel} from local server`);
        configData = await configRes.json();
      } else {
        // Fetch config.json from Hugging Face
        const configUrl = `https://huggingface.co/${selectedModel}/raw/main/config.json`;
        const configRes = await fetch(configUrl);
        if (!configRes.ok) throw new Error(`Failed to fetch config.json for ${selectedModel}`);
        configData = await configRes.json();
      }

      setModelInfo(configData);
      setIsModelInfoModalOpen(true);

    } catch (error: unknown) {
      console.error("Error fetching model info:", error);
      alert(`Could not fetch model information. ${(error as Error).message}`);
    } finally {
      setStatus("Ready");
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || !currentChatId) return;

    const userMessage = { role: "user", content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput("");
    setIsGenerating(true);

    // Update chat history with the new user message
    setChatHistory((prev) =>
      prev.map((chat) =>
        chat.id === currentChatId ? { ...chat, messages: newMessages } : chat
      )
    );

    const isExplicitSearch = input.startsWith("/search ");
    const isImplicitSearch = isSearchMode && !isExplicitSearch;
    const isSummarize = input.startsWith("/summarize ");
    const isWeather = input.startsWith("/weather ");
    const isWikiExplicit = input.startsWith("/wiki ");
    const isWikiImplicit = isWiki && !isWikiExplicit;
    const isCalculate = input.startsWith("/calculate ");

    const workerMessages = newMessages.filter(msg => msg.role !== 'system');

    if (isCalculate) {
      const expression = input.substring("/calculate ".length).trim();
      if (!expression) {
        const errorMessage = { role: "assistant", content: "Please provide a mathematical expression to calculate." };
        setMessages((prev) => [...prev, errorMessage]);
        setIsGenerating(false);
        return;
      }

      try {
        const result = evaluate(expression);
        const resultMessage = { role: "assistant", content: `The result is: ${result}` };
        setMessages((prev) => [...prev, resultMessage]);
      } catch (error) {
        console.error("Calculation failed:", error);
        const errorMessage = { role: "assistant", content: "Sorry, I couldn't calculate that. Please enter a valid mathematical expression." };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setStatus("Ready");
        setIsGenerating(false);
      }
      return;
    }

    if (isSummarize) {
      const textToSummarize = input.substring("/summarize ".length).trim();
      if (!textToSummarize) {
        const errorMessage = { role: "assistant", content: "Please provide text to summarize." };
        setMessages((prev) => [...prev, errorMessage]);
        setIsGenerating(false);
        return;
      }

      setStatus("Summarizing...");
      try {
        const response = await fetch("/api/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: textToSummarize }),
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const { summary } = await response.json();
        const summaryMessage = { role: "assistant", content: `Summary:\n${summary}` };
        setMessages((prev) => [...prev, summaryMessage]);
      } catch (error) {
        console.error("Summarization failed:", error);
        const errorMessage = { role: "assistant", content: "Sorry, I couldn't summarize the text." };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setStatus("Ready");
        setIsGenerating(false);
      }
      return; // Stop further processing
    }

    if (isWeather) {
      const location = input.substring("/weather ".length).trim();
      if (!location) {
        const errorMessage = { role: "assistant", content: "Please provide a location for the weather." };
        setMessages((prev) => [...prev, errorMessage]);
        setIsGenerating(false);
        return;
      }

      setStatus("Fetching weather...");
      try {
        const response = await fetch("/api/weather", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const { weatherReport } = await response.json();
        const weatherMessage = { role: "assistant", content: weatherReport };
        setMessages((prev) => [...prev, weatherMessage]);
      } catch (error: any) {
        console.error("Weather fetch failed:", error);
        const errorMessage = { role: "assistant", content: `Sorry, I couldn't get the weather. ${error.message}` };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setStatus("Ready");
        setIsGenerating(false);
      }
      return; // Stop further processing
    }

    let systemPromptMessage = { role: "system", content: systemPrompt };

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
          .map((result: SearchResult, i: number) => `Result ${i + 1}:\nTitle: ${result.title}\nLink: ${result.link}\nSnippet: ${result.snippet}`)
          .join("\n\n");

        let searchPromptContent = `You are an AI assistant. Your task is to answer the user's question based *only* on the provided search results and page content.\n\nUser's Question: \"${query}\"\n\nSearch Results:\n${formattedResults}`;
        if (pageContent) {
          searchPromptContent += `\n\nContent from First Linked Page (${firstResultLink}):\n${pageContent}`;
        }
        searchPromptContent += "\n\nAnswer the user's question based on the above information.";
        
        systemPromptMessage = { role: "system", content: searchPromptContent };

      } catch (error: unknown) {
        console.error("Search failed:", error);
        const errorMessage = { role: "assistant", content: `Sorry, I couldn't perform the search. ${(error as Error).message}` };
        setMessages((prev) => [...prev, errorMessage]);
        setIsGenerating(false);
        return; // Stop further processing
      } finally {
        setIsSearching(false);
      }
    } else if (isWikiExplicit || isWikiImplicit) {
      setIsSearching(true); // Use the same searching state
      setStatus("Searching Wikipedia...");
      const query = isWikiExplicit
        ? input.substring("/wiki ".length).trim()
        : input.trim();

      try {
        const response = await fetch("/api/wikipedia-rag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const { content } = await response.json();
        
        const wikiPromptContent = `You are an AI assistant. Your task is to answer the user's question based *only* on the provided Wikipedia article content.\n\nUser's Question: \"${query}\"\n\nWikipedia Content:\n${content}\n\nAnswer the user's question based on the above information.`;
        
        systemPromptMessage = { role: "system", content: wikiPromptContent };

      } catch (error: unknown) {
        console.error("Wikipedia RAG failed:", error);
        const errorMessage = { role: "assistant", content: `Sorry, I couldn't fetch information from Wikipedia. ${(error as Error).message}` };
        setMessages((prev) => [...prev, errorMessage]);
        setIsGenerating(false);
        return; // Stop further processing
      } finally {
        setIsSearching(false);
      }
    } else if (isDeepThinkMode) {
      const deepThinkPrompt = `You are an AI assistant. Think step-by-step to answer the user's request. First, outline your thought process, then provide the final answer.\n\nThought Process:\n1. Analyze the user's request.\n2. Break down the request into smaller, manageable parts.\n3. Consider potential approaches and relevant information.\n4. Formulate a step-by-step plan to address the request.\n\nFinal Answer:`;
      systemPromptMessage = { role: "system", content: deepThinkPrompt };
    }

    if (worker.current) {
      setStatus("Generating...");
      worker.current.postMessage({
        messages: [systemPromptMessage, ...workerMessages],
        model: selectedModel,
        temperature,
        topP,
      });
    }
  };

  

  

  const stopGeneration = () => {
    if (worker.current) {
      worker.current.terminate();
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      worker.current.postMessage({ model: selectedModel });
      setStatus("Ready");
      setIsGenerating(false);
    }
  };

  const handleModelChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModelPath = e.target.value;
    setSelectedModel(newModelPath);
    setStatus("Validating model...");
    try {
      let configData: ModelConfig;
      if (newModelPath.startsWith('local_models/')) {
        const configUrl = `/api/local-model-file?modelPath=${newModelPath}&fileName=config.json`;
        const configRes = await fetch(configUrl);
        if (!configRes.ok) throw new Error(`Failed to fetch config.json for ${newModelPath} from local server`);
        configData = await configRes.json();
      } else {
        const configUrl = `https://huggingface.co/${newModelPath}/raw/main/config.json`;
        const configRes = await fetch(configUrl);
        if (!configRes.ok) throw new Error(`Failed to fetch config.json for ${newModelPath}`);
        configData = await configRes.json();
      }

      // Check if the model is a text2text generation model.
      // A simple heuristic: check for "ConditionalGeneration" in architectures.
      const isText2Text = configData.architectures && (configData.architectures as string[]).some((arch: string) => arch.endsWith("ForConditionalGeneration"));

      if (!isText2Text) {
        alert("Warning: This model is not a text-to-text generation model and may not work as expected.");
      }

    } catch (error: unknown) {
      console.error("Error validating model:", error);
      alert(`Could not validate the selected model. It might be incompatible. ${(error as Error).message}`);
    } finally {
      // setStatus will be updated by the worker's loading progress
    }
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

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);

    if (value.startsWith('/')) {
      const query = value.substring(1).toLowerCase();
      const filteredSuggestions = COMMANDS.filter(command =>
        command.substring(1).toLowerCase().startsWith(query)
      );
      setSuggestions(filteredSuggestions);
      setActiveSuggestion(0);
    } else {
      setSuggestions([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveSuggestion(prev => (prev + 1) % suggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveSuggestion(prev => (prev - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        if (suggestions[activeSuggestion]) {
          e.preventDefault();
          setInput(suggestions[activeSuggestion] + ' ');
          setSuggestions([]);
        }
      } else if (e.key === 'Escape') {
        setSuggestions([]);
      }
    } else if (e.key === 'Enter') {
      sendMessage();
    }
  };

  const filteredChatHistory = chatHistory.filter(chat =>
    chat.name.toLowerCase().includes(chatHistorySearch.toLowerCase())
  );

  return (
    <div className="flex h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      <header className="flex flex-col md:flex-row items-center justify-between p-4 border-b dark:border-zinc-800 gap-4">
        <div className="flex items-center gap-4">
          <button
            className="h-10 w-10 flex items-center justify-center rounded-md bg-blue-600 text-white font-medium transition-colors hover:bg-blue-700 md:hidden"
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
          <button
            className="h-10 w-10 flex items-center justify-center rounded-md bg-gray-200 dark:bg-gray-700"
            onClick={() => setIsCharacterModalOpen(true)}
            title="Select Character"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-user-round">
              <circle cx="12" cy="8" r="5" />
              <path d="M20 21a8 8 0 0 0-16 0" />
            </svg>
          </button>
          <button
            className="h-10 w-10 flex items-center justify-center rounded-md bg-gray-200 dark:bg-gray-700"
            onClick={() => setIsSettingsModalOpen(true)}
            title="Settings"
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
              <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 0 2l-.15.08a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1 0-2l.15-.08a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div
          className={`flex-shrink-0 w-64 bg-zinc-100 dark:bg-zinc-900 border-r dark:border-zinc-800 transition-all duration-300 ease-in-out ${
            isSidebarOpen ? "translate-x-0" : "-translate-x-full"
          } md:relative md:translate-x-0`}
        >
          <div className="p-4">
            <h2 className="text-lg font-semibold mb-4 text-black dark:text-zinc-50">
              Chat History
            </h2>
            <input
              type="text"
              placeholder="Search history..."
              className="w-full p-2 mb-4 border rounded-md bg-zinc-200 dark:bg-zinc-800 text-black dark:text-white"
              value={chatHistorySearch}
              onChange={(e) => setChatHistorySearch(e.target.value)}
            />
            <ul className="space-y-2">
              {filteredChatHistory
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
          className={`flex-1 overflow-y-auto p-4 space-y-4 transition-all duration-300 ease-in-out md:ml-0`}
        >
          {messages.filter(msg => msg.role !== 'system').map((msg, i) => (
            <ChatMessage key={i} message={msg} />
          ))}
          {isGenerating && (
            <div className="flex justify-start">
              <div className="max-w-lg rounded-lg px-4 py-2 bg-zinc-200 dark:bg-zinc-800 text-black dark:text-white flex items-center">
                <div className="dots-container mr-4">
                  <div className="dot-flashing"></div>
                </div>
                <div>
                  {status}
                  {status === "Loading model..." && ` (${progress.toFixed(2)}%)`}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      <footer className="p-4 border-t dark:border-zinc-800 relative">
        {suggestions.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 bg-white dark:bg-zinc-700 border dark:border-zinc-600 rounded-md shadow-lg mb-2">
            <ul>
              {suggestions.map((suggestion, index) => (
                <li
                  key={suggestion}
                  className={`p-2 cursor-pointer ${
                    index === activeSuggestion
                      ? 'bg-blue-500 text-white'
                      : 'hover:bg-zinc-200 dark:hover:bg-zinc-600'
                  }`}
                  onClick={() => {
                    setInput(suggestion + ' ');
                    setSuggestions([]);
                  }}
                >
                  {suggestion}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex items-center rounded-md overflow-hidden">
          <input
            type="text"
            className="flex-1 p-2 border-none bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white focus:outline-none"
            placeholder={
              isSearchMode
                ? "Type your search query..."
                : isWiki
                ? "Type your Wikipedia query..."
                : "Type your message..."
            }
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={status !== "Ready" || isSearching}
          />
          {isGenerating ? (
            <button
              className="h-10 px-5 flex items-center justify-center bg-red-600 text-white font-medium transition-colors hover:bg-red-700"
              onClick={stopGeneration}
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
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              </svg>
            </button>
          ) : (
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
          )}
        </div>
      </footer>

      {isModelInfoModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-800 p-6 rounded-lg max-w-2xl w-full mx-4">
            <h2 className="text-2xl font-bold mb-4 text-black dark:text-white">
              Model Information: {selectedModel}
            </h2>
            <div className="max-h-96 overflow-y-auto bg-zinc-100 dark:bg-zinc-900 p-4 rounded-md">
              <pre className="text-sm text-black dark:text-white">
                {JSON.stringify(modelInfo, null, 2)}
              </pre>
            </div>
            <button
              className="mt-6 h-10 px-5 rounded-md bg-blue-600 text-white font-medium transition-colors hover:bg-blue-700"
              onClick={() => setIsModelInfoModalOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {isSettingsModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-800 p-6 rounded-lg max-w-2xl w-full mx-4">
            <h2 className="text-2xl font-bold mb-4 text-black dark:text-white">
              Settings
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Select Model</label>
                <select
                  className="h-10 px-3 w-full rounded-md bg-zinc-100 dark:bg-zinc-800 text-black dark:text-white"
                  value={selectedModel}
                  onChange={handleModelChange}
                >
                  {models.map((model) => (
                    <option key={model.path} value={model.path}>
                      {model.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-4">
                <button
                  className="h-10 px-3 rounded-md bg-gray-200 dark:bg-gray-700"
                  onClick={showModelInfo}
                  title="Show model information"
                >
                  Info
                </button>
              </div>
              <div className="flex items-center gap-4">
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
                  <span className="hidden sm:inline">Search Mode</span>
                </button>
                <button
                  className={`h-10 px-5 flex items-center justify-center ${
                    isWiki ? "bg-blue-600" : "bg-gray-400"
                  } text-white font-medium transition-colors ${
                    isWiki ? "hover:bg-blue-700" : "hover:bg-gray-500"
                  }`}
                  onClick={() => setIsWiki(!isWiki)}
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
                  <span className="hidden sm:inline">Wiki Mode</span>
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
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Temperature</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">Top P</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={topP}
                  onChange={(e) => setTopP(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block mb-2 text-sm font-medium text-gray-900 dark:text-white">System Prompt</label>
                <textarea
                  className="w-full p-2 border rounded-md bg-zinc-200 dark:bg-zinc-800 text-black dark:text-white"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={5}
                />
              </div>
            </div>
            <button
              className="mt-6 h-10 px-5 rounded-md bg-blue-600 text-white font-medium transition-colors hover:bg-blue-700"
              onClick={() => setIsSettingsModalOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {isCharacterModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-zinc-800 p-6 rounded-lg max-w-4xl w-full mx-4">
            <h2 className="text-2xl font-bold mb-4 text-black dark:text-white">
              Select a Character
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 max-h-96 overflow-y-auto">
              {Object.entries(superheroPrompts).map(([key, character]) => (
                <div
                  key={key}
                  className={`p-4 border rounded-md ${
                    selectedSuperheroKey === key
                      ? "border-blue-500 ring-2 ring-blue-500"
                      : "border-zinc-300 dark:border-zinc-700"
                  } bg-zinc-100 dark:bg-zinc-900`}
                >
                  <h3 className="text-lg font-semibold mb-2 text-black dark:text-white">
                    {character.name}
                  </h3>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300 line-clamp-4">
                    {character.prompt}
                  </p>
                  <button
                    className="mt-4 w-full h-10 px-5 rounded-md bg-blue-600 text-white font-medium transition-colors hover:bg-blue-700"
                    onClick={() => handleCharacterSelect(key)}
                  >
                    Select
                  </button>
                </div>
              ))}
            </div>
            <button
              className="mt-6 h-10 px-5 rounded-md bg-gray-400 text-white font-medium transition-colors hover:bg-gray-500"
              onClick={() => setIsCharacterModalOpen(false)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}



