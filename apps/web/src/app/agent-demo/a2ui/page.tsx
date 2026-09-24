import type { Metadata } from "next";

import { requireAuthenticatedPage } from "@/lib/server/user-auth";

export const metadata: Metadata = {
  title: "A2UI Playground｜CHEN.DEV",
  description: "通过自然语言生成并实时渲染交互界面的 A2UI Agent Playground。",
};

export default async function A2UIPlaygroundPage() {
  await requireAuthenticatedPage("/agent-demo/a2ui");

  return (
    <main className="h-svh min-h-[640px] overflow-hidden bg-[#f6f8f5]">
      <iframe
        src="/a2ui/index.html"
        title="A2UI Playground"
        className="size-full border-0"
        allow="clipboard-read; clipboard-write"
      />
    </main>
  );
}
