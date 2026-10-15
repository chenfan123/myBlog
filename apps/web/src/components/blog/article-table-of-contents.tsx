"use client";

import { ChevronDown, ListTree } from "lucide-react";
import { useEffect, useState } from "react";

import type { MarkdownHeading } from "@/components/blog/markdown-headings";

const COLLAPSED_COUNT = 6;

export function ArticleTableOfContents({ headings, mobile = false }: { headings: MarkdownHeading[]; mobile?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [activeId, setActiveId] = useState(() => headings[0]?.id ?? "");
  const visibleHeadings = expanded ? headings : headings.slice(0, COLLAPSED_COUNT);
  const hiddenCount = Math.max(0, headings.length - COLLAPSED_COUNT);

  useEffect(() => {
    const elements = headings.map(({ id }) => document.getElementById(id)).filter((element): element is HTMLElement => Boolean(element));
    if (!elements.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-15% 0px -72%", threshold: 0 },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [headings]);

  const content = (
    <>
      <ol className="space-y-0.5 border-l border-primary/15 pl-2">
        {visibleHeadings.map((heading) => (
          <li key={heading.id} style={{ paddingLeft: `${Math.max(0, heading.depth - 1) * 0.55}rem` }}>
            <a
              href={`#${heading.id}`}
              aria-current={activeId === heading.id ? "location" : undefined}
              className="group relative block rounded-md px-2 py-1.5 text-[13px] leading-5 text-muted-foreground transition hover:bg-primary/5 hover:text-foreground aria-[current=location]:bg-primary/8 aria-[current=location]:font-medium aria-[current=location]:text-primary"
            >
              <span className="absolute -left-[11px] top-1/2 h-0 w-0.5 -translate-y-1/2 rounded-full bg-primary transition-all group-aria-[current=location]:h-4" />
              <span className="line-clamp-2">{heading.text}</span>
            </a>
          </li>
        ))}
      </ol>
      {hiddenCount ? (
        <button type="button" onClick={() => setExpanded((current) => !current)} className="mt-2 flex w-full items-center justify-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-primary transition hover:bg-primary/5">
          {expanded ? "收起目录" : `展开其余 ${hiddenCount} 项`}
          <ChevronDown className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </button>
      ) : null}
    </>
  );

  if (mobile) {
    return (
      <details className="group mx-auto mt-8 max-w-3xl overflow-hidden rounded-xl border bg-background/90 shadow-sm lg:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 font-medium marker:hidden">
          <span className="grid size-8 place-items-center rounded-lg bg-primary/10 text-primary"><ListTree className="size-4" /></span>
          <span className="flex-1">文章目录</span>
          <span className="text-xs font-normal text-muted-foreground">{headings.length} 个章节</span>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="max-h-[55dvh] overflow-y-auto border-t px-4 py-3">{content}</div>
      </details>
    );
  }

  return (
    <aside className="hidden lg:block">
      <nav aria-label="文章目录" className="sticky top-24 mt-12 max-h-[calc(100dvh-7rem)] overflow-y-auto pr-3">
        <div className="mb-3 flex items-center gap-2 px-2">
          <ListTree className="size-4 text-primary" />
          <p className="text-xs font-semibold tracking-wide text-foreground">文章目录</p>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{headings.length}</span>
        </div>
        {content}
      </nav>
    </aside>
  );
}
