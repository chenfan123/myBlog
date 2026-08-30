import { ArrowUpRight, FileText, FolderOpen } from "lucide-react";
import Link from "next/link";

import type { BlogTreeNode } from "@/lib/blog";

type ArticleEntry = {
  node: BlogTreeNode;
  path: string[];
};

export function PublicBlogDirectory({ nodes }: { nodes: BlogTreeNode[] }) {
  return (
    <nav aria-label="博客目录" className="flex flex-wrap gap-2">
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <a key={node.id} href={`#category-${node.id}`} className="group inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground transition-all hover:border-primary/35 hover:bg-primary/8 hover:text-foreground">
            <FolderOpen className="size-4 text-primary" />
            <span>{node.name}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] group-hover:bg-background">{countDocuments(node)}</span>
          </a>
        ) : (
          <Link key={node.id} href={`/blog/${node.slug}`} className="inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm text-muted-foreground transition-all hover:border-primary/35 hover:bg-primary/8 hover:text-foreground">
            <FileText className="size-4" />{node.name}
          </Link>
        ),
      )}
    </nav>
  );
}

export function PublicBlogTree({ nodes }: { nodes: BlogTreeNode[] }) {
  return (
    <div className="space-y-12">
      {nodes.map((node) =>
        node.kind === "folder" ? (
          <CategorySection key={node.id} node={node} />
        ) : (
          <div key={node.id} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-4">
            <ArticleCard entry={{ node, path: [] }} />
          </div>
        ),
      )}
    </div>
  );
}

function CategorySection({ node }: { node: BlogTreeNode }) {
  const articles = collectArticles(node);
  return (
    <section id={`category-${node.id}`} className="scroll-mt-24">
      <header className="mb-5 flex items-end justify-between gap-4 border-b pb-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary"><FolderOpen className="size-5" /></span>
          <div><h2 className="text-xl font-semibold tracking-tight">{node.name}</h2><p className="mt-1 text-xs text-muted-foreground">{articles.length} 篇文章</p></div>
        </div>
        <span className="text-xs text-muted-foreground">查看本分类</span>
      </header>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-4">
        {articles.map((entry) => <ArticleCard key={entry.node.id} entry={entry} />)}
      </div>
    </section>
  );
}

function ArticleCard({ entry }: { entry: ArticleEntry }) {
  const { node, path } = entry;
  return (
    <Link href={`/blog/${node.slug}`} className="group flex min-h-44 flex-col rounded-3xl border bg-card/90 p-5 shadow-sm shadow-slate-900/[0.025] transition-all duration-200 hover:-translate-y-1 hover:border-primary/40 hover:bg-primary/[0.055] hover:shadow-xl hover:shadow-primary/10 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <span className="grid size-11 place-items-center rounded-2xl border bg-background text-muted-foreground transition-colors group-hover:border-primary/30 group-hover:text-primary"><FileText className="size-5" /></span>
        <span className="grid size-9 place-items-center rounded-full border bg-background text-muted-foreground transition-all group-hover:border-primary/30 group-hover:bg-primary group-hover:text-primary-foreground"><ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></span>
      </div>
      <div className="mt-6 flex-1">
        {path.length ? <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-primary">{path.join(" / ")}</p> : null}
        <h3 className="text-lg font-semibold leading-7 tracking-tight transition-colors group-hover:text-primary">{node.name}</h3>
      </div>
      <div className="mt-5 flex items-center justify-between border-t pt-4 font-mono text-[10px] text-muted-foreground">
        <span>更新于 {formatDate(node.updated_at)}</span><span className="font-sans text-xs">阅读全文</span>
      </div>
    </Link>
  );
}

function collectArticles(node: BlogTreeNode, path: string[] = []): ArticleEntry[] {
  const articles: ArticleEntry[] = [];
  for (const child of node.children) {
    if (child.kind === "document") articles.push({ node: child, path });
    else articles.push(...collectArticles(child, [...path, child.name]));
  }
  return articles;
}

export function countDocuments(node: BlogTreeNode): number {
  if (node.kind === "document") return 1;
  return node.children.reduce((total, child) => total + countDocuments(child), 0);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
