"use client";

import {
  ArrowLeft, ArrowUp, Bot, CirclePlus, Clock3, HeartPulse, History,
  RotateCcw, ShieldCheck, Stethoscope, Trash2, UserRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { HeaderAccount } from "@/components/auth/header-account";

type Message = { role: "agent" | "user"; content: string };
type Session = { id: string; title: string };
type SessionState = "done" | "streaming" | "error";

const WELCOME_MESSAGE: Message = {
  role: "agent",
  content: "您好，我是智能导诊助手。请告诉我您哪里不舒服、持续多久了，我会根据您的描述协助梳理合适的就诊科室。",
};
const EXAMPLES = ["胃痛反酸一个月", "体检发现甲状腺结节", "突然胸痛"];

function sessionStateMeta(state?: SessionState) {
  if (state === "streaming") return { dot: "bg-amber-400", label: "回复中" };
  if (state === "error") return { dot: "bg-red-500", label: "回复异常" };
  return { dot: "bg-emerald-500", label: "已完成" };
}

export function TriageDemo() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [statusText, setStatusText] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState("");
  const [sessionStatus, setSessionStatus] = useState<Record<string, SessionState>>({});
  const [sessionStatusText, setSessionStatusText] = useState<Record<string, string>>({});
  const snapshots = useRef<Record<string, { messages: Message[]; statusText: string; busy: boolean }>>({});
  const inFlightSessions = useRef(new Set<string>());
  const messageListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeSession) snapshots.current[activeSession] = { messages, statusText, busy };
  }, [activeSession, messages, statusText, busy]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const list = messageListRef.current;
      if (list) list.scrollTop = list.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, statusText, busy, activeSession]);

  useEffect(() => {
    fetch("/api/agent/sessions")
      .then((response) => (response.ok ? response.json() : []))
      .then((items: Session[]) => {
        setSessions(items);
        const first = items[0];
        if (!first) return;
        setActiveSession(first.id);
        setSessionId(first.id);
        return fetch(`/api/agent/sessions/${first.id}/messages`)
          .then((response) => (response.ok ? response.json() : []))
          .then((rows: Message[]) => setMessages(rows.length ? rows : [WELCOME_MESSAGE]));
      })
      .catch(() => undefined);
  }, []);

  async function send(text = input) {
    const value = text.trim();
    if (!value) return;
    let currentSession = activeSession || sessionId;
    if (!currentSession) {
      const created = await fetch("/api/agent/sessions", { method: "POST" })
        .then((response) => (response.ok ? (response.json() as Promise<Session>) : null))
        .catch(() => null);
      if (created) {
        currentSession = created.id;
        setActiveSession(created.id);
        setSessionId(created.id);
        setSessions((items) => [created, ...items]);
      }
    }
    if (!currentSession || inFlightSessions.current.has(currentSession)) return;
    inFlightSessions.current.add(currentSession);
    if (currentSession) {
      setSessionStatus((items) => ({ ...items, [currentSession]: "streaming" }));
      setSessionStatusText((items) => ({ ...items, [currentSession]: "正在接收您的描述…" }));
      setSessions((items) => items.map((item) =>
        item.id === currentSession && item.title === "新会话"
          ? { ...item, title: value.slice(0, 22) || "新会话" }
          : item,
      ));
    }
    setInput("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", content: value }, { role: "agent", content: "" }]);

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ session_id: currentSession, message: value }),
      });
      if (!response.ok || !response.body) throw new Error("智能导诊服务暂时不可用，请稍后重试");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim().startsWith("data: ")) continue;
          const event = JSON.parse(line.trim().slice(6)) as { type?: string; text?: string; session_id?: string };
          if (event.type === "token" && event.text) {
            setStatusText("");
            setMessages((current) => current.map((message, index) =>
              index === current.length - 1 ? { ...message, content: message.content + event.text } : message,
            ));
          }
          if (event.type === "status" && event.text) {
            setStatusText(event.text);
            if (currentSession) setSessionStatusText((items) => ({ ...items, [currentSession]: event.text! }));
          }
          if (event.type === "done" && event.session_id) {
            setSessionStatus((items) => ({ ...items, [event.session_id!]: "done" }));
            setSessionStatusText((items) => ({ ...items, [event.session_id!]: "回复完成" }));
            setSessionId(event.session_id);
            setSessions((items) => items.some((item) => item.id === event.session_id)
              ? items
              : [{ id: event.session_id!, title: value.slice(0, 24) }, ...items]);
          }
        }
      }
    } catch (error) {
      if (currentSession) {
        setSessionStatus((items) => ({ ...items, [currentSession]: "error" }));
        setSessionStatusText((items) => ({ ...items, [currentSession]: "回复异常" }));
      }
      setMessages((current) => current.map((message, index) =>
        index === current.length - 1
          ? { ...message, content: error instanceof Error ? error.message : "无法连接智能导诊服务，请稍后重试" }
          : message,
      ));
    } finally {
      inFlightSessions.current.delete(currentSession);
      setBusy(false);
    }
  }

  function reset() {
    setMessages([WELCOME_MESSAGE]);
    setInput("");
    setSessionId("");
    setStatusText("");
  }

  async function selectSession(id: string) {
    const snapshot = snapshots.current[id];
    setActiveSession(id);
    setSessionId(id);
    if (snapshot) {
      setMessages(snapshot.messages);
      setStatusText(snapshot.statusText || sessionStatusText[id] || "");
      setBusy(snapshot.busy);
      return;
    }
    const response = await fetch(`/api/agent/sessions/${id}/messages`);
    const rows = (await response.json()) as Message[];
    setMessages(rows.length ? rows : [WELCOME_MESSAGE]);
    setStatusText(sessionStatusText[id] || "");
    setBusy(sessionStatus[id] === "streaming");
  }

  async function createSession() {
    const response = await fetch("/api/agent/sessions", { method: "POST" });
    if (!response.ok) return;
    const item = (await response.json()) as Session;
    setSessions((current) => [item, ...current]);
    setActiveSession(item.id);
    setSessionId(item.id);
    setMessages([WELCOME_MESSAGE]);
    setStatusText("");
    setBusy(false);
  }

  async function removeSession(id: string) {
    await fetch(`/api/agent/sessions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const next = sessions.filter((item) => item.id !== id);
    setSessions(next);
    delete snapshots.current[id];
    if (activeSession === id) {
      if (next[0]) await selectSession(next[0].id);
      else await createSession();
    }
  }

  const activeTitle = sessions.find((item) => item.id === activeSession)?.title || "新咨询";
  const activeMeta = sessionStateMeta(sessionStatus[activeSession]);

  return (
    <div className="mx-auto grid h-full max-w-[1680px] bg-white shadow-[0_0_60px_rgba(29,49,34,0.08)] lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 flex-col border-r border-[#e5ebe4] bg-[#f8faf7] lg:flex">
        <div className="border-b border-[#e5ebe4] px-5 py-5">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-[#2f6b45] text-white shadow-sm"><Stethoscope className="size-5" /></span>
            <span><span className="block text-sm font-semibold tracking-tight">智能导诊</span><span className="mt-0.5 block text-xs text-muted-foreground">就诊科室咨询服务</span></span>
          </Link>
          <button type="button" onClick={() => void createSession()} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#2f6b45] text-sm font-medium text-white shadow-sm transition-colors hover:bg-[#285b3b]">
            <CirclePlus className="size-4" />发起新咨询
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col px-3 py-4">
          <div className="flex items-center gap-2 px-2 text-xs font-medium text-muted-foreground"><History className="size-3.5" />最近咨询</div>
          <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
            {sessions.length ? sessions.map((item) => {
              const meta = sessionStateMeta(sessionStatus[item.id]);
              const active = activeSession === item.id;
              return (
                <div key={item.id} className={`group flex items-center rounded-xl transition-colors ${active ? "bg-white shadow-sm ring-1 ring-[#dfe7de]" : "hover:bg-white/80"}`}>
                  <button type="button" onClick={() => void selectSession(item.id)} className="min-w-0 flex-1 px-3 py-3 text-left">
                    <span className="flex items-center gap-2"><span className={`size-2 shrink-0 rounded-full ${meta.dot}`} /><span className="truncate text-sm font-medium">{item.title || "新咨询"}</span></span>
                    <span className="mt-1 block truncate pl-4 text-[11px] text-muted-foreground">{sessionStatusText[item.id] || meta.label}</span>
                  </button>
                  <button type="button" onClick={() => void removeSession(item.id)} aria-label={`删除${item.title || "咨询"}`} className="mr-2 rounded-lg p-2 text-muted-foreground opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100"><Trash2 className="size-3.5" /></button>
                </div>
              );
            }) : <div className="rounded-xl border border-dashed p-5 text-center text-xs leading-5 text-muted-foreground">暂无历史咨询</div>}
          </div>
        </div>

        <div className="border-t border-[#e5ebe4] p-4">
          <div className="rounded-xl bg-[#edf4ea] p-3 text-xs leading-5 text-[#56705e]">
            <div className="flex items-center gap-2 font-medium text-[#31583e]"><ShieldCheck className="size-4" />安全提示</div>
            <p className="mt-1.5">本服务仅提供就诊科室参考，不能替代医生诊断。</p>
          </div>
          <Link href="/#agent-demo" className="mt-3 flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />返回项目介绍</Link>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col bg-[#fbfcfa]">
        <header className="flex h-[72px] shrink-0 items-center justify-between border-b border-[#e5ebe4] bg-white/95 px-4 backdrop-blur sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#edf4ea] text-[#2f6b45] lg:hidden"><Stethoscope className="size-4" /></span>
            <div className="min-w-0">
              <div className="flex items-center gap-2"><h1 className="truncate text-sm font-semibold sm:text-base">{activeTitle}</h1><span className={`size-2 shrink-0 rounded-full ${activeMeta.dot}`} /></div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{busy ? statusText || "正在处理您的问题…" : "智能导诊服务在线"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void createSession()} className="inline-flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-xs font-medium shadow-sm hover:bg-muted lg:hidden"><CirclePlus className="size-4" />新咨询</button>
            <button type="button" onClick={reset} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="重新开始当前咨询" title="重新开始"><RotateCcw className="size-4" /></button>
            <span className="hidden h-5 w-px bg-border sm:block" />
            <HeaderAccount />
          </div>
        </header>

        <div className="flex gap-2 overflow-x-auto border-b border-[#e5ebe4] bg-white px-4 py-2.5 lg:hidden">
          {sessions.map((item) => {
            const meta = sessionStateMeta(sessionStatus[item.id]);
            return <button key={item.id} type="button" onClick={() => void selectSession(item.id)} className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${activeSession === item.id ? "border-[#7ca287] bg-[#edf4ea] text-[#2f6b45]" : "bg-white text-muted-foreground"}`}><span className={`size-2 rounded-full ${meta.dot}`} /><span className="max-w-36 truncate">{item.title || "新咨询"}</span></button>;
          })}
        </div>

        <div ref={messageListRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
          <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-8 sm:px-8 sm:py-10">
            <div className="mb-8 rounded-2xl border border-[#dfe9dc] bg-[#f3f7f0] px-4 py-3 text-xs leading-6 text-[#5d7162] sm:flex sm:items-center sm:justify-between sm:gap-4">
              <span className="flex items-center gap-2 font-medium text-[#31583e]"><HeartPulse className="size-4" />请尽量描述部位、持续时间和伴随症状</span>
              <span className="mt-1 block sm:mt-0">如有胸痛、呼吸困难等紧急情况，请立即就医</span>
            </div>
            <div className="space-y-8">
              {messages.map((message, index) => {
                const isUser = message.role === "user";
                const isPending = !message.content && index === messages.length - 1;
                if (isPending && !busy) return null;
                return (
                  <article key={`${message.role}-${index}`} className={`flex gap-3 sm:gap-4 ${isUser ? "justify-end" : "justify-start"}`}>
                    {!isUser ? <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-[#dce8da] bg-[#edf4ea] text-[#2f6b45]"><Bot className="size-4" /></span> : null}
                    <div className={`min-w-0 max-w-[82%] ${isUser ? "order-first" : ""}`}>
                      <div className={`mb-1.5 flex items-center gap-2 text-xs text-muted-foreground ${isUser ? "justify-end" : ""}`}><span>{isUser ? "我" : "智能导诊助手"}</span></div>
                      <div className={isUser
                        ? "rounded-2xl rounded-tr-md bg-[#2f6b45] px-4 py-3 text-sm leading-7 text-white shadow-sm"
                        : isPending
                          ? "flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5 text-sm text-muted-foreground shadow-sm"
                          : "whitespace-pre-wrap text-sm leading-7 text-[#26332b] sm:text-[15px]"
                      }>
                        {isPending ? <><span className="flex gap-1" aria-hidden="true"><span className="size-1.5 animate-pulse rounded-full bg-[#6f9879]" /><span className="size-1.5 animate-pulse rounded-full bg-[#6f9879] [animation-delay:150ms]" /><span className="size-1.5 animate-pulse rounded-full bg-[#6f9879] [animation-delay:300ms]" /></span>{statusText || "正在分析您的描述…"}</> : message.content}
                      </div>
                    </div>
                    {isUser ? <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[#eef0ed] text-[#667069]"><UserRound className="size-4" /></span> : null}
                  </article>
                );
              })}
            </div>
          </div>
        </div>

        <footer className="shrink-0 border-t border-[#e5ebe4] bg-white px-4 py-4 sm:px-8 sm:py-5">
          <div className="mx-auto w-full max-w-4xl">
            <div className="mb-3 flex gap-2 overflow-x-auto">
              {EXAMPLES.map((example) => <button key={example} type="button" disabled={busy} onClick={() => void send(example)} className="shrink-0 rounded-full border border-[#dfe6dd] bg-[#fafbf9] px-3 py-1.5 text-xs text-muted-foreground transition hover:border-[#91ac96] hover:text-[#2f6b45] disabled:cursor-not-allowed disabled:opacity-45">{example}</button>)}
            </div>
            <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="flex items-end gap-3 rounded-2xl border border-[#d9e2d7] bg-white p-2.5 pl-4 shadow-[0_8px_30px_rgba(45,72,51,0.08)] transition focus-within:border-[#7ca287] focus-within:ring-4 focus-within:ring-[#dcebd8]/60">
              <textarea disabled={busy} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={1} placeholder={busy ? "正在回复，请稍候…" : "请描述您的症状，例如：右下腹疼痛两天…"} className="max-h-28 min-h-10 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-wait" />
              <button type="submit" aria-label="发送消息" disabled={busy || !input.trim()} className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#2f6b45] text-white shadow-sm transition hover:bg-[#285b3b] disabled:cursor-not-allowed disabled:bg-[#c8d5c7]"><ArrowUp className="size-4" /></button>
            </form>
            <div className="mt-2.5 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground"><Clock3 className="size-3" />AI 导诊仅供参考，不构成诊断或治疗建议</div>
          </div>
        </footer>
      </section>
    </div>
  );
}
