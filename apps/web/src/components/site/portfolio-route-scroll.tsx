"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const sectionByPath: Readonly<Record<string, string>> = {
  "/about": "about",
  "/skills": "skills",
  "/experience": "experience",
  "/projects": "projects",
  "/agents": "agent-demo",
  "/contact": "contact",
};

/** 用真实路径定位单页简历区块，避免把页面状态放进 URL hash。 */
export function PortfolioRouteScroll() {
  const pathname = usePathname();

  useEffect(() => {
    const sectionId = sectionByPath[pathname];
    if (!sectionId) {
      window.scrollTo({ top: 0 });
      return;
    }

    const timer = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        document.getElementById(sectionId)?.scrollIntoView({ block: "start" });
      });
    }, 50);

    return () => window.clearTimeout(timer);
  }, [pathname]);

  return null;
}
