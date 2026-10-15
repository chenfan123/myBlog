import type { ComponentPropsWithoutRef, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MarkdownCodeBlock } from "@/components/blog/markdown-code-block";
import { createMarkdownSlugger } from "@/components/blog/markdown-headings";

export function MarkdownContent({ content, variant = "article" }: { content: string; variant?: "article" | "preview" }) {
  const slug = createMarkdownSlugger();
  return (
    <div className={`markdown-content markdown-content--${variant}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: MarkdownCode,
          h1: ({ children }) => <MarkdownHeading level={1} id={slug(childrenToText(children))}>{children}</MarkdownHeading>,
          h2: ({ children }) => <MarkdownHeading level={2} id={slug(childrenToText(children))}>{children}</MarkdownHeading>,
          h3: ({ children }) => <MarkdownHeading level={3} id={slug(childrenToText(children))}>{children}</MarkdownHeading>,
          h4: ({ children }) => <MarkdownHeading level={4} id={slug(childrenToText(children))}>{children}</MarkdownHeading>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownHeading({ level, id, children }: { level: 1 | 2 | 3 | 4; id: string; children: ReactNode }) {
  const Tag = `h${level}` as const;
  return <Tag id={id} className="markdown-heading"><a className="markdown-heading-anchor" href={`#${id}`} aria-label={`跳转到${childrenToText(children)}`}>#</a>{children}</Tag>;
}

function childrenToText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(childrenToText).join("");
  if (children && typeof children === "object" && "props" in children) {
    return childrenToText((children as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function MarkdownCode({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
  const code = String(children).replace(/\n$/, "");
  const language = /language-([^\s]+)/.exec(className ?? "")?.[1];
  if (language || String(children).includes("\n")) {
    return <MarkdownCodeBlock code={code} language={language} />;
  }
  return <code className={className} {...props}>{children}</code>;
}
