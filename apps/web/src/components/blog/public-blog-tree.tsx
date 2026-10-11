"use client";

import {
  ArrowUpRight,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { countBlogDocuments, type BlogTreeNode } from "@/lib/blog";
import { cn } from "@/lib/utils";

type ArticleEntry = { node: BlogTreeNode; path: string[] };

export function PublicBlogDirectory({ nodes }: { nodes: BlogTreeNode[] }) {
  return (
    <nav aria-label="博客目录" className="flex flex-wrap gap-2">
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <a
            key={node.id}
            href={`#category-${node.id}`}
            className="group inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground transition-all hover:border-primary/35 hover:bg-primary/8 hover:text-foreground"
          >
            <FolderOpen className="size-4 text-primary" />
            <span>{node.name}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] group-hover:bg-background">
              {countBlogDocuments(node)}
            </span>
          </a>
        ) : (
          <Link
            key={node.id}
            href={`/blog/${node.slug}`}
            className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground transition-all hover:border-primary/35 hover:bg-primary/8 hover:text-foreground"
          >
            <FileText className="size-4" />
            {node.name}
          </Link>
        ),
      )}
    </nav>
  );
}

export function PublicBlogTree({ nodes }: { nodes: BlogTreeNode[] }) {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(nodes.filter((node) => node.kind === "folder").map((node) => node.id)),
  );
  const filteredNodes = useMemo(() => filterTree(nodes, query), [nodes, query]);
  const visibleEntries = useMemo(
    () => collectVisibleArticles(filteredNodes, expanded, Boolean(query.trim())),
    [expanded, filteredNodes, query],
  );
  const visibleIndex = useMemo(
    () => new Map(visibleEntries.map((entry, index) => [entry.node.id, index])),
    [visibleEntries],
  );
  const [activeId, setActiveId] = useState(visibleEntries[0]?.node.id ?? "");
  const effectiveActiveId = visibleEntries.some(({ node }) => node.id === activeId)
    ? activeId
    : (visibleEntries[0]?.node.id ?? "");

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.matches("input, textarea, [contenteditable='true']");
      if (event.key === "/" && !editing) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (editing || !visibleEntries.length) return;
      const current = Math.max(
        0,
        visibleEntries.findIndex(({ node }) => node.id === effectiveActiveId),
      );
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setActiveId(
          visibleEntries[Math.min(current + 1, visibleEntries.length - 1)].node.id,
        );
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setActiveId(visibleEntries[Math.max(current - 1, 0)].node.id);
      } else if (event.key === "Enter") {
        const slug = visibleEntries[current]?.node.slug;
        if (slug) router.push(`/blog/${slug}`);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [effectiveActiveId, router, visibleEntries]);

  useEffect(() => {
    document
      .querySelector(`[data-article-id="${effectiveActiveId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [effectiveActiveId]);

  const toggleFolder = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      <div className="mb-8 flex flex-col gap-3 border-y border-black/10 py-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex h-11 w-full max-w-md items-center gap-3 rounded-xl border bg-card px-4 focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-primary/10">
          <Search className="size-4 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文章或文件夹"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            /
          </kbd>
        </label>
        <p className="text-xs text-muted-foreground">
          <kbd className="font-mono">J K</kbd> 选择 ·{" "}
          <kbd className="font-mono">Enter</kbd> 阅读
        </p>
      </div>

      {filteredNodes.length ? (
        <div className="space-y-5">
          {filteredNodes.map((node) =>
            node.kind === "folder" ? (
              <FolderBranch
                key={node.id}
                node={node}
                depth={0}
                path={[]}
                forceExpanded={Boolean(query.trim())}
                expanded={expanded}
                visibleIndex={visibleIndex}
                activeId={effectiveActiveId}
                onToggle={toggleFolder}
                onActivate={setActiveId}
              />
            ) : (
              <div key={node.id} className="overflow-hidden rounded-2xl border bg-card/75">
                <ArticleRow
                  entry={{ node, path: [] }}
                  index={visibleIndex.get(node.id) ?? 0}
                  active={node.id === effectiveActiveId}
                  onActivate={() => setActiveId(node.id)}
                />
              </div>
            ),
          )}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed py-16 text-center text-sm text-muted-foreground">
          没有找到与“{query}”相关的文章或文件夹
        </div>
      )}
    </div>
  );
}

function FolderBranch({
  node,
  depth,
  path,
  forceExpanded,
  expanded,
  visibleIndex,
  activeId,
  onToggle,
  onActivate,
}: {
  node: BlogTreeNode;
  depth: number;
  path: string[];
  forceExpanded: boolean;
  expanded: Set<string>;
  visibleIndex: Map<string, number>;
  activeId: string;
  onToggle: (id: string) => void;
  onActivate: (id: string) => void;
}) {
  const open = forceExpanded || expanded.has(node.id);
  const articles = node.children.filter((child) => child.kind === "document");
  const folders = node.children.filter((child) => child.kind === "folder");
  const currentPath = depth === 0 ? [] : [...path, node.name];

  return (
    <section
      id={depth === 0 ? `category-${node.id}` : undefined}
      className={cn("scroll-mt-24", depth > 0 && "ml-3 border-l pl-3 sm:ml-6 sm:pl-6")}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => onToggle(node.id)}
        className={cn(
          "group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-primary/[0.06]",
          depth === 0 && "border-b border-black/10 px-0 pb-4 hover:bg-transparent",
        )}
      >
        <span className={cn("grid place-items-center rounded-xl bg-primary/10 text-primary", depth === 0 ? "size-10" : "size-8")}>
          {open ? <FolderOpen className="size-4" /> : <Folder className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          {depth === 0 ? <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-primary">Knowledge folder</span> : null}
          <span className={cn("block truncate font-semibold", depth === 0 ? "mt-1 text-xl" : "text-sm")}>{node.name}</span>
        </span>
        <span className="text-xs text-muted-foreground">{countBlogDocuments(node)} 篇</span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className={cn("mt-3", depth === 0 && "space-y-3")}>
          {articles.length ? (
            <div className="overflow-hidden rounded-2xl border bg-card/75">
              {articles.map((article) => (
                <ArticleRow
                  key={article.id}
                  entry={{ node: article, path: currentPath }}
                  index={visibleIndex.get(article.id) ?? 0}
                  active={article.id === activeId}
                  onActivate={() => onActivate(article.id)}
                />
              ))}
            </div>
          ) : null}
          {folders.map((folder) => (
            <FolderBranch
              key={folder.id}
              node={folder}
              depth={depth + 1}
              path={currentPath}
              forceExpanded={forceExpanded}
              expanded={expanded}
              visibleIndex={visibleIndex}
              activeId={activeId}
              onToggle={onToggle}
              onActivate={onActivate}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ArticleRow({
  entry,
  index,
  active,
  onActivate,
}: {
  entry: ArticleEntry;
  index: number;
  active: boolean;
  onActivate: () => void;
}) {
  const { node, path } = entry;
  return (
    <Link
      data-article-id={node.id}
      href={`/blog/${node.slug}`}
      onMouseEnter={onActivate}
      onFocus={onActivate}
      className={cn(
        "group grid min-h-24 grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 border-b px-4 py-5 transition-colors last:border-b-0 sm:grid-cols-[64px_minmax(0,1fr)_150px_44px] sm:px-6",
        active ? "bg-primary text-white" : "hover:bg-primary/[0.055]",
      )}
    >
      <span className={cn("font-mono text-xs", active ? "text-white/65" : "text-muted-foreground")}>
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="min-w-0">
        {path.length ? <p className={cn("truncate font-mono text-[10px] uppercase tracking-[0.15em]", active ? "text-white/70" : "text-primary")}>{path.join(" / ")}</p> : null}
        <h3 className={cn("truncate text-base font-semibold sm:text-lg", path.length && "mt-1.5", active && "text-white")}>{node.name}</h3>
      </div>
      <span className={cn("hidden font-mono text-[10px] sm:block", active ? "text-white/65" : "text-muted-foreground")}>{formatDate(node.updated_at)}</span>
      <span className={cn("grid size-9 place-items-center rounded-full border transition-colors", active ? "border-white/35 bg-white/15 text-white [&_svg]:stroke-white" : "bg-background text-muted-foreground group-hover:border-primary/35 group-hover:bg-primary group-hover:text-white group-hover:[&_svg]:stroke-white")}><ArrowUpRight className="size-4" /></span>
    </Link>
  );
}

function filterTree(nodes: BlogTreeNode[], query: string): BlogTreeNode[] {
  const keyword = query.trim().toLocaleLowerCase("zh-CN");
  if (!keyword) return nodes;
  return nodes.flatMap((node) => {
    const children = filterTree(node.children, query);
    const matches = node.name.toLocaleLowerCase("zh-CN").includes(keyword);
    if (!matches && !children.length) return [];
    return [{ ...node, children: matches ? node.children : children }];
  });
}

function collectVisibleArticles(
  nodes: BlogTreeNode[],
  expanded: Set<string>,
  forceExpanded: boolean,
  path: string[] = [],
): ArticleEntry[] {
  return nodes.flatMap((node) => {
    if (node.kind === "document") return [{ node, path }];
    if (!forceExpanded && !expanded.has(node.id)) return [];
    return collectVisibleArticles(node.children, expanded, forceExpanded, [...path, node.name]);
  });
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
