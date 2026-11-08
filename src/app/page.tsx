"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { evaluate } from "mathjs";
import { superheroPrompts } from "@/lib/superheroPrompts";
import { DEFAULT_MODEL, MODELS, formatSize, getModel } from "@/lib/models";
import ChatMessage, { splitThinking, type Message, type Source } from "@/components/ChatMessage";
import ModelPicker from "@/components/ModelPicker";
import Modal from "@/components/Modal";
import {
  BookIcon,
  BrainIcon,
  ChevronDownIcon,
  ChipIcon,
  GlobeIcon,
  LogoMark,
  MenuIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  SettingsIcon,
  StopIcon,
  TrashIcon,
  UserIcon,
} from "@/components/icons";

const DEFAULT_SYSTEM_PROMPT = `You are a helpful and friendly AI assistant running locally in the user's browser. Give accurate, concise answers. If you don't know something, say so instead of making it up.`;

const COMMANDS = [
  { name: "/search", hint: "Search the web and answer from the results" },
  { name: "/wiki", hint: "Answer from the top Wikipedia article" },
  { name: "/summarize", hint: "Summarize a block of text" },
  { name: "/weather", hint: "Current weather for a place" },
  { name: "/calculate", hint: "Evaluate a maths expression" },
];

const STARTERS = [
  "Explain how a transformer language model works, simply",
  "Write a haiku about running AI in a web browser",
  "Give me three ideas for a weekend project",
  "/calculate sqrt(2) * 10^3",
];

const HISTORY_LIMIT = 8; // messages of context sent to the model

interface Chat {
  id: string;
  name: string;
  messages: Message[];
  timestamp: number;
}

interface Settings {
  temperature: number;
  topP: number;
  maxTokens: number;
  systemPrompt: string;
  characterKey: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  temperature: 0.4,
  topP: 0.9,
  maxTokens: 1024,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  characterKey: null,
};

type Mode = "chat" | "web" | "wiki";
type ModelStatus = "idle" | "loading" | "ready" | "error";

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

const load = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const save = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked; persistence is best-effort.
  }
};

const titleFrom = (text: string) => {
  const clean = text.replace(/^\/\w+\s*/, "").replace(/\s+/g, " ").trim();
  return clean.length > 42 ? clean.slice(0, 40).trimEnd() + "…" : clean || "New chat";
};

const newChatEntry = (): Chat => ({ id: crypto.randomUUID(), name: "New chat", messages: [], timestamp: Date.now() });

export default function Home() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [input, setInput] = useState("");
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [mode, setMode] = useState<Mode>("chat");
  const [thinking, setThinking] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const [modelId, setModelId] = useState(DEFAULT_MODEL);
  const [loadedModel, setLoadedModel] = useState<string | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>("idle");
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progress, setProgress] = useState(0);
  const [backend, setBackend] = useState<string | null>(null);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [modal, setModal] = useState<"models" | "settings" | "characters" | null>(null);

  const worker = useRef<Worker | null>(null);
  const generatingChatId = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const stickToBottom = useRef(true);

  const model = getModel(modelId);
  const currentChat = chats.find((c) => c.id === currentChatId) ?? null;
  const messages = useMemo(() => currentChat?.messages ?? [], [currentChat]);
  const character = settings.characterKey ? superheroPrompts[settings.characterKey] : null;

  const suggestions = useMemo(() => {
    if (!input.startsWith("/") || input.includes(" ")) return [];
    const q = input.slice(1).toLowerCase();
    return COMMANDS.filter((c) => c.name.slice(1).startsWith(q));
  }, [input]);

  // Restore persisted state after mount so server and client markup match.
  useEffect(() => {
    const storedChats = load<Chat[]>("bookish.chats", []).map((c) => ({
      ...c,
      messages: c.messages.map((m) => ({ ...m, pending: false })),
    }));
    const fresh = newChatEntry();
    setChats([fresh, ...storedChats.filter((c) => c.messages.length > 0)]);
    setCurrentChatId(fresh.id);
    setSettings({ ...DEFAULT_SETTINGS, ...load<Partial<Settings>>("bookish.settings", {}) });
    const storedModel = load<string>("bookish.model", DEFAULT_MODEL);
    setModelId(MODELS.some((m) => m.id === storedModel) ? storedModel : DEFAULT_MODEL);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && !isGenerating) save("bookish.chats", chats.filter((c) => c.messages.length > 0));
  }, [chats, hydrated, isGenerating]);
  useEffect(() => {
    if (hydrated) save("bookish.settings", settings);
  }, [settings, hydrated]);
  useEffect(() => {
    if (hydrated) save("bookish.model", modelId);
  }, [modelId, hydrated]);

  const updateChat = useCallback((id: string, fn: (messages: Message[]) => Message[]) => {
    setChats((prev) => prev.map((c) => (c.id === id ? { ...c, messages: fn(c.messages) } : c)));
  }, []);

  const updateLastAssistant = useCallback(
    (id: string, fn: (m: Message) => Message) => {
      updateChat(id, (msgs) => {
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== "assistant") return msgs;
        return [...msgs.slice(0, -1), fn(last)];
      });
    },
    [updateChat]
  );

  // Worker lifecycle
  useEffect(() => {
    const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    worker.current = w;

    const onMessage = (e: MessageEvent) => {
      const data = e.data;
      const chatId = generatingChatId.current;
      switch (data.status) {
        case "loading":
          setModelStatus("loading");
          setLoadingMessage(data.message);
          if (chatId) updateLastAssistant(chatId, (m) => ({ ...m, status: data.message }));
          break;
        case "progress": {
          // Whole-model progress (tokenizer + weights), aggregated in the worker.
          const bytes = `${formatSize(Math.round(data.loaded / 1e6))} of ${formatSize(Math.round(data.total / 1e6))}`;
          setProgress(data.progress);
          setLoadingMessage(`Downloading model… ${bytes}`);
          if (chatId) {
            updateLastAssistant(chatId, (m) => ({
              ...m,
              status: `Downloading model… ${data.progress}% (${bytes})`,
            }));
          }
          break;
        }
        case "ready":
          setModelStatus("ready");
          setLoadedModel(data.model);
          save("bookish.cached", [...new Set([...load<string[]>("bookish.cached", []), data.model])]);
          setProgress(100);
          setBackend(`${data.device === "webgpu" ? "WebGPU" : "WASM (CPU)"} · ${data.dtype}`);
          break;
        case "start":
          if (chatId) updateLastAssistant(chatId, (m) => ({ ...m, status: "Thinking…" }));
          break;
        case "update":
          if (chatId) {
            updateLastAssistant(chatId, (m) => ({
              ...m,
              content: m.content + data.output,
              tps: data.tps ?? m.tps,
              numTokens: data.numTokens,
            }));
          }
          break;
        case "complete":
          if (chatId) updateLastAssistant(chatId, (m) => ({ ...m, pending: false, status: undefined }));
          generatingChatId.current = null;
          setIsGenerating(false);
          break;
        case "error":
          setModelStatus((s) => (s === "loading" ? "error" : s));
          setLoadingMessage(data.message);
          if (chatId) {
            updateLastAssistant(chatId, (m) => ({
              ...m,
              pending: false,
              error: true,
              status: undefined,
              content: m.content || `Something went wrong: ${data.message}`,
            }));
          }
          generatingChatId.current = null;
          setIsGenerating(false);
          break;
      }
    };

    w.addEventListener("message", onMessage);
    return () => {
      w.removeEventListener("message", onMessage);
      w.terminate();
    };
  }, [updateLastAssistant]);

  const loadModel = useCallback((id: string) => {
    setModelId(id);
    setProgress(0);
    setModelStatus("loading");
    setLoadingMessage("Starting…");
    worker.current?.postMessage({ type: "load", data: { model: id, avoidFp16: getModel(id).avoidFp16 } });
  }, []);

  // Models that finished loading before are in the browser cache, so load them straight away.
  useEffect(() => {
    if (hydrated && modelStatus === "idle" && load<string[]>("bookish.cached", []).includes(modelId)) {
      loadModel(modelId);
    }
    // Only on first hydration; later loads are user-initiated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // Keep the view pinned to the newest message unless the user scrolled up.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Auto-grow the composer.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const newChat = () => {
    if (currentChat && currentChat.messages.length === 0) {
      setIsSidebarOpen(false);
      textareaRef.current?.focus();
      return;
    }
    const entry = newChatEntry();
    setChats((prev) => [entry, ...prev]);
    setCurrentChatId(entry.id);
    setIsSidebarOpen(false);
    textareaRef.current?.focus();
  };

  const selectChat = (id: string) => {
    // Drop empty chats left behind when switching away from them.
    setChats((prev) => prev.filter((c) => c.messages.length > 0 || c.id === id));
    setCurrentChatId(id);
    setIsSidebarOpen(false);
  };

  const deleteChat = (id: string) => {
    if (id === currentChatId) {
      const entry = newChatEntry();
      setChats((prev) => [entry, ...prev.filter((c) => c.id !== id)]);
      setCurrentChatId(entry.id);
    } else {
      setChats((prev) => prev.filter((c) => c.id !== id));
    }
  };

  const reply = (chatId: string, content: string, extra: Partial<Message> = {}) =>
    updateChat(chatId, (msgs) => [...msgs, { role: "assistant", content, ...extra }]);

  const sendMessage = async (raw = input) => {
    const text = raw.trim();
    if (!text || isGenerating || !currentChatId) return;

    const chatId = currentChatId;
    const history = messages;
    setInput("");
    stickToBottom.current = true;

    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? {
              ...c,
              name: c.messages.length === 0 ? titleFrom(text) : c.name,
              timestamp: Date.now(),
              messages: [...c.messages, { role: "user", content: text }],
            }
          : c
      )
    );

    const [, command = "", rest = ""] = text.match(/^(\/\w+)\s*([\s\S]*)$/) ?? [];
    const arg = rest.trim();

    // Commands that don't need the language model
    if (command === "/calculate") {
      if (!arg) return reply(chatId, "Give me an expression, e.g. `/calculate 2^10 / 4`.", { error: true });
      try {
        return reply(chatId, `\`${arg}\` = **${evaluate(arg)}**`);
      } catch {
        return reply(chatId, "I couldn't evaluate that expression.", { error: true });
      }
    }

    setIsGenerating(true);

    if (command === "/weather") {
      if (!arg) {
        setIsGenerating(false);
        return reply(chatId, "Tell me where, e.g. `/weather Wellington`.", { error: true });
      }
      reply(chatId, "", { pending: true, status: "Checking the weather…" });
      try {
        const res = await fetch("/api/weather", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ location: arg }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        updateLastAssistant(chatId, (m) => ({ ...m, content: data.weatherReport, pending: false, status: undefined }));
      } catch (error) {
        updateLastAssistant(chatId, (m) => ({
          ...m,
          content: `I couldn't get the weather: ${(error as Error).message}`,
          error: true,
          pending: false,
          status: undefined,
        }));
      } finally {
        setIsGenerating(false);
      }
      return;
    }

    const useWeb = command === "/search" || (mode === "web" && !command);
    const useWiki = command === "/wiki" || (mode === "wiki" && !command);
    const query = command ? arg : text;
    const enableThinking = thinking && model.thinking;

    reply(chatId, "", {
      pending: true,
      thinking: enableThinking,
      status: useWeb ? "Searching the web…" : useWiki ? "Reading Wikipedia…" : "Thinking…",
    });

    let prompt = query;
    let sources: Source[] | undefined;

    try {
      if (command === "/summarize") {
        if (!arg) throw new Error("Paste some text after `/summarize`.");
        prompt = `Summarize the following text in a few sentences:\n\n${arg}`;
      } else if (useWeb) {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        if (!res.ok) throw new Error(`Web search failed (HTTP ${res.status}).`);
        const { searchResults, pageContent, firstResultLink } = await res.json();
        const results = (searchResults as SearchResult[]).slice(0, 5);
        sources = results.map((r) => ({ title: r.title, link: r.link }));
        const context = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`).join("\n\n");
        const page = pageContent ? `\n\nFrom ${firstResultLink}:\n${String(pageContent).slice(0, 2500)}` : "";
        prompt = `Answer the question using these web search results. Cite sources like [1].\n\n${context}${page}\n\nQuestion: ${query}`;
      } else if (useWiki) {
        const res = await fetch("/api/wikipedia-rag", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Wikipedia lookup failed (HTTP ${res.status}).`);
        sources = [{ title: `Wikipedia: ${data.title}`, link: data.link }];
        prompt = `Answer the question using this Wikipedia article about "${data.title}".\n\n${data.content}\n\nQuestion: ${query}`;
      }
    } catch (error) {
      updateLastAssistant(chatId, (m) => ({
        ...m,
        content: (error as Error).message,
        error: true,
        pending: false,
        status: undefined,
      }));
      setIsGenerating(false);
      return;
    }

    if (sources) updateLastAssistant(chatId, (m) => ({ ...m, sources, status: "Thinking…" }));

    // Earlier replies go back without their reasoning traces.
    const context = history
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.role === "assistant" ? splitThinking(m.content, m.thinking).answer : m.content }))
      .filter((m) => m.content)
      // Some chat templates (e.g. Gemma) require strictly alternating user/assistant turns.
      .reduce<{ role: Message["role"]; content: string }[]>((acc, m) => {
        if (acc.length && acc[acc.length - 1].role === m.role) acc[acc.length - 1] = m;
        else acc.push(m);
        return acc;
      }, [])
      .slice(-HISTORY_LIMIT);
    if (context[0]?.role === "assistant") context.shift();
    if (context[context.length - 1]?.role === "user") context.pop();

    if (modelStatus === "idle" || modelStatus === "error" || loadedModel !== modelId) {
      if (modelStatus !== "loading") loadModel(modelId);
    }

    generatingChatId.current = chatId;
    worker.current?.postMessage({
      type: "generate",
      data: {
        messages: [
          { role: "system", content: settings.systemPrompt },
          ...context,
          { role: "user", content: prompt },
        ],
        temperature: settings.temperature,
        top_p: settings.topP,
        // Reasoning traces are long; give them room before the answer starts.
        max_new_tokens: enableThinking ? Math.max(settings.maxTokens, 4096) : settings.maxTokens,
        enable_thinking: enableThinking,
      },
    });
  };

  const stopGeneration = () => {
    worker.current?.postMessage({ type: "interrupt" });
  };

  const applySuggestion = (name: string) => {
    setInput(name + " ");
    textareaRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSuggestion((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSuggestion((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        applySuggestion(suggestions[Math.min(activeSuggestion, suggestions.length - 1)].name);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  };

  const selectCharacter = (key: string | null) => {
    setSettings((s) => ({
      ...s,
      characterKey: key,
      systemPrompt: key ? superheroPrompts[key].prompt : DEFAULT_SYSTEM_PROMPT,
    }));
    setModal(null);
  };

  const filteredChats = chats
    .filter((c) => c.messages.length > 0 || c.id === currentChatId)
    .filter((c) => c.name.toLowerCase().includes(historySearch.toLowerCase()))
    .sort((a, b) => b.timestamp - a.timestamp);

  const statusDot =
    modelStatus === "ready"
      ? "bg-emerald-500"
      : modelStatus === "loading"
        ? "bg-amber-500 animate-pulse"
        : modelStatus === "error"
          ? "bg-red-500"
          : "bg-zinc-400";

  const modeButton = (value: Mode, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => setMode((m) => (m === value ? "chat" : value))}
      aria-pressed={mode === value}
      className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
        mode === value
          ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-300"
          : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="flex h-dvh bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {/* Sidebar */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-30 bg-zinc-950/40 md:hidden animate-fade-in" onClick={() => setIsSidebarOpen(false)} />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-zinc-200 bg-zinc-50 duration-300 ease-out max-md:transition-transform dark:border-zinc-800 dark:bg-zinc-900 md:static md:translate-x-0 ${
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
          <LogoMark />
          <div className="leading-tight">
            <div className="font-semibold tracking-tight">Bookish</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Private, in-browser AI</div>
          </div>
        </div>

        <div className="px-3">
          <button
            onClick={newChat}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <PlusIcon size={16} /> New chat
          </button>
          <label className="mt-3 flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm focus-within:border-indigo-400 dark:border-zinc-800 dark:bg-zinc-950">
            <SearchIcon size={15} className="text-zinc-400" />
            <input
              type="text"
              placeholder="Search chats"
              className="w-full bg-transparent outline-none placeholder:text-zinc-400"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
            />
          </label>
        </div>

        <nav className="mt-3 flex-1 overflow-y-auto px-2 pb-2">
          <div className="px-2 pb-1 text-xs font-medium text-zinc-400">Recent</div>
          <ul className="space-y-0.5">
            {filteredChats.map((chat) => (
              <li key={chat.id} className="group relative animate-fade-in">
                <button
                  onClick={() => selectChat(chat.id)}
                  className={`w-full truncate rounded-lg py-2 pr-9 pl-3 text-left text-sm transition-colors ${
                    chat.id === currentChatId
                      ? "bg-zinc-200/80 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-600 hover:bg-zinc-200/50 dark:text-zinc-400 dark:hover:bg-zinc-800/60"
                  }`}
                >
                  {chat.name}
                </button>
                {chat.messages.length > 0 && (
                  <button
                    onClick={() => deleteChat(chat.id)}
                    className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1.5 text-zinc-400 opacity-100 hover:bg-zinc-300/60 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100 dark:hover:bg-zinc-700"
                    aria-label={`Delete ${chat.name}`}
                    title="Delete chat"
                  >
                    <TrashIcon size={14} />
                  </button>
                )}
              </li>
            ))}
            {filteredChats.length === 0 && (
              <li className="px-3 py-2 text-sm text-zinc-400">No chats match.</li>
            )}
          </ul>
        </nav>

        <div className="border-t border-zinc-200 p-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <div className="flex items-center gap-2">
            <ChipIcon size={14} />
            <span className="truncate">{backend ?? "Nothing leaves your device"}</span>
          </div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200/70 px-3 dark:border-zinc-800/70">
          <button
            className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 md:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
            onClick={() => setIsSidebarOpen(true)}
            aria-label="Open chat history"
          >
            <MenuIcon />
          </button>

          <button
            onClick={() => setModal("models")}
            className="flex h-9 min-w-0 items-center gap-2 rounded-lg px-2.5 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${statusDot}`} />
            <span className="truncate">{model.name}</span>
            {modelStatus === "loading" && (
              <span className="text-xs font-normal tabular-nums text-zinc-500">{Math.round(progress)}%</span>
            )}
            <ChevronDownIcon size={15} className="shrink-0 text-zinc-400" />
          </button>

          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={() => setModal("characters")}
              className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title="Choose a persona"
            >
              <UserIcon size={16} />
              <span className="hidden max-w-[10rem] truncate sm:inline">{character?.name ?? "Assistant"}</span>
            </button>
            <button
              onClick={() => setModal("settings")}
              className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              aria-label="Settings"
              title="Settings"
            >
              <SettingsIcon />
            </button>
          </div>
        </header>

        {/* Messages */}
        <main ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-4 py-10 text-center">
              <LogoMark size={44} />
              <h1 className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl">What can I help with?</h1>
              <p className="mt-2 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                Bookish runs small language models directly in your browser. Your conversations never leave this device.
              </p>

              <div className="mt-6 w-full max-w-md rounded-2xl border border-zinc-200 bg-zinc-50/60 p-4 text-left dark:border-zinc-800 dark:bg-zinc-900/60">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <span className={`h-2 w-2 rounded-full ${statusDot}`} />
                      {model.name}
                      <span className="font-normal text-zinc-400">· {formatSize(model.sizeMB)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                      {modelStatus === "ready"
                        ? `Ready on ${backend}`
                        : modelStatus === "loading"
                          ? loadingMessage
                          : modelStatus === "error"
                            ? `Failed to load: ${loadingMessage}`
                            : "Not loaded yet. It downloads once, then it's cached."}
                    </div>
                  </div>
                  {modelStatus !== "ready" && modelStatus !== "loading" && (
                    <button
                      onClick={() => loadModel(modelId)}
                      className="h-8 shrink-0 rounded-lg bg-indigo-600 px-3 text-xs font-medium text-white hover:bg-indigo-500"
                    >
                      {modelStatus === "error" ? "Retry" : "Load model"}
                    </button>
                  )}
                  <button
                    onClick={() => setModal("models")}
                    className="h-8 shrink-0 rounded-lg border border-zinc-200 px-3 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    Change
                  </button>
                </div>
                {modelStatus === "loading" && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-indigo-500 transition-[width] duration-300"
                      style={{ width: `${Math.max(progress, 2)}%` }}
                    />
                  </div>
                )}
              </div>

              <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    disabled={isGenerating}
                    className="rounded-xl border border-zinc-200 px-4 py-3 text-left text-sm text-zinc-600 transition-colors hover:border-zinc-300 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
              {messages.map((msg, i) => (
                <ChatMessage key={i} message={msg} />
              ))}
            </div>
          )}
        </main>

        {/* Composer */}
        <footer className="shrink-0 px-3 pb-3 sm:px-6 sm:pb-5">
          <div className="relative mx-auto max-w-3xl">
            {suggestions.length > 0 && (
              <ul className="absolute right-0 bottom-full left-0 mb-2 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900 animate-pop-in">
                {suggestions.map((s, i) => (
                  <li key={s.name}>
                    <button
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applySuggestion(s.name);
                      }}
                      onMouseEnter={() => setActiveSuggestion(i)}
                      className={`flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm ${
                        i === activeSuggestion ? "bg-zinc-100 dark:bg-zinc-800" : ""
                      }`}
                    >
                      <span className="font-mono font-medium text-indigo-600 dark:text-indigo-400">{s.name}</span>
                      <span className="text-zinc-500 dark:text-zinc-400">{s.hint}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="rounded-2xl border border-zinc-200 bg-white shadow-sm transition-colors focus-within:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:focus-within:border-zinc-700">
              <textarea
                ref={textareaRef}
                rows={1}
                className="block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] outline-none placeholder:text-zinc-400"
                placeholder={
                  mode === "web"
                    ? "Ask anything — I'll search the web first"
                    : mode === "wiki"
                      ? "Ask anything — I'll check Wikipedia first"
                      : "Message Bookish, or type / for commands"
                }
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  setActiveSuggestion(0);
                }}
                onKeyDown={handleKeyDown}
              />
              <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
                {modeButton("web", "Web", <GlobeIcon size={14} />)}
                {modeButton("wiki", "Wiki", <BookIcon size={14} />)}
                <button
                  type="button"
                  onClick={() => setThinking((t) => !t)}
                  disabled={!model.thinking}
                  aria-pressed={thinking && model.thinking}
                  title={model.thinking ? "Let the model reason before answering" : `${model.name} doesn't support reasoning`}
                  className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    thinking && model.thinking
                      ? "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-300"
                      : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  <BrainIcon size={14} />
                  Think
                </button>

                {isGenerating ? (
                  <button
                    onClick={stopGeneration}
                    className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                    aria-label="Stop generating"
                    title="Stop"
                  >
                    <StopIcon size={14} />
                  </button>
                ) : (
                  <button
                    onClick={() => sendMessage()}
                    disabled={!input.trim()}
                    className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white transition-colors hover:bg-indigo-500 disabled:bg-zinc-200 disabled:text-zinc-400 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
                    aria-label="Send message"
                    title="Send"
                  >
                    <SendIcon size={16} />
                  </button>
                )}
              </div>
            </div>
            <p className="mt-2 text-center text-[11px] text-zinc-400">
              Small models make mistakes. Check anything important.
            </p>
          </div>
        </footer>
      </div>

      <ModelPicker
        open={modal === "models"}
        onClose={() => setModal(null)}
        selected={modelId}
        loadedModel={loadedModel}
        backend={backend}
        onSelect={(id) => {
          if (id !== loadedModel || modelStatus === "error") loadModel(id);
          setModal(null);
        }}
      />

      <Modal
        open={modal === "characters"}
        onClose={() => setModal(null)}
        title="Persona"
        description="Changes the system prompt used for new replies."
        wide
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { key: null as string | null, name: "Assistant", prompt: DEFAULT_SYSTEM_PROMPT },
            ...Object.entries(superheroPrompts).map(([key, c]) => ({ key: key as string | null, ...c })),
          ].map((c) => (
            <button
              key={c.key ?? "default"}
              onClick={() => selectCharacter(c.key)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                settings.characterKey === c.key
                  ? "border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500 dark:bg-indigo-500/10"
                  : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
              }`}
            >
              <div className="font-medium">{c.name}</div>
              <p className="mt-1 line-clamp-3 text-sm text-zinc-500 dark:text-zinc-400">{c.prompt}</p>
            </button>
          ))}
        </div>
      </Modal>

      <Modal
        open={modal === "settings"}
        onClose={() => setModal(null)}
        title="Settings"
        footer={
          <>
            <button
              onClick={() => setSettings(DEFAULT_SETTINGS)}
              className="h-9 rounded-lg px-3 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Reset to defaults
            </button>
            <button
              onClick={() => setModal(null)}
              className="h-9 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
            >
              Done
            </button>
          </>
        }
      >
        <div className="space-y-5">
          {(
            [
              ["Temperature", "temperature", 0, 1.5, 0.05, "Higher is more creative, lower is more focused."],
              ["Top P", "topP", 0.1, 1, 0.05, "Limits sampling to the most likely tokens."],
              ["Max reply length", "maxTokens", 128, 4096, 128, "Upper bound on tokens per reply."],
            ] as const
          ).map(([label, key, min, max, step, help]) => (
            <div key={key}>
              <div className="flex items-baseline justify-between">
                <label htmlFor={key} className="text-sm font-medium">
                  {label}
                </label>
                <span className="text-sm tabular-nums text-zinc-500">{settings[key]}</span>
              </div>
              <input
                id={key}
                type="range"
                min={min}
                max={max}
                step={step}
                value={settings[key]}
                onChange={(e) => setSettings((s) => ({ ...s, [key]: parseFloat(e.target.value) }))}
                className="mt-2 w-full accent-indigo-600"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{help}</p>
            </div>
          ))}

          <div>
            <label htmlFor="system-prompt" className="text-sm font-medium">
              System prompt
            </label>
            <textarea
              id="system-prompt"
              rows={5}
              value={settings.systemPrompt}
              onChange={(e) => setSettings((s) => ({ ...s, systemPrompt: e.target.value, characterKey: null }))}
              className="mt-2 w-full rounded-lg border border-zinc-200 bg-white p-3 text-sm outline-none focus:border-indigo-400 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </div>

          <div className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            <div className="font-medium">Model</div>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-zinc-500 dark:text-zinc-400">
              <dt>Name</dt>
              <dd className="truncate text-zinc-800 dark:text-zinc-200">{model.name}</dd>
              <dt>Repo</dt>
              <dd className="truncate">
                <a
                  href={`https://huggingface.co/${model.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {model.id}
                </a>
              </dd>
              <dt>Backend</dt>
              <dd className="text-zinc-800 dark:text-zinc-200">{backend ?? "Not loaded"}</dd>
            </dl>
          </div>

          <button
            onClick={() => {
              const entry = newChatEntry();
              setChats([entry]);
              setCurrentChatId(entry.id);
              setModal(null);
            }}
            disabled={isGenerating}
            className="text-sm font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
          >
            Delete all chats
          </button>
        </div>
      </Modal>
    </div>
  );
}
