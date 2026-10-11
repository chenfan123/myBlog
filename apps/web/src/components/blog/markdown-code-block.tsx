"use client";

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import { Check, Clipboard, Code2, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);

const languageAliases: Record<string, string> = {
  html: "xml",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
};

const runnableLanguages = new Set([
  "js",
  "javascript",
  "py",
  "python",
  "ts",
  "typescript",
]);
const pyodideBaseUrl =
  process.env.NEXT_PUBLIC_PYODIDE_BASE_URL ??
  "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const maxOutputLines = 200;

export function MarkdownCodeBlock({ code, language = "text" }: { code: string; language?: string }) {
  const normalizedLanguage = language.toLowerCase();
  const highlightLanguage = languageAliases[normalizedLanguage] ?? normalizedLanguage;
  const [copied, setCopied] = useState(false);
  const [output, setOutput] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const pythonReadyRef = useRef(false);
  const highlighted = useMemo(() => {
    if (!hljs.getLanguage(highlightLanguage)) return escapeHtml(code);
    return hljs.highlight(code, { language: highlightLanguage }).value;
  }, [code, highlightLanguage]);
  const runnable = runnableLanguages.has(normalizedLanguage);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const run = async () => {
    const isPython = normalizedLanguage === "py" || normalizedLanguage === "python";
    if (!isPython) workerRef.current?.terminate();
    setRunning(true);
    setOutput([]);
    try {
      let executable = code;
      if (normalizedLanguage === "ts" || normalizedLanguage === "typescript") {
        const { transform } = await import("sucrase");
        executable = transform(code, { transforms: ["typescript"] }).code;
      }
      const worker = isPython
        ? (workerRef.current ?? createPythonWorker(pyodideBaseUrl))
        : createJavaScriptWorker();
      workerRef.current = worker;
      let timeout = window.setTimeout(() => {
        worker.terminate();
        workerRef.current = null;
        pythonReadyRef.current = false;
        appendOutput(isPython ? "[运行已终止：初始化或执行超时]" : "[运行已终止：超过 3 秒]");
        setRunning(false);
      }, isPython && !pythonReadyRef.current ? 45_000 : isPython ? 15_000 : 3000);
      worker.onmessage = (event: MessageEvent<{ done?: boolean; line?: string; ready?: boolean; status?: string }>) => {
        if (event.data.status) appendOutput(event.data.status);
        if (event.data.line) appendOutput(event.data.line);
        if (event.data.ready) {
          pythonReadyRef.current = true;
          window.clearTimeout(timeout);
          timeout = window.setTimeout(() => {
            worker.terminate();
            workerRef.current = null;
            pythonReadyRef.current = false;
            appendOutput("[运行已终止：Python 执行超过 15 秒]");
            setRunning(false);
          }, 15_000);
        }
        if (event.data.done) {
          window.clearTimeout(timeout);
          if (!isPython) {
            worker.terminate();
            workerRef.current = null;
          }
          setRunning(false);
        }
      };
      worker.postMessage({ code: executable });
    } catch (error) {
      setOutput([error instanceof Error ? error.message : "代码编译失败"]);
      setRunning(false);
    }
  };

  const appendOutput = (line: string) => {
    setOutput((current) => [...current.slice(-(maxOutputLines - 1)), line.slice(0, 10_000)]);
  };

  return (
    <figure className="code-playground my-7 overflow-hidden rounded-2xl border border-[#d8ded5] bg-[#f7f9f5] shadow-sm">
      <figcaption className="flex min-h-11 items-center justify-between gap-3 border-b border-[#d8ded5] bg-[#edf2e9] px-4">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.12em] text-[#52604f]"><Code2 className="size-3.5 text-primary" />{normalizedLanguage}</span>
        <span className="flex items-center gap-1">
          {runnable ? <button type="button" onClick={run} disabled={running} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-white transition hover:bg-primary/85 disabled:opacity-60"><Play className="size-3 fill-current" />{running ? "运行中" : "运行"}</button> : null}
          <button type="button" onClick={copy} className="inline-flex size-7 items-center justify-center rounded-md text-[#52604f] transition hover:bg-white hover:text-foreground" aria-label="复制代码">{copied ? <Check className="size-3.5 text-primary" /> : <Clipboard className="size-3.5" />}</button>
        </span>
      </figcaption>
      <pre className="m-0 overflow-x-auto bg-[#f8faf7] p-5 text-[13px] leading-6 text-[#273029]"><code className="hljs block min-w-max bg-transparent p-0" dangerouslySetInnerHTML={{ __html: highlighted }} /></pre>
      {output.length || running ? <div className="border-t border-[#d8ded5] bg-white"><div className="flex items-center justify-between border-b border-[#e5e8e2] px-4 py-2"><span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Console</span><button type="button" onClick={() => setOutput([])} className="text-muted-foreground hover:text-foreground" aria-label="清空输出"><RotateCcw className="size-3.5" /></button></div><pre className="m-0 max-h-56 overflow-auto bg-[#fbfcfa] px-5 py-4 font-mono text-xs leading-6 text-[#344238]">{running && !output.length ? "正在运行…" : output.join("\n")}</pre></div> : null}
    </figure>
  );
}

function createJavaScriptWorker() {
  const source = `
    const blocked = () => { throw new Error("运行沙箱已禁止网络和外部资源访问"); };
    self.fetch = blocked; self.XMLHttpRequest = undefined; self.WebSocket = undefined; self.EventSource = undefined; self.importScripts = blocked; self.Worker = undefined;
    const text = (value) => { try { return typeof value === "string" ? value : JSON.stringify(value, null, 2); } catch { return String(value); } };
    for (const level of ["log", "info", "warn", "error"]) console[level] = (...args) => postMessage({ line: args.map(text).join(" ") });
    self.onmessage = async ({ data }) => {
      try {
        const result = new Function('"use strict";\\n' + data.code)();
        const value = result instanceof Promise ? await result : result;
        if (value !== undefined) postMessage({ line: "返回值: " + text(value) });
      } catch (error) { postMessage({ line: (error && error.stack) || String(error) }); }
      postMessage({ done: true });
    };
  `;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker;
}

function createPythonWorker(baseUrl: string) {
  const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const source = `
    const baseUrl = ${JSON.stringify(normalizedBaseUrl)};
    const nativeFetch = self.fetch.bind(self);
    const blocked = () => Promise.reject(new Error("Python 运行沙箱已禁止网络访问"));
    let runtime;
    const loadRuntime = async () => {
      postMessage({ status: "[正在初始化 Python，首次运行需要下载运行时…]" });
      const { loadPyodide } = await import(baseUrl + "pyodide.mjs");
      const pyodide = await loadPyodide({ indexURL: baseUrl });
      postMessage({ status: "[Python 运行时已就绪]", ready: true });
      return pyodide;
    };
    self.XMLHttpRequest = undefined;
    self.WebSocket = undefined;
    self.EventSource = undefined;
    self.onmessage = async ({ data }) => {
      try {
        runtime ??= loadRuntime();
        const pyodide = await runtime;
        self.fetch = nativeFetch;
        await pyodide.loadPackagesFromImports(data.code);
        self.fetch = blocked;
        pyodide.setStdout({ batched: (line) => postMessage({ line }) });
        pyodide.setStderr({ batched: (line) => postMessage({ line: "stderr: " + line }) });
        const result = await pyodide.runPythonAsync(data.code);
        if (result !== undefined && result !== null) postMessage({ line: "返回值: " + String(result) });
        if (result && typeof result.destroy === "function") result.destroy();
      } catch (error) {
        postMessage({ line: (error && error.stack) || String(error) });
      }
      postMessage({ done: true });
    };
  `;
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const worker = new Worker(url, { type: "module" });
  URL.revokeObjectURL(url);
  return worker;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
