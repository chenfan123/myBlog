import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { MarkdownCodeBlock } from "@/components/blog/markdown-code-block";

export function MarkdownContent({ content, variant = "article" }: { content: string; variant?: "article" | "preview" }) {
  return (
    <div className={`markdown-content markdown-content--${variant}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: MarkdownCode,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownCode({ className, children, ...props }: ComponentPropsWithoutRef<"code">) {
  const code = String(children).replace(/\n$/, "");
  const language = /language-([^\s]+)/.exec(className ?? "")?.[1];
  if (language || String(children).includes("\n")) {
    return <MarkdownCodeBlock code={code} language={language} />;
  }
  return <code className={className} {...props}>{children}</code>;
}
