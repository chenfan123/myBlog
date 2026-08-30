import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MarkdownContent } from "@/components/blog/markdown-content";
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
  return <><SiteHeader activePath="blog" /><main className="mx-auto min-h-screen max-w-4xl px-6 py-12 lg:px-10"><header className="border-b pb-8"><Button asChild size="sm" variant="ghost"><Link href="/blog">← 返回博客目录</Link></Button><h1 className="mt-8 text-4xl font-semibold tracking-tight sm:text-5xl">{post.name}</h1><p className="mt-4 text-sm text-muted-foreground">更新于 {new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" }).format(new Date(post.updated_at))}</p></header><article className="mt-10 rounded-3xl border bg-white/75 p-6 sm:p-10"><MarkdownContent content={post.content} /></article></main></>;
}
