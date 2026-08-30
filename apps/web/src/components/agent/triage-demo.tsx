"use client";

import { ArrowUp, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";

type Message = { role: "agent" | "user"; content: string };

const examples = ["胃痛反酸一个月", "体检发现甲状腺结节", "突然胸痛"]; 

export function TriageDemo() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "agent", content: "你好，可以告诉我哪里不舒服、持续多久了吗？我会帮你梳理适合咨询的科室。" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState("");

  async function send(text = input) {
    const value = text.trim();
    if (!value || busy) return;
    setInput("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", content: value }, { role: "agent", content: "" }]);
    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ session_id: sessionId, message: value }),
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
            setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, content: message.content + event.text } : message));
          }
          if (event.type === "done" && event.session_id) setSessionId(event.session_id);
        }
      }
    } catch (error) {
      setMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, content: error instanceof Error ? error.message : "无法连接智能导诊服务" } : message));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setMessages([{ role: "agent", content: "你好，可以告诉我哪里不舒服、持续多久了吗？我会帮你梳理适合咨询的科室。" }]);
    setInput("");
    setSessionId("");
  }

  return (
    <section className="flex min-h-[560px] flex-col overflow-hidden rounded-[2rem] border bg-card/90 shadow-sm">
      <header className="flex items-center justify-between border-b px-5 py-4 sm:px-6">
        <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><Sparkles className="size-4" /></span><div><p className="text-sm font-medium">智能导诊</p><p className="text-xs text-muted-foreground">本地交互演示</p></div></div>
        <button type="button" onClick={reset} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="重新开始"><RotateCcw className="size-4" /></button>
      </header>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto bg-background/45 p-5 sm:p-6">
        {messages.map((message, index) => <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-7 ${message.role === "user" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md border bg-card text-foreground"}`}>{message.content}</div></div>)}
        {busy ? <div className="flex justify-start"><div className="rounded-2xl rounded-bl-md border bg-card px-4 py-3 text-sm text-muted-foreground">正在整理信息…</div></div> : null}
      </div>
      <div className="border-t p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap gap-2">{examples.map((example) => <button key={example} type="button" disabled={busy} onClick={() => send(example)} className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50">{example}</button>)}</div>
        <form onSubmit={(event) => { event.preventDefault(); send(); }} className="flex items-center gap-2 rounded-2xl border bg-background p-2 focus-within:border-primary/50"><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="描述你的症状…" className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted-foreground" disabled={busy} /><button type="submit" aria-label="发送" disabled={!input.trim() || busy} className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"><ArrowUp className="size-4" /></button></form>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">演示内容仅用于展示交互，不构成医疗建议。</p>
      </div>
    </section>
  );
}
