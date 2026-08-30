"use client";

import {
  ChevronDown,
  ChevronRight,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  ImagePlus,
  Pencil,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { MarkdownContent } from "@/components/blog/markdown-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  blogApiBaseUrl,
  buildBlogTree,
  type BlogNodeDetail,
  type BlogNodeKind,
  type BlogNodeSummary,
  type BlogTreeNode,
} from "@/lib/blog";
import { uploadImageToCdn } from "@/lib/cdn-upload";

type Notice = { tone: "error" | "success" | "idle"; message: string };
type NameDialogState =
  | { action: "create"; kind: BlogNodeKind; initialValue: "" }
  | { action: "rename"; kind: BlogNodeKind; initialValue: string };

export function BlogWorkspace() {
  const [nodes, setNodes] = useState<BlogNodeSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [document, setDocument] = useState<BlogNodeDetail | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<Notice>({ tone: "idle", message: "" });
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void loadTree();
  }, []);

  async function loadTree() {
    setLoading(true);
    try {
      const response = await fetch(`${blogApiBaseUrl}/api/v1/admin/blog/tree`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error("无法读取博客目录");
      setNodes((await response.json()) as BlogNodeSummary[]);
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setLoading(false);
    }
  }

  async function selectNode(node: BlogNodeSummary) {
    setSelectedId(node.id);
    setNotice({ tone: "idle", message: "" });
    if (node.kind === "folder") {
      setDocument(null);
      toggleFolder(node.id);
      return;
    }
    const response = await fetch(
      `${blogApiBaseUrl}/api/v1/admin/blog/nodes/${node.id}`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) {
      setNotice({ tone: "error", message: "无法读取文章" });
      return;
    }
    setDocument((await response.json()) as BlogNodeDetail);
  }

  function toggleFolder(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createNode(kind: BlogNodeKind, name: string) {
    const selected = nodes.find((node) => node.id === selectedId);
    const parentId =
      selected?.kind === "folder" ? selected.id : (selected?.parent_id ?? null);
    const response = await fetch(`${blogApiBaseUrl}/api/v1/admin/blog/nodes`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, name, parent_id: parentId }),
    });
    if (!response.ok) {
      setNotice({ tone: "error", message: await readApiError(response) });
      return false;
    }
    const created = (await response.json()) as BlogNodeDetail;
    setNodes((current) => [...current, created]);
    if (parentId) setExpanded((current) => new Set(current).add(parentId));
    await selectNode(created);
    return true;
  }

  async function saveDocument(publishState = document?.is_published ?? false) {
    if (!document) return;
    setSaving(true);
    setNotice({ tone: "idle", message: "" });
    try {
      const response = await fetch(
        `${blogApiBaseUrl}/api/v1/admin/blog/nodes/${document.id}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: document.name,
            slug: document.slug,
            content: document.content,
            is_published: publishState,
          }),
        },
      );
      if (!response.ok) throw new Error(await readApiError(response));
      const saved = (await response.json()) as BlogNodeDetail;
      setDocument(saved);
      setNodes((current) =>
        current.map((node) => (node.id === saved.id ? saved : node)),
      );
      setNotice({
        tone: "success",
        message: publishState ? "文章已发布，普通用户现在可以在博客列表中看到" : "草稿已保存，仅管理员可见",
      });
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelected() {
    if (!selectedId) return;
    const selected = nodes.find((node) => node.id === selectedId);
    if (!selected || !window.confirm(`确定删除“${selected.name}”及其全部内容吗？`)) return;
    const response = await fetch(
      `${blogApiBaseUrl}/api/v1/admin/blog/nodes/${selectedId}`,
      { method: "DELETE", credentials: "include" },
    );
    if (!response.ok) {
      setNotice({ tone: "error", message: await readApiError(response) });
      return;
    }
    await loadTree();
    setSelectedId(null);
    setDocument(null);
  }

  async function renameSelected(name: string) {
    const selected = nodes.find((node) => node.id === selectedId);
    if (!selected) return false;
    if (name === selected.name) return true;
    const response = await fetch(
      `${blogApiBaseUrl}/api/v1/admin/blog/nodes/${selected.id}`,
      {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      },
    );
    if (!response.ok) {
      setNotice({ tone: "error", message: await readApiError(response) });
      return false;
    }
    const renamed = (await response.json()) as BlogNodeDetail;
    setNodes((current) =>
      current.map((node) => (node.id === renamed.id ? renamed : node)),
    );
    setDocument((current) =>
      current?.id === renamed.id ? { ...current, name: renamed.name } : current,
    );
    return true;
  }

  async function pasteImages(files: File[]) {
    if (!document || files.length === 0) return;
    setUploading(true);
    setNotice({ tone: "idle", message: "正在上传图片…" });
    try {
      const uploads = await Promise.all(
        files.map(async (file) => ({
          file,
          result: await uploadImageToCdn(file, { biz: "blog", scene: "content" }),
        })),
      );
      const markdown = uploads
        .map(({ file, result }) => `![${file.name}](${result.url})`)
        .join("\n\n");
      insertAtCursor(markdown);
      setNotice({ tone: "success", message: "图片已上传并插入正文，请保存文章" });
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setUploading(false);
    }
  }

  function insertAtCursor(markdown: string) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? document?.content.length ?? 0;
    const end = textarea?.selectionEnd ?? start;
    setDocument((current) =>
      current
        ? {
            ...current,
            content: `${current.content.slice(0, start)}${markdown}${current.content.slice(end)}`,
          }
        : current,
    );
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + markdown.length, start + markdown.length);
    });
  }

  async function submitNameDialog(name: string) {
    if (!nameDialog) return;
    let succeeded = false;
    if (nameDialog.action === "create") {
      succeeded = await createNode(nameDialog.kind, name);
    } else {
      succeeded = await renameSelected(name);
    }
    if (succeeded) setNameDialog(null);
  }

  const tree = buildBlogTree(nodes);
  return (
    <div className="grid min-h-[calc(100vh-8rem)] overflow-hidden rounded-3xl border bg-background/90 lg:grid-cols-[280px_minmax(0,1fr)]">
      <aside className="border-b bg-white/55 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between border-b p-3">
          <p className="px-2 text-sm font-semibold">博客文件</p>
          <div className="flex gap-1">
            <Button size="icon-sm" variant="ghost" title="新建文件夹" onClick={() => setNameDialog({ action: "create", kind: "folder", initialValue: "" })}><FolderPlus /></Button>
            <Button size="icon-sm" variant="ghost" title="新建文章" onClick={() => setNameDialog({ action: "create", kind: "document", initialValue: "" })}><FilePlus2 /></Button>
            <Button size="icon-sm" variant="ghost" title="重命名" disabled={!selectedId} onClick={() => { const selected = nodes.find((node) => node.id === selectedId); if (selected) setNameDialog({ action: "rename", kind: selected.kind, initialValue: selected.name }); }}><Pencil /></Button>
            <Button size="icon-sm" variant="ghost" title="删除" disabled={!selectedId} onClick={() => void deleteSelected()}><Trash2 /></Button>
          </div>
        </div>
        <div className="max-h-[calc(100vh-12rem)] overflow-auto p-2">
          {loading ? <p className="p-3 text-sm text-muted-foreground">读取目录中…</p> : null}
          {!loading && tree.length === 0 ? <p className="p-3 text-sm text-muted-foreground">新建文件夹或文章开始写作。</p> : null}
          <AdminTree nodes={tree} selectedId={selectedId} expanded={expanded} onSelect={(node) => void selectNode(node)} />
        </div>
      </aside>

      <section className="min-w-0">
        {document ? (
          <>
            <div className="grid gap-3 border-b p-4 md:grid-cols-[1fr_240px_auto]">
              <Input value={document.name} aria-label="文章标题" onChange={(event) => setDocument((current) => current ? { ...current, name: event.target.value } : current)} />
              <Input value={document.slug ?? ""} aria-label="文章地址" placeholder="article-slug" onChange={(event) => setDocument((current) => current ? { ...current, slug: event.target.value } : current)} />
              <div className="flex items-center gap-2">
                {document.is_published ? (
                  <Button variant="outline" disabled={saving} onClick={() => void saveDocument(false)}>转为草稿</Button>
                ) : (
                  <Button variant="outline" disabled={saving} onClick={() => void saveDocument(false)}>保存草稿</Button>
                )}
                <Button disabled={saving} onClick={() => void saveDocument(true)}>
                  <Save />{saving ? "处理中" : document.is_published ? "保存更新" : "发布文章"}
                </Button>
              </div>
            </div>
            <div className="grid min-h-[650px] xl:grid-cols-2">
              <div className="relative border-b xl:border-b-0 xl:border-r">
                <Textarea ref={textareaRef} value={document.content} onChange={(event) => setDocument((current) => current ? { ...current, content: event.target.value } : current)} onPaste={(event) => { const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (files.length) { event.preventDefault(); void pasteImages(files); } }} className="h-full min-h-[650px] resize-none rounded-none border-0 bg-transparent p-6 font-mono text-sm leading-7 shadow-none focus-visible:ring-0" placeholder="# 从这里开始写 Markdown…" />
                <span className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-1 rounded-lg border bg-background/90 px-2 py-1 text-xs text-muted-foreground"><ImagePlus className="size-3" />{uploading ? "上传中…" : "可直接粘贴图片"}</span>
              </div>
              <div className="min-w-0 overflow-auto bg-white/45 p-6"><MarkdownContent content={document.content || "*预览会显示在这里*"} /></div>
            </div>
          </>
        ) : (
          <div className="grid min-h-[650px] place-items-center p-10 text-center text-muted-foreground"><div><FileText className="mx-auto size-10 opacity-40" /><p className="mt-4">从左侧选择文章开始编辑</p></div></div>
        )}
        {notice.message ? <div className={`border-t px-5 py-3 text-sm ${notice.tone === "error" ? "text-destructive" : notice.tone === "success" ? "text-primary" : "text-muted-foreground"}`}>{notice.message}</div> : null}
      </section>
      {nameDialog ? (
        <NameDialog
          state={nameDialog}
          onClose={() => setNameDialog(null)}
          onSubmit={submitNameDialog}
        />
      ) : null}
    </div>
  );
}

function NameDialog({
  state,
  onClose,
  onSubmit,
}: {
  state: NameDialogState;
  onClose: () => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState(state.initialValue);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const isFolder = state.kind === "folder";
  const isRename = state.action === "rename";

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = value.trim();
    if (!name) {
      setError(isFolder ? "请输入文件夹名称" : "请输入文章标题");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(name);
    } finally {
      setSubmitting(false);
    }
  }

  const title = isRename
    ? `重命名${isFolder ? "文件夹" : "文章"}`
    : `新建${isFolder ? "文件夹" : "文章"}`;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/25 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md overflow-hidden rounded-3xl border border-border/80 bg-background shadow-2xl shadow-slate-900/15"
      >
        <form onSubmit={handleSubmit}>
          <div className="flex items-start gap-4 px-6 pb-4 pt-6">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
              {isFolder ? <FolderPlus className="size-5" /> : <FilePlus2 className="size-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-xl font-semibold tracking-tight">{title}</h2>
              <p id={descriptionId} className="mt-1 text-sm leading-6 text-muted-foreground">
                {isFolder ? "用清晰的分类整理你的博客内容。" : "先写下标题，创建后即可开始编辑 Markdown。"}
              </p>
            </div>
            <Button type="button" size="icon-sm" variant="ghost" aria-label="关闭" onClick={onClose}>
              <X />
            </Button>
          </div>
          <div className="px-6 pb-6">
            <label htmlFor={`${titleId}-input`} className="mb-2 block text-sm font-medium">
              {isFolder ? "文件夹名称" : "文章标题"}
            </label>
            <Input
              id={`${titleId}-input`}
              autoFocus
              value={value}
              maxLength={120}
              placeholder={isFolder ? "例如：LangChain 学习" : "例如：我的第一个 Agent 项目"}
              aria-invalid={Boolean(error)}
              onChange={(event) => {
                setValue(event.target.value);
                if (error) setError("");
              }}
              className="h-12 rounded-xl px-4"
            />
            <div className="mt-2 flex min-h-5 justify-between gap-3 text-xs">
              <span className="text-destructive">{error}</span>
              <span className="ml-auto text-muted-foreground">{value.length}/120</span>
            </div>
          </div>
          <div className="flex justify-end gap-3 border-t bg-muted/35 px-6 py-4">
            <Button type="button" variant="outline" onClick={onClose}>取消</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "处理中…" : isRename ? "保存名称" : "立即创建"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AdminTree({ nodes, selectedId, expanded, onSelect }: { nodes: BlogTreeNode[]; selectedId: string | null; expanded: Set<string>; onSelect: (node: BlogTreeNode) => void }) {
  return <ul>{nodes.map((node) => { const open = expanded.has(node.id); return <li key={node.id}><button type="button" onClick={() => onSelect(node)} className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-sm ${selectedId === node.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{node.kind === "folder" ? open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" /> : <span className="w-3.5" />}{node.kind === "folder" ? <Folder className="size-4 text-primary" /> : <FileText className="size-4" />}<span className="truncate">{node.name}</span>{node.kind === "document" && node.is_published ? <span className="ml-auto size-1.5 rounded-full bg-emerald-500" /> : null}</button>{node.kind === "folder" && open ? <div className="ml-4 border-l pl-1"><AdminTree nodes={node.children} selectedId={selectedId} expanded={expanded} onSelect={onSelect} /></div> : null}</li>; })}</ul>;
}

async function readApiError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { detail?: string; message?: string } | null;
  return payload?.detail ?? payload?.message ?? "操作失败";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}
