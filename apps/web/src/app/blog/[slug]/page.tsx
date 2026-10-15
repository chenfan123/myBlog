import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MarkdownContent } from "@/components/blog/markdown-content";
import { extractMarkdownHeadings } from "@/components/blog/markdown-headings";
import { BlogEngagementPanel } from "@/components/blog/blog-engagement";
import { SiteHeader } from "@/components/site/site-header";
import { Button } from "@/components/ui/button";
import { fetchPublishedPost } from "@/lib/blog";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const post = await fetchPublishedPost((await params).slug);
  return { title: post ? `${post.name}｜CHEN.DEV` : "文章不存在｜CHEN.DEV" };
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const post = await fetchPublishedPost((await params).slug);
  if (!post) notFound();
  const headings = extractMarkdownHeadings(post.content);
  return <><SiteHeader activePath="blog" /><main className="mx-auto min-h-screen max-w-[1400px] px-5 py-10 sm:px-8 lg:px-12 lg:py-16"><header className="mx-auto max-w-3xl border-b border-black/12 pb-10"><Button asChild size="sm" variant="ghost" className="-ml-3"><Link href="/blog">← 返回博客目录</Link></Button><p className="mt-10 font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Engineering note</p><h1 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-6xl">{post.name}</h1><p className="mt-6 text-sm text-muted-foreground">更新于 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date(post.updated_at))} · 陈健华</p></header>{headings.length ? <details className="mx-auto mt-8 max-w-3xl rounded-xl border bg-background/80 p-4 lg:hidden"><summary className="cursor-pointer font-semibold">文章目录 · {headings.length} 个章节</summary><TableOfContents headings={headings} /></details> : null}<div className="lg:grid lg:grid-cols-[minmax(0,768px)_230px] lg:justify-center lg:gap-10"><article className={`markdown-public-paper markdown-themed markdown-theme-${post.markdown_theme} mt-12 min-w-0`}><MarkdownContent content={post.content} /></article>{headings.length ? <aside className="hidden lg:block"><div className="sticky top-24 mt-12 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-xl border bg-background/80 p-4 backdrop-blur"><p className="font-mono text-[10px] uppercase tracking-[0.16em] text-primary">On this page</p><TableOfContents headings={headings} /></div></aside> : null}</div><BlogEngagementPanel slug={post.slug!} /></main></>;
}

function TableOfContents({ headings }: { headings: ReturnType<typeof extractMarkdownHeadings> }) {
  return <nav aria-label="文章目录" className="mt-3"><ol className="space-y-1.5 border-l pl-3 text-sm">{headings.map((heading) => <li key={heading.id} style={{ paddingLeft: `${Math.max(0, heading.depth - 1) * 0.7}rem` }}><a href={`#${heading.id}`} className="block rounded-md py-1 text-muted-foreground transition hover:text-primary">{heading.text}</a></li>)}</ol></nav>;
}
