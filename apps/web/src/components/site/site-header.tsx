import { Mail } from "lucide-react";
import Link from "next/link";

import { HeaderAccount } from "@/components/auth/header-account";
import { Button } from "@/components/ui/button";

const navigation: ReadonlyArray<{
  href: string;
  label: string;
  key?: "blog";
}> = [
  { href: "/#about", label: "优势" },
  { href: "/#skills", label: "技术栈" },
  { href: "/#experience", label: "工作经历" },
  { href: "/#projects", label: "项目经历" },
  { href: "/#agent-demo", label: "Agent Demo" },
  { href: "/blog", label: "博客", key: "blog" },
];

export function SiteHeader({
  activePath = "home",
}: {
  activePath?: "home" | "blog";
}) {
  return (
    <header className="print-hidden sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-10">
        <Link
          className="flex items-center gap-2 font-mono text-sm font-semibold"
          href="/#profile"
        >
          <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            C
          </span>
          <span className="hidden sm:inline">CHEN.DEV</span>
        </Link>
        <div className="hidden items-center gap-7 text-sm text-muted-foreground lg:flex">
          {navigation.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.key === activePath ? "page" : undefined}
              className="transition-colors hover:text-foreground aria-[current=page]:font-medium aria-[current=page]:text-primary"
            >
              {item.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <HeaderAccount />
          <Button asChild size="sm" variant="outline">
            <Link href="/#contact">
              <Mail />
              <span className="hidden sm:inline">联系我</span>
            </Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
