export type BlogNodeKind = "folder" | "document";

export type BlogNodeSummary = {
  id: string;
  parent_id: string | null;
  kind: BlogNodeKind;
  name: string;
  slug: string | null;
  is_published: boolean;
  sort_order: number;
  updated_at: string;
};

export type BlogNodeDetail = BlogNodeSummary & {
  content: string;
  created_at: string;
  published_at: string | null;
};

export type BlogTreeNode = BlogNodeSummary & { children: BlogTreeNode[] };

const publicApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const serverApiBaseUrl =
  typeof window === "undefined"
    ? (process.env.API_INTERNAL_URL ?? publicApiBaseUrl)
    : publicApiBaseUrl;

export function buildBlogTree(nodes: BlogNodeSummary[]): BlogTreeNode[] {
  const byId = new Map<string, BlogTreeNode>();
  for (const node of nodes) byId.set(node.id, { ...node, children: [] });

  const roots: BlogTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortTree = (items: BlogTreeNode[]) => {
    items.sort(
      (left, right) =>
        left.sort_order - right.sort_order ||
        (left.kind === right.kind ? left.name.localeCompare(right.name, "zh-CN") : left.kind === "folder" ? -1 : 1),
    );
    for (const item of items) sortTree(item.children);
  };
  sortTree(roots);
  return roots;
}

export async function fetchPublicBlogTree() {
  const response = await fetch(`${serverApiBaseUrl}/api/v1/blog/tree`, {
    cache: "no-store",
  });
  if (!response.ok) return [];
  return (await response.json()) as BlogNodeSummary[];
}

export async function fetchPublishedPost(slug: string) {
  const response = await fetch(
    `${serverApiBaseUrl}/api/v1/blog/posts/${encodeURIComponent(slug)}`,
    { cache: "no-store" },
  );
  if (!response.ok) return null;
  return (await response.json()) as BlogNodeDetail;
}

export const blogApiBaseUrl = publicApiBaseUrl;
