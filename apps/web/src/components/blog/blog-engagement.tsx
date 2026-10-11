"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Heart, MessageCircle, Reply, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { BlogComment, BlogEngagement } from "@/lib/blog";
import { ApiError, api } from "@/lib/http";
import { cn } from "@/lib/utils";

type CommentNode = BlogComment & { children: CommentNode[] };

export function BlogEngagementPanel({ slug }: { slug: string }) {
  const client = useQueryClient();
  const [replyTo, setReplyTo] = useState<BlogComment | null>(null);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const key = ["blog-engagement", slug];
  const engagement = useQuery({
    queryKey: key,
    queryFn: () => api.get<BlogEngagement>(`/api/v1/blog/posts/${encodeURIComponent(slug)}/engagement`, { skipAuth: true }),
    staleTime: 30_000,
    retry: 1,
  });
  const comments = useMemo(() => buildTree(engagement.data?.comments ?? []), [engagement.data?.comments]);
  const like = useMutation({
    mutationFn: () => api.post<{ liked: boolean; like_count: number }>(`/api/v1/blog/posts/${encodeURIComponent(slug)}/like`),
    onSuccess: (result) => {
      client.setQueryData<BlogEngagement>(key, (current) => current ? { ...current, liked_by_me: result.liked, like_count: result.like_count } : current);
      setMessage("");
    },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const createComment = useMutation({
    mutationFn: () => api.post<BlogComment>(`/api/v1/blog/posts/${encodeURIComponent(slug)}/comments`, { body: { content, parent_id: replyTo?.id ?? null } }),
    onSuccess: (comment) => {
      client.setQueryData<BlogEngagement>(key, (current) => current ? { ...current, comment_count: current.comment_count + 1, comments: [...current.comments, comment] } : current);
      setContent(""); setReplyTo(null); setMessage("");
    },
    onError: (error) => setMessage(errorMessage(error)),
  });
  const removeComment = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/blog/comments/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
    onError: (error) => setMessage(errorMessage(error)),
  });
  const submit = () => { if (content.trim()) createComment.mutate(); };

  return <section className="mx-auto mt-16 max-w-3xl border-t border-black/12 pt-10" aria-labelledby="comments-title">
    <div className="flex flex-wrap items-center justify-between gap-4"><div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-primary">Discussion</p><h2 id="comments-title" className="mt-2 text-2xl font-semibold">评论与反馈</h2></div><Button type="button" variant={engagement.data?.liked_by_me ? "default" : "outline"} disabled={like.isPending} onClick={() => like.mutate()}><Heart className={cn(engagement.data?.liked_by_me && "fill-current")} />{engagement.data?.like_count ?? 0} 赞</Button></div>
    <div className="mt-8 rounded-2xl border bg-card p-4 sm:p-5">
      {replyTo ? <div className="mb-3 flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-xs"><span>回复 {replyTo.author_name}</span><button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setReplyTo(null)}>取消</button></div> : null}
      <textarea value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") submit(); }} placeholder="写下你的看法…（Ctrl / ⌘ + Enter 发送）" className="min-h-28 w-full resize-y bg-transparent text-sm leading-7 outline-none placeholder:text-muted-foreground" maxLength={2000} />
      <div className="mt-3 flex items-center justify-between border-t pt-3"><span className="text-xs text-muted-foreground">{content.length}/2000</span><Button type="button" disabled={!content.trim() || createComment.isPending} onClick={submit}><Send />{createComment.isPending ? "发送中" : "发布评论"}</Button></div>
    </div>
    {message ? <p className="mt-3 rounded-lg bg-destructive/8 px-3 py-2 text-sm text-destructive">{message}{message.includes("登录") ? <>，<Link className="underline" href={`/login?next=/blog/${slug}`}>前往登录</Link></> : null}</p> : null}
    <div className="mt-10 flex items-center gap-2 text-sm font-medium"><MessageCircle className="size-4 text-primary" />{engagement.data?.comment_count ?? 0} 条评论</div>
    {engagement.isPending ? <div className="mt-5 space-y-3"><div className="h-24 animate-pulse rounded-xl bg-muted" /><div className="h-24 animate-pulse rounded-xl bg-muted" /></div> : engagement.isError ? <p className="mt-5 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">互动内容暂时无法加载，正文阅读不受影响。</p> : comments.length ? <div className="mt-5 divide-y border-y">{comments.map((comment) => <CommentBranch key={comment.id} comment={comment} depth={0} onReply={setReplyTo} onDelete={(id) => removeComment.mutate(id)} />)}</div> : <p className="mt-5 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">还没有评论，欢迎留下第一条讨论。</p>}
  </section>;
}

function CommentBranch({ comment, depth, onReply, onDelete }: { comment: CommentNode; depth: number; onReply: (comment: BlogComment) => void; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(depth < 3);
  return <div className={cn("py-5", depth > 0 && depth < 4 && "ml-4 border-l pl-4 sm:ml-8 sm:pl-6")}><div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{comment.author_name.slice(0, 1).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-medium">{comment.author_name}</p><p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{formatDate(comment.created_at)}</p></div></div><div className="flex items-center gap-1"><button type="button" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => onReply(comment)}><Reply className="size-3.5" />回复</button>{comment.can_delete ? <button type="button" aria-label="删除评论" className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => { if (window.confirm("确定删除这条评论及其全部回复吗？")) onDelete(comment.id); }}><Trash2 className="size-3.5" /></button> : null}</div></div><p className="mt-3 whitespace-pre-wrap break-words pl-12 text-sm leading-7 text-foreground/85">{comment.content}</p>{comment.children.length ? depth >= 3 && !expanded ? <button type="button" className="ml-12 mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary" onClick={() => setExpanded(true)}><ChevronDown className="size-3.5" />展开 {countDescendants(comment)} 条深层回复</button> : <div className="mt-2">{comment.children.map((child) => <CommentBranch key={child.id} comment={child} depth={depth + 1} onReply={onReply} onDelete={onDelete} />)}</div> : null}</div>;
}

function buildTree(comments: BlogComment[]): CommentNode[] { const byId = new Map(comments.map((comment) => [comment.id, { ...comment, children: [] } as CommentNode])); const roots: CommentNode[] = []; for (const comment of byId.values()) { const parent = comment.parent_id ? byId.get(comment.parent_id) : undefined; if (parent) parent.children.push(comment); else roots.push(comment); } return roots; }
function countDescendants(comment: CommentNode): number { return comment.children.reduce((total, child) => total + 1 + countDescendants(child), 0); }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function errorMessage(error: unknown) { return error instanceof ApiError && error.status === 401 ? "登录后才能参与点赞和评论" : "操作失败，请稍后再试"; }
