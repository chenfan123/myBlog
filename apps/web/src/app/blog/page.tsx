import { ArrowDown, BookOpen, FolderTree } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";

import { BlogWorkspace } from "@/components/blog/blog-workspace";
import { PublicBlogDirectory, PublicBlogTree } from "@/components/blog/public-blog-tree";
import { SiteHeader } from "@/components/site/site-header";
import { Button } from "@/components/ui/button";
import { buildBlogTree, countBlogDocuments, fetchPublicBlogTree } from "@/lib/blog";
import { getAdminVerificationStatus } from "@/lib/server/admin-auth";

export const metadata = {
  title: "个人博客｜CHEN.DEV",
  description: "陈健华的技术文章与学习笔记。",
};
export const dynamic = "force-dynamic";

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const cookieStore = await cookies();
  const adminStatus = await getAdminVerificationStatus(cookieStore.toString());

  if (adminStatus === 204 && view !== "public") {
    return (
      <>
        <SiteHeader activePath="blog" />
        <main className="mx-auto w-full max-w-[1600px] px-4 py-6 lg:px-8">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <p className="text-sm text-primary">博客管理</p>
            <h1 className="mt-2 text-3xl font-semibold">个人博客工作区</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              在这里整理文章和草稿。未发布的内容只有你能看到。
            </p>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link href="/blog?view=public">查看公开博客</Link>
            </Button>
            <Button asChild variant="ghost">
              <Link href="/admin">简历后台</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">返回主页</Link>
            </Button>
          </div>
        </div>
        <BlogWorkspace />
        </main>
      </>
    );
  }

  // 普通访问者只需要公开目录；管理员分支不会产生这次额外请求。
  const nodes = await fetchPublicBlogTree();
  const tree = buildBlogTree(nodes);
  const articleCount = tree.reduce((total, node) => total + countBlogDocuments(node), 0);
  const categoryCount = tree.filter((node) => node.kind === "folder").length;
  return (
    <>
      <SiteHeader activePath="blog" />
      <main className="mx-auto min-h-screen w-full max-w-[1440px] px-5 pb-24 pt-10 sm:px-8 lg:px-12 lg:pt-16">
        <header className="border-b border-black/12 pb-14 lg:pb-20">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-end">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">Notes on building</p>
              <h1 className="mt-5 text-5xl font-semibold tracking-[-0.06em] sm:text-7xl">工程笔记与实践</h1>
              <p className="mt-6 max-w-xl text-base leading-8 text-muted-foreground">记录前端工程、Agent 系统与真实项目中的判断、实现和复盘。不是教程集合，而是一份持续更新的工作手册。</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Button asChild><a href="#articles">开始阅读 <ArrowDown /></a></Button>
                {adminStatus === 204 ? <Button asChild variant="outline"><Link href="/blog">返回工作区</Link></Button> : null}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden border-y border-black/12 bg-black/10">
              <div className="flex items-center gap-4 bg-[#fbfaf6] p-6"><BookOpen className="size-5 text-primary" /><div><p className="text-4xl font-semibold tracking-[-0.05em]">{articleCount}</p><p className="mt-1 text-xs text-muted-foreground">公开文章</p></div></div>
              <div className="flex items-center gap-4 bg-[#fbfaf6] p-6"><FolderTree className="size-5 text-primary" /><div><p className="text-4xl font-semibold tracking-[-0.05em]">{categoryCount}</p><p className="mt-1 text-xs text-muted-foreground">知识分类</p></div></div>
            </div>
          </div>
        </header>

        <section id="articles" className="mt-10 scroll-mt-20 lg:mt-14">
          {tree.length ? (
            <div>
              <div className="mb-10 rounded-2xl border bg-card/70 p-4 sm:flex sm:items-center sm:gap-5 sm:p-5">
                <div className="mb-3 flex shrink-0 items-center gap-2 text-sm font-medium sm:mb-0"><FolderTree className="size-4 text-primary" />大分类</div>
                <PublicBlogDirectory nodes={tree} />
              </div>
              <div className="mb-8 flex items-end justify-between gap-4">
                <div><p className="text-sm text-primary">最近更新</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">文章列表</h2></div>
                <span className="text-sm text-muted-foreground">共 {articleCount} 篇</span>
              </div>
              <PublicBlogTree nodes={tree} />
            </div>
          ) : (
            <div className="rounded-[2rem] border bg-card/80 py-24 text-center text-muted-foreground">
              <span className="mx-auto grid size-16 place-items-center rounded-3xl bg-primary/10 text-primary"><BookOpen className="size-7" /></span>
              <p className="mt-5 font-medium text-foreground">还没有发布文章</p><p className="mt-2 text-sm">发布后的文章会显示在这里。</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
