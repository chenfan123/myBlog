"use client";

import {
  Bold,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Code2,
  FilePlus2,
  FileText,
  Folder,
  FolderPlus,
  GripVertical,
  Heading1,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  LoaderCircle,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  MoreHorizontal,
  Palette,
  Pencil,
  Quote,
  Save,
  Strikethrough,
  Table2,
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
  type MarkdownTheme,
} from "@/lib/blog";
import { uploadImageToCdn } from "@/lib/cdn-upload";

type Notice = { tone: "error" | "success" | "idle"; message: string };
type AutoSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";
type EditorPane = "write" | "preview" | "split";
type ContextMenuState = { nodeId: string; x: number; y: number };
type DropState = { nodeId: string; position: "before" | "after" | "inside" };
type NameDialogState =
  | { action: "create"; kind: BlogNodeKind; initialValue: "" }
  | { action: "rename"; kind: BlogNodeKind; initialValue: string };

const MARKDOWN_THEMES: Array<{ value: MarkdownTheme; label: string }> = [
  { value: "editorial", label: "编辑绿" },
  { value: "github", label: "GitHub" },
  { value: "smartblue", label: "Smart Blue" },
  { value: "cyanosis", label: "青色" },
  { value: "fancy", label: "典雅" },
  { value: "night-purple", label: "夜紫" },
];

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
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("idle");
  const [editorPane, setEditorPane] = useState<EditorPane>("split");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropState, setDropState] = useState<DropState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSavedSignatureRef = useRef("");
  const activeDocumentIdRef = useRef<string | null>(null);
  const saveDocumentRef = useRef<(publishState?: boolean) => Promise<void>>(async () => {});
  saveDocumentRef.current = saveDocument;

  useEffect(() => {
    void loadTree();
  }, []);

  function changeMarkdownTheme(theme: MarkdownTheme) {
    setDocument((current) => current ? { ...current, markdown_theme: theme } : current);
  }

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!document) return;
    const signature = editorSignature(document);
    if (!lastSavedSignatureRef.current || signature === lastSavedSignatureRef.current) return;
    setAutoSaveStatus("dirty");
    const snapshot = document;
    const timer = window.setTimeout(async () => {
      setAutoSaveStatus("saving");
      try {
        const response = await fetch(`${blogApiBaseUrl}/api/v1/admin/blog/nodes/${snapshot.id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: snapshot.name, slug: snapshot.slug, content: snapshot.content, markdown_theme: snapshot.markdown_theme }),
        });
        if (!response.ok) throw new Error(await readApiError(response));
        const saved = (await response.json()) as BlogNodeDetail;
        setNodes((current) => current.map((node) => node.id === saved.id ? saved : node));
        if (activeDocumentIdRef.current !== saved.id) return;
        lastSavedSignatureRef.current = editorSignature(saved);
        setDocument((current) => {
          if (!current || current.id !== saved.id) return current;
          if (editorSignature(current) !== signature) return { ...current, updated_at: saved.updated_at };
          return saved;
        });
        setAutoSaveStatus("saved");
      } catch (error) {
        if (activeDocumentIdRef.current !== snapshot.id) return;
        setAutoSaveStatus("error");
        setNotice({ tone: "error", message: `自动保存失败：${getErrorMessage(error)}` });
      }
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [document]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      if (document) void saveDocumentRef.current(document.is_published);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [document]);

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
      activeDocumentIdRef.current = null;
      setDocument(null);
      toggleFolder(node.id);
      return;
    }
    activeDocumentIdRef.current = node.id;
    const response = await fetch(
      `${blogApiBaseUrl}/api/v1/admin/blog/nodes/${node.id}`,
      { credentials: "include", cache: "no-store" },
    );
    if (!response.ok) {
      setNotice({ tone: "error", message: "无法读取文章" });
      return;
    }
    const detail = (await response.json()) as BlogNodeDetail;
    if (activeDocumentIdRef.current !== node.id) return;
    lastSavedSignatureRef.current = editorSignature(detail);
    setAutoSaveStatus("saved");
    setDocument(detail);
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
    const snapshot = document;
    setSaving(true);
    setNotice({ tone: "idle", message: "" });
    try {
      const response = await fetch(
        `${blogApiBaseUrl}/api/v1/admin/blog/nodes/${snapshot.id}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: snapshot.name,
            slug: snapshot.slug,
            content: snapshot.content,
            markdown_theme: snapshot.markdown_theme,
            is_published: publishState,
          }),
        },
      );
      if (!response.ok) throw new Error(await readApiError(response));
      const saved = (await response.json()) as BlogNodeDetail;
      setNodes((current) =>
        current.map((node) => (node.id === saved.id ? saved : node)),
      );
      if (activeDocumentIdRef.current !== saved.id) return;
      lastSavedSignatureRef.current = editorSignature(saved);
      setAutoSaveStatus("saved");
      setDocument(saved);
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
    activeDocumentIdRef.current = null;
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

  async function reorderNodes(sourceId: string, targetId: string, position: DropState["position"]) {
    if (sourceId === targetId) return;
    const source = nodes.find((node) => node.id === sourceId);
    const target = nodes.find((node) => node.id === targetId);
    if (!source || !target) return;
    const nextParentId = position === "inside" && target.kind === "folder" ? target.id : target.parent_id;
    if (source.kind === "folder" && nextParentId && isDescendant(nodes, nextParentId, source.id)) {
      setNotice({ tone: "error", message: "文件夹不能移动到自己的子目录" });
      return;
    }

    const previousNodes = nodes;
    const sourceSiblings = nodes
      .filter((node) => node.parent_id === source.parent_id && node.id !== source.id)
      .toSorted(compareBlogNodes);
    const destinationSiblings = (source.parent_id === nextParentId ? sourceSiblings : nodes
      .filter((node) => node.parent_id === nextParentId && node.id !== source.id))
      .toSorted(compareBlogNodes);
    const targetIndex = destinationSiblings.findIndex((node) => node.id === target.id);
    const insertIndex = position === "inside"
      ? destinationSiblings.length
      : Math.max(0, targetIndex + (position === "after" ? 1 : 0));
    destinationSiblings.splice(insertIndex, 0, { ...source, parent_id: nextParentId });

    const positions = new Map<string, { parent_id: string | null; sort_order: number }>();
    destinationSiblings.forEach((node, index) => positions.set(node.id, { parent_id: nextParentId, sort_order: index * 10 }));
    if (source.parent_id !== nextParentId) {
      sourceSiblings.forEach((node, index) => positions.set(node.id, { parent_id: source.parent_id, sort_order: index * 10 }));
    }
    const optimistic = nodes.map((node) => {
      const next = positions.get(node.id);
      return next ? { ...node, ...next } : node;
    });
    setNodes(optimistic);
    if (nextParentId) setExpanded((current) => new Set(current).add(nextParentId));

    try {
      const response = await fetch(`${blogApiBaseUrl}/api/v1/admin/blog/reorder`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: Array.from(positions, ([id, value]) => ({ id, ...value })),
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response));
      setNotice({ tone: "success", message: nextParentId === source.parent_id ? "排序已保存" : "文件已移动并保存" });
    } catch (error) {
      setNodes(previousNodes);
      setNotice({ tone: "error", message: getErrorMessage(error) });
    }
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

  function replaceSelection(
    transform: (selection: string) => string,
    placeholder = "文本",
  ) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? document?.content.length ?? 0;
    const end = textarea?.selectionEnd ?? start;
    const selection = document?.content.slice(start, end) || placeholder;
    const markdown = transform(selection);
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
      textarea?.setSelectionRange(start, start + markdown.length);
    });
  }

  function prefixSelectedLines(prefix: string, placeholder = "列表项") {
    replaceSelection(
      (selection) => selection.split("\n").map((line, index) => `${prefix.replace("{n}", String(index + 1))}${line}`).join("\n"),
      placeholder,
    );
  }

  function handleEditorKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!document) return;
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const modifier = event.metaKey || event.ctrlKey;

    if (modifier) {
      const shortcut = `${event.altKey ? "alt+" : ""}${event.shiftKey ? "shift+" : ""}${event.code}`;
      const actions: Record<string, () => void> = {
        KeyB: () => replaceSelection((value) => `**${value}**`, "加粗文本"),
        KeyI: () => replaceSelection((value) => `*${value}*`, "斜体文本"),
        KeyK: () => replaceSelection((value) => `[${value}](https://)`, "链接文字"),
        KeyE: () => replaceSelection((value) => `\`${value}\``, "代码"),
        "shift+KeyX": () => replaceSelection((value) => `~~${value}~~`, "删除线文本"),
        "alt+Digit1": () => prefixSelectedLines("# ", "一级标题"),
        "alt+Digit2": () => prefixSelectedLines("## ", "二级标题"),
        "shift+Digit7": () => prefixSelectedLines("{n}. "),
        "shift+Digit8": () => prefixSelectedLines("- "),
        "shift+Digit9": () => prefixSelectedLines("> ", "引用内容"),
        "alt+KeyC": () => replaceSelection((value) => `\n\`\`\`text\n${value}\n\`\`\`\n`, "代码块"),
      };
      const action = actions[shortcut];
      if (action) {
        event.preventDefault();
        action();
        return;
      }
    }

    if (event.key === "Enter" && start === end) {
      const lineStart = document.content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const currentLine = document.content.slice(lineStart, start);
      const listMatch = currentLine.match(/^(\s*)([-+*]|\d+[.)])\s+(\[(?: |x|X)\]\s+)?(.*)$/);
      const quoteMatch = currentLine.match(/^(\s*>\s?)(.*)$/);
      if (listMatch) {
        event.preventDefault();
        const [, indentation, marker, taskMarker, value] = listMatch;
        if (!value.trim()) {
          const nextContent = `${document.content.slice(0, lineStart)}${indentation}${document.content.slice(start)}`;
          updateEditorContent(nextContent, lineStart + indentation.length);
          return;
        }
        const nextMarker = /^\d/.test(marker)
          ? marker.replace(/\d+/, (number) => String(Number(number) + 1))
          : marker;
        const continuation = `\n${indentation}${nextMarker} ${taskMarker ? "[ ] " : ""}`;
        const nextContent = `${document.content.slice(0, start)}${continuation}${document.content.slice(end)}`;
        updateEditorContent(nextContent, start + continuation.length);
        return;
      }
      if (quoteMatch) {
        event.preventDefault();
        const [, prefix, value] = quoteMatch;
        const continuation = value.trim() ? `\n${prefix}` : "\n";
        const replaceStart = value.trim() ? start : lineStart;
        const nextContent = `${document.content.slice(0, replaceStart)}${continuation}${document.content.slice(end)}`;
        updateEditorContent(nextContent, replaceStart + continuation.length);
        return;
      }
    }

    if (event.key !== "Tab") return;
    event.preventDefault();
    const lineStart = document.content.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEndIndex = document.content.indexOf("\n", end);
    const lineEnd = lineEndIndex === -1 ? document.content.length : lineEndIndex;
    const selectedLines = document.content.slice(lineStart, lineEnd);
    const indent = "  ";
    const replacement = event.shiftKey
      ? selectedLines.replace(/^(?: {1,2}|\t)/gm, "")
      : selectedLines.replace(/^/gm, indent);
    const nextContent = `${document.content.slice(0, lineStart)}${replacement}${document.content.slice(lineEnd)}`;
    const originalFirstLine = selectedLines.split("\n", 1)[0];
    const replacementFirstLine = replacement.split("\n", 1)[0];
    const firstLineDelta = replacementFirstLine.length - originalFirstLine.length;
    const totalDelta = replacement.length - selectedLines.length;
    setDocument((current) => current ? { ...current, content: nextContent } : current);
    requestAnimationFrame(() => {
      textarea.focus();
      const nextStart = Math.max(lineStart, start + firstLineDelta);
      const nextEnd = Math.max(nextStart, end + totalDelta);
      textarea.setSelectionRange(nextStart, nextEnd);
    });

    function updateEditorContent(content: string, cursor: number) {
      setDocument((current) => current ? { ...current, content } : current);
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(cursor, cursor);
      });
    }
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
    <div className="grid h-[calc(100dvh-12rem)] min-h-[620px] grid-rows-[minmax(180px,32%)_minmax(0,1fr)] overflow-hidden rounded-[1.5rem] border border-black/10 bg-[#fffefa] shadow-[0_30px_80px_-55px_rgba(20,35,20,.35)] lg:grid-cols-[300px_minmax(0,1fr)] lg:grid-rows-1">
      <aside className="flex min-h-0 flex-col border-b bg-white/55 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between border-b p-3">
          <div className="min-w-0 px-2">
            <p className="text-sm font-semibold">内容空间</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{nodes.length} 个文件与目录</p>
          </div>
          <div className="flex gap-1">
            <Button size="icon-sm" variant="ghost" title="新建文件夹" onClick={() => setNameDialog({ action: "create", kind: "folder", initialValue: "" })}><FolderPlus /></Button>
            <Button size="icon-sm" variant="ghost" title="新建文章" onClick={() => setNameDialog({ action: "create", kind: "document", initialValue: "" })}><FilePlus2 /></Button>
            <Button size="icon-sm" variant="ghost" title="重命名" disabled={!selectedId} onClick={() => { const selected = nodes.find((node) => node.id === selectedId); if (selected) setNameDialog({ action: "rename", kind: selected.kind, initialValue: selected.name }); }}><Pencil /></Button>
            <Button size="icon-sm" variant="ghost" title="删除" disabled={!selectedId} onClick={() => void deleteSelected()}><Trash2 /></Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {loading ? <p className="p-3 text-sm text-muted-foreground">读取目录中…</p> : null}
          {!loading && tree.length === 0 ? <p className="p-3 text-sm text-muted-foreground">新建文件夹或文章开始写作。</p> : null}
          <AdminTree
            nodes={tree}
            selectedId={selectedId}
            expanded={expanded}
            draggedId={draggedId}
            dropState={dropState}
            onSelect={(node) => void selectNode(node)}
            onContextMenu={(node, x, y) => {
              setSelectedId(node.id);
              setContextMenu({ nodeId: node.id, x, y });
            }}
            onDragStart={setDraggedId}
            onDragOver={setDropState}
            onDrop={(targetId, position) => {
              if (draggedId) void reorderNodes(draggedId, targetId, position);
              setDraggedId(null);
              setDropState(null);
            }}
            onDragEnd={() => {
              setDraggedId(null);
              setDropState(null);
            }}
          />
        </div>
      </aside>

      <section className="grid min-h-0 min-w-0 grid-rows-[auto_auto_minmax(0,1fr)_auto] overflow-hidden">
        {document ? (
          <>
            <div className="grid gap-3 border-b border-black/10 p-4 md:grid-cols-[1fr_220px_auto]">
              <Input value={document.name} aria-label="文章标题" onChange={(event) => setDocument((current) => current ? { ...current, name: event.target.value } : current)} />
              <Input value={document.slug ?? ""} aria-label="文章地址" placeholder="article-slug" onChange={(event) => setDocument((current) => current ? { ...current, slug: event.target.value } : current)} />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <AutoSaveIndicator status={autoSaveStatus} />
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
            <div className="flex items-center justify-between border-b border-black/10 bg-[#f7f6f0] px-4 py-2 xl:hidden">
              <div className="flex rounded-lg border border-black/10 bg-white p-0.5 text-xs">
                <button className={`rounded-md px-3 py-1.5 ${editorPane === "write" ? "bg-[#172019] text-white" : "text-muted-foreground"}`} onClick={() => setEditorPane("write")}>编写</button>
                <button className={`rounded-md px-3 py-1.5 ${editorPane === "preview" ? "bg-[#172019] text-white" : "text-muted-foreground"}`} onClick={() => setEditorPane("preview")}>预览</button>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{document.content.length} 字符 · ⌘/Ctrl + S 保存</span>
            </div>
            <MarkdownToolbar
              onBold={() => replaceSelection((value) => `**${value}**`, "加粗文本")}
              onItalic={() => replaceSelection((value) => `*${value}*`, "斜体文本")}
              onStrike={() => replaceSelection((value) => `~~${value}~~`, "删除线文本")}
              onHeading1={() => prefixSelectedLines("# ", "一级标题")}
              onHeading2={() => prefixSelectedLines("## ", "二级标题")}
              onQuote={() => prefixSelectedLines("> ", "引用内容")}
              onUnorderedList={() => prefixSelectedLines("- ")}
              onOrderedList={() => prefixSelectedLines("{n}. ")}
              onTaskList={() => prefixSelectedLines("- [ ] ", "待办事项")}
              onInlineCode={() => replaceSelection((value) => `\`${value}\``, "代码")}
              onCodeBlock={() => replaceSelection((value) => `\n\`\`\`text\n${value}\n\`\`\`\n`, "代码块")}
              onLink={() => replaceSelection((value) => `[${value}](https://)`, "链接文字")}
              onDivider={() => insertAtCursor("\n\n---\n\n")}
              onTable={() => insertAtCursor("\n\n| 列一 | 列二 | 列三 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n\n")}
            />
            <div className={`grid min-h-0 overflow-hidden ${editorPane === "split" ? "grid-rows-2" : "grid-rows-1"} xl:grid-cols-2 xl:grid-rows-1`}>
              <div className={`relative min-h-0 flex-col overflow-hidden border-b xl:flex xl:border-b-0 xl:border-r ${editorPane === "preview" ? "hidden" : "flex"}`}>
                <div className="flex items-center justify-between border-b bg-muted/25 px-6 py-2 text-xs font-medium text-muted-foreground">
                  <span>Markdown</span><span>Enter 延续列表 · Tab 调整层级 · 支持粘贴图片</span>
                </div>
                <Textarea ref={textareaRef} value={document.content} onChange={(event) => setDocument((current) => current ? { ...current, content: event.target.value } : current)} onKeyDown={handleEditorKeyDown} onPaste={(event) => { const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/")); if (files.length) { event.preventDefault(); void pasteImages(files); } }} className="min-h-0 flex-1 resize-none overflow-y-auto overscroll-contain rounded-none border-0 bg-transparent p-6 font-mono text-sm leading-7 shadow-none focus-visible:ring-0" placeholder="# 从这里开始写 Markdown…" />
                <span className="pointer-events-none absolute bottom-4 right-4 flex items-center gap-1 rounded-lg border bg-background/90 px-2 py-1 text-xs text-muted-foreground"><ImagePlus className="size-3" />{uploading ? "上传中…" : "可直接粘贴图片"}</span>
              </div>
              <div className={`markdown-preview-pane markdown-theme-${document.markdown_theme} min-h-0 min-w-0 flex-col overflow-hidden xl:flex ${editorPane === "write" ? "hidden" : "flex"}`}>
                <div className="flex shrink-0 items-center justify-between border-b border-black/8 bg-white/85 px-6 py-2.5 text-xs font-medium text-muted-foreground backdrop-blur">
                  <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-primary" />实时预览</span>
                  <label className="flex items-center gap-2" title="切换 Markdown 预览主题">
                    <Palette className="size-3.5" />
                    <span className="sr-only">Markdown 主题</span>
                    <select
                      value={document.markdown_theme}
                      onChange={(event) => changeMarkdownTheme(event.target.value as MarkdownTheme)}
                      className="h-7 rounded-md border border-black/10 bg-white px-2 text-xs font-medium text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15"
                    >
                      {MARKDOWN_THEMES.map((theme) => <option key={theme.value} value={theme.value}>{theme.label}</option>)}
                    </select>
                  </label>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-7">
                  <div className="markdown-preview-paper">
                    <MarkdownContent variant="preview" content={document.content || "*预览会显示在这里*"} />
                  </div>
                </div>
              </div>
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
      {contextMenu ? (
        <BlogContextMenu
          state={contextMenu}
          node={nodes.find((node) => node.id === contextMenu.nodeId)}
          onCreate={(kind) => {
            setContextMenu(null);
            setNameDialog({ action: "create", kind, initialValue: "" });
          }}
          onRename={() => {
            const selected = nodes.find((node) => node.id === contextMenu.nodeId);
            setContextMenu(null);
            if (selected) setNameDialog({ action: "rename", kind: selected.kind, initialValue: selected.name });
          }}
          onDelete={() => {
            setContextMenu(null);
            void deleteSelected();
          }}
        />
      ) : null}
    </div>
  );
}

type MarkdownToolbarProps = {
  onBold: () => void;
  onItalic: () => void;
  onStrike: () => void;
  onHeading1: () => void;
  onHeading2: () => void;
  onQuote: () => void;
  onUnorderedList: () => void;
  onOrderedList: () => void;
  onTaskList: () => void;
  onInlineCode: () => void;
  onCodeBlock: () => void;
  onLink: () => void;
  onDivider: () => void;
  onTable: () => void;
};

function MarkdownToolbar(props: MarkdownToolbarProps) {
  const tools = [
    { label: "一级标题", shortcut: "⌘/Ctrl+Alt+1", icon: Heading1, action: props.onHeading1 },
    { label: "二级标题", shortcut: "⌘/Ctrl+Alt+2", icon: Heading2, action: props.onHeading2 },
    { label: "加粗", shortcut: "⌘/Ctrl+B", icon: Bold, action: props.onBold },
    { label: "斜体", shortcut: "⌘/Ctrl+I", icon: Italic, action: props.onItalic },
    { label: "删除线", shortcut: "⌘/Ctrl+Shift+X", icon: Strikethrough, action: props.onStrike },
    { label: "引用", shortcut: "⌘/Ctrl+Shift+9", icon: Quote, action: props.onQuote },
    { label: "无序列表", shortcut: "⌘/Ctrl+Shift+8", icon: List, action: props.onUnorderedList },
    { label: "有序列表", shortcut: "⌘/Ctrl+Shift+7", icon: ListOrdered, action: props.onOrderedList },
    { label: "任务列表", icon: ListChecks, action: props.onTaskList },
    { label: "行内代码", shortcut: "⌘/Ctrl+E", icon: Code2, action: props.onInlineCode },
    { label: "链接", shortcut: "⌘/Ctrl+K", icon: Link2, action: props.onLink },
    { label: "表格", icon: Table2, action: props.onTable },
    { label: "分隔线", icon: Minus, action: props.onDivider },
  ] as const;

  return (
    <div className="z-20 flex flex-wrap items-center gap-1 border-b bg-background/95 px-4 py-2 shadow-sm backdrop-blur">
      <span className="mr-2 hidden text-xs font-semibold text-muted-foreground sm:inline">Markdown 工具栏</span>
      {tools.map(({ label, icon: Icon, action, ...tool }) => (
        <Button key={label} type="button" size="icon-sm" variant="ghost" title={`${label}${"shortcut" in tool ? `（${tool.shortcut}）` : ""}`} aria-label={label} onClick={action}>
          <Icon className="size-4" />
        </Button>
      ))}
      <Button type="button" size="sm" variant="ghost" title="代码块（⌘/Ctrl+Alt+C）" onClick={props.onCodeBlock}>
        <Code2 className="size-4" />
        代码块
      </Button>
      <span className="ml-auto hidden text-xs text-muted-foreground lg:inline">GFM · 表格 · 待办 · 删除线 · 自动链接</span>
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

type AdminTreeProps = {
  nodes: BlogTreeNode[];
  selectedId: string | null;
  expanded: Set<string>;
  draggedId: string | null;
  dropState: DropState | null;
  onSelect: (node: BlogTreeNode) => void;
  onContextMenu: (node: BlogTreeNode, x: number, y: number) => void;
  onDragStart: (id: string) => void;
  onDragOver: (state: DropState) => void;
  onDrop: (targetId: string, position: DropState["position"]) => void;
  onDragEnd: () => void;
};

function AdminTree(props: AdminTreeProps) {
  return (
    <ul className="space-y-0.5">
      {props.nodes.map((node) => {
        const open = props.expanded.has(node.id);
        const activeDrop = props.dropState?.nodeId === node.id ? props.dropState.position : null;
        return (
          <li key={node.id}>
            <button
              type="button"
              draggable
              onClick={() => props.onSelect(node)}
              onContextMenu={(event) => {
                event.preventDefault();
                props.onContextMenu(node, event.clientX, event.clientY);
              }}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", node.id);
                props.onDragStart(node.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const bounds = event.currentTarget.getBoundingClientRect();
                const relativeY = (event.clientY - bounds.top) / bounds.height;
                const position = node.kind === "folder" && relativeY > 0.25 && relativeY < 0.75
                  ? "inside"
                  : relativeY < 0.5 ? "before" : "after";
                props.onDragOver({ nodeId: node.id, position });
              }}
              onDrop={(event) => {
                event.preventDefault();
                props.onDrop(node.id, activeDrop ?? "after");
              }}
              onDragEnd={props.onDragEnd}
              className={`group relative flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                props.selectedId === node.id ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              } ${props.draggedId === node.id ? "opacity-40" : ""} ${activeDrop === "inside" ? "ring-1 ring-primary bg-primary/10" : ""}`}
            >
              {activeDrop === "before" ? <span className="absolute inset-x-1 -top-px h-0.5 rounded-full bg-primary" /> : null}
              {activeDrop === "after" ? <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-primary" /> : null}
              <GripVertical className="size-3.5 shrink-0 cursor-grab opacity-0 transition-opacity group-hover:opacity-50" />
              {node.kind === "folder" ? open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" /> : <span className="w-3.5" />}
              {node.kind === "folder" ? <Folder className="size-4 text-primary" /> : <FileText className="size-4" />}
              <span className="truncate">{node.name}</span>
              {node.kind === "document" && node.is_published ? <span className="ml-auto size-1.5 rounded-full bg-emerald-500" title="已发布" /> : null}
              <MoreHorizontal className="ml-auto size-3.5 opacity-0 group-hover:opacity-50" />
            </button>
            {node.kind === "folder" && open ? (
              <div className="ml-5 border-l pl-1.5">
                <AdminTree {...props} nodes={node.children} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function AutoSaveIndicator({ status }: { status: AutoSaveStatus }) {
  const content = status === "saving"
    ? { icon: LoaderCircle, label: "正在保存", className: "text-primary" }
    : status === "saved"
      ? { icon: Check, label: "已自动保存", className: "text-emerald-600" }
      : status === "error"
        ? { icon: Cloud, label: "保存失败", className: "text-destructive" }
        : { icon: Cloud, label: status === "dirty" ? "等待保存" : "云端草稿", className: "text-muted-foreground" };
  const Icon = content.icon;
  return (
    <span className={`hidden items-center gap-1.5 whitespace-nowrap text-xs md:inline-flex ${content.className}`}>
      <Icon className={`size-3.5 ${status === "saving" ? "animate-spin" : ""}`} />
      {content.label}
    </span>
  );
}

function BlogContextMenu({
  state,
  node,
  onCreate,
  onRename,
  onDelete,
}: {
  state: ContextMenuState;
  node?: BlogNodeSummary;
  onCreate: (kind: BlogNodeKind) => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  if (!node) return null;
  return (
    <div
      role="menu"
      className="fixed z-[70] min-w-48 overflow-hidden rounded-xl border bg-background/98 p-1.5 text-sm shadow-2xl shadow-foreground/15 backdrop-blur"
      style={{ left: Math.min(state.x, window.innerWidth - 210), top: Math.min(state.y, window.innerHeight - 220) }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {node.kind === "folder" ? (
        <>
          <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted" onClick={() => onCreate("document")}><FilePlus2 className="size-4" />新建文章</button>
          <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted" onClick={() => onCreate("folder")}><FolderPlus className="size-4" />新建子文件夹</button>
          <div className="my-1 border-t" />
        </>
      ) : null}
      <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 hover:bg-muted" onClick={onRename}><Pencil className="size-4" />重命名</button>
      <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-destructive hover:bg-destructive/10" onClick={onDelete}><Trash2 className="size-4" />删除</button>
      <div className="border-t px-3 pb-1 pt-2 text-[11px] text-muted-foreground">拖拽可排序或移动到文件夹</div>
    </div>
  );
}

function editorSignature(document: Pick<BlogNodeDetail, "name" | "slug" | "content" | "markdown_theme">) {
  return JSON.stringify([document.name, document.slug, document.content, document.markdown_theme]);
}

function compareBlogNodes(left: BlogNodeSummary, right: BlogNodeSummary) {
  return left.sort_order - right.sort_order || left.name.localeCompare(right.name, "zh-CN");
}

function isDescendant(nodes: BlogNodeSummary[], candidateId: string, ancestorId: string) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(candidateId);
  while (current?.parent_id) {
    if (current.parent_id === ancestorId) return true;
    current = byId.get(current.parent_id);
  }
  return false;
}

async function readApiError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { detail?: string; message?: string } | null;
  return payload?.detail ?? payload?.message ?? "操作失败";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败";
}
