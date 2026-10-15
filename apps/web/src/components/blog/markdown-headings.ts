export type MarkdownHeading = {
  depth: number;
  text: string;
  id: string;
};

export function createMarkdownSlugger() {
  const seen = new Map<string, number>();
  return (value: string) => {
    const base = value
      .trim()
      .toLowerCase()
      .replace(/[`*_~[\](){}<>]/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "section";
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
  };
}

export function extractMarkdownHeadings(content: string): MarkdownHeading[] {
  const slug = createMarkdownSlugger();
  const headings: MarkdownHeading[] = [];
  let fenced = false;

  for (const line of content.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const match = /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const text = match[2].replace(/!?(\[([^\]]+)\])\([^)]*\)/g, "$2").replace(/[`*_~]/g, "").trim();
    if (text) headings.push({ depth: match[1].length, text, id: slug(text) });
  }
  return headings;
}
