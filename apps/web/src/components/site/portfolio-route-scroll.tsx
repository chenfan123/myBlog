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

    let attempts = 0;
    let timer = 0;
    const scrollToSection = () => {
      const section = document.getElementById(sectionId);
      if (section) {
        const headerOffset = 64;
        const top = section.getBoundingClientRect().top + window.scrollY - headerOffset;
        window.scrollTo({ top: Math.max(0, top), behavior: attempts === 0 ? "smooth" : "auto" });
      }
      attempts += 1;
      if (attempts < 4) timer = window.setTimeout(scrollToSection, 150);
    };
    timer = window.setTimeout(scrollToSection, 0);

    return () => window.clearTimeout(timer);
  }, [pathname]);

  return null;
}
