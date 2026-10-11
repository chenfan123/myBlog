import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MarkdownContent } from "@/components/blog/markdown-content";
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
  return <><SiteHeader activePath="blog" /><main className="mx-auto min-h-screen max-w-[1180px] px-5 py-10 sm:px-8 lg:px-12 lg:py-16"><header className="mx-auto max-w-3xl border-b border-black/12 pb-10"><Button asChild size="sm" variant="ghost" className="-ml-3"><Link href="/blog">← 返回博客目录</Link></Button><p className="mt-10 font-mono text-[11px] uppercase tracking-[0.2em] text-primary">Engineering note</p><h1 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.045em] sm:text-6xl">{post.name}</h1><p className="mt-6 text-sm text-muted-foreground">更新于 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date(post.updated_at))} · 陈健华</p></header><article className="mx-auto mt-12 max-w-3xl"><MarkdownContent content={post.content} /></article><BlogEngagementPanel slug={post.slug!} /></main></>;
}
