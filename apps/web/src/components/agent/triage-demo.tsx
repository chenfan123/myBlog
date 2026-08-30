"use client";

import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Message = { role: "agent" | "user"; content: string };

const examples = ["胃痛反酸一个月", "体检发现甲状腺结节", "突然胸痛"]; 

export function TriageDemo() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "agent", content: "你好，可以告诉我哪里不舒服、持续多久了吗？我会帮你梳理适合咨询的科室。" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [statusText, setStatusText] = useState("");
  const snapshots = useRef<Record<string, { messages: Message[]; statusText: string; busy: boolean }>>({});
  const [sessions, setSessions] = useState<{ id: string; title: string }[]>([]);
  const [activeSession, setActiveSession] = useState("");
  const [sessionStatus, setSessionStatus] = useState<Record<string, "done" | "streaming" | "error">>({});
  const [sessionStatusText, setSessionStatusText] = useState<Record<string, string>>({});
  useEffect(() => { if (activeSession) snapshots.current[activeSession] = { messages, statusText, busy }; }, [activeSession, messages, statusText, busy]);
  useEffect(() => { fetch("/api/agent/sessions").then((r) => r.ok ? r.json() : []).then((items: { id: string; title: string }[]) => { setSessions(items); if (items[0]) { setActiveSession(items[0].id); fetch(`/api/agent/sessions/${items[0].id}/messages`).then((r) => r.json()).then((rows: Message[]) => setMessages(rows.length ? rows : messages)); } }).catch(() => undefined); }, []);

  async function send(text = input) {
    const value = text.trim();
    if (!value) return;
    let currentSession = activeSession || sessionId;
    if (!currentSession) {
      const created = await fetch("/api/agent/sessions", { method: "POST" }).then((r) => r.ok ? r.json() as Promise<{ id: string; title: string }> : null).catch(() => null);
      if (created) { currentSession = created.id; setActiveSession(created.id); setSessionId(created.id); setSessions((items) => [created, ...items]); }
    }
    if (currentSession) setSessionStatus((items) => ({ ...items, [currentSession!]: "streaming" }));
    if (currentSession) setSessions((items) => items.map((item) => item.id === currentSession && item.title === "新会话" ? { ...item, title: value.slice(0, 18) || "新会话" } : item));
    setInput("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", content: value }, { role: "agent", content: "" }]);
    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ session_id: currentSession, message: value }),
      });
      if (!response.ok || !response.body) throw new Error("智能导诊服务暂时不可用");
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
            setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, content: message.content + event.text } : message));
          }
          if (event.type === "status" && event.text) { setStatusText(event.text); if (currentSession) setSessionStatusText((items) => ({ ...items, [currentSession!]: event.text! })); }
          if (event.type === "done" && event.session_id) { setSessionStatus((items) => ({ ...items, [event.session_id!]: "done" })); setSessionStatusText((items) => ({ ...items, [event.session_id!]: "回复完成" })); setSessionId(event.session_id); setActiveSession(event.session_id); setSessions((items) => items.some((item) => item.id === event.session_id) ? items : [{ id: event.session_id!, title: value.slice(0, 24) }, ...items]); }
        }
      }
    } catch (error) {
      if (currentSession) { setSessionStatus((items) => ({ ...items, [currentSession!]: "error" })); setSessionStatusText((items) => ({ ...items, [currentSession!]: "回复出错" })); }
      setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, content: error instanceof Error ? error.message : "无法连接智能导诊服务" } : message));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setMessages([{ role: "agent", content: "你好，可以告诉我哪里不舒服、持续多久了吗？我会帮你梳理适合咨询的科室。" }]);
    setInput("");
    setSessionId("");
    setStatusText("");
  }

  async function selectSession(id: string) { const snapshot = snapshots.current[id]; setActiveSession(id); setSessionId(id); if (snapshot) { setMessages(snapshot.messages); setStatusText(snapshot.statusText || sessionStatusText[id] || ""); setBusy(snapshot.busy); return; } const response = await fetch(`/api/agent/sessions/${id}/messages`); const rows = await response.json(); setMessages(rows.length ? rows : [{ role: "agent", content: "你好，可以告诉我哪里不舒服、持续多久了吗？我会帮你梳理适合咨询的科室。" }]); setStatusText(sessionStatusText[id] || ""); setBusy(sessionStatus[id] === "streaming"); }
  async function createSession() { const response = await fetch("/api/agent/sessions", { method: "POST" }); if (!response.ok) return; const item = await response.json() as { id: string; title: string }; setSessions((current) => [item, ...current]); setActiveSession(item.id); setSessionId(item.id); setMessages([{ role: "agent", content: "你好，可以告诉我哪里不舒服、持续多久了吗？我会帮你梳理适合咨询的科室。" }]); setStatusText(""); }
  async function removeSession(id: string) { await fetch(`/api/agent/sessions?id=${encodeURIComponent(id)}`, { method: "DELETE" }); const next = sessions.filter((item) => item.id !== id); setSessions(next); if (activeSession === id) { if (next[0]) selectSession(next[0].id); else createSession(); } }

  return (
    <section className="flex h-[min(760px,78vh)] min-h-[560px] w-full flex-col overflow-hidden rounded-[2rem] border bg-card/90 shadow-sm">
      <header className="flex items-center justify-between border-b px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Sparkles className="size-4" /></span><div><p className="text-sm font-medium">智能导诊</p><p className="text-xs text-muted-foreground">本地交互演示</p></div></div>
        <div className="flex items-center gap-2"><button type="button" onClick={createSession} className="rounded-lg border px-3 py-1.5 text-xs">新建会话</button><button type="button" onClick={reset} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="重新开始"><RotateCcw className="size-4" /></button></div>
      </header>
      <div className="flex gap-2 overflow-x-auto border-b px-5 py-2 sm:px-6">{sessions.map((item) => <div key={item.id} className={`flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs ${activeSession === item.id ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"}`}><span className={`size-2 rounded-full ${sessionStatus[item.id] === "streaming" ? "bg-amber-400" : sessionStatus[item.id] === "error" ? "bg-red-500" : "bg-emerald-500"}`} title={sessionStatus[item.id] === "streaming" ? "回复中" : sessionStatus[item.id] === "error" ? "出错" : "已完成"} /><button type="button" onClick={() => selectSession(item.id)}>{item.title || "会话"}</button><button type="button" onClick={() => removeSession(item.id)} aria-label="删除会话">×</button></div>)}</div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-background/45 p-5 sm:p-6">
        {messages.map((message, index) => message.content || index !== messages.length - 1 ? <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-7 ${message.role === "user" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border bg-card text-foreground"}`}>{message.content || statusText || "处理中…"}</div></div> : null)}
        {busy && statusText ? <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md border bg-card px-4 py-3 text-sm text-muted-foreground">{statusText}</div></div> : null}
      </div>
      <div className="border-t p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap gap-2">{examples.map((example) => <button key={example} type="button" onClick={() => send(example)} className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50">{example}</button>)}</div>
        <form onSubmit={(event) => { event.preventDefault(); send(); }} className="flex items-center gap-2 rounded-2xl border bg-background p-2 focus-within:border-primary/50"><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="描述你的症状…" className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground" /><button type="submit" aria-label="发送" disabled={!input.trim()} className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"><ArrowUp className="size-4" /></button></form>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">演示内容仅用于展示交互，不构成医疗建议。</p>
      </div>
    </section>
  );
}
