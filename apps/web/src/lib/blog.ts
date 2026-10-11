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

export type BlogComment = {
  id: string;
  parent_id: string | null;
  author_id: string;
  author_name: string;
  content: string;
  created_at: string;
  can_delete: boolean;
};

export type BlogEngagement = {
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
  comments: BlogComment[];
};

const publicApiBaseUrl =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const serverApiBaseUrl =
  typeof window === "undefined"
    ? (process.env.API_INTERNAL_URL ?? publicApiBaseUrl)
    : publicApiBaseUrl;
const developmentPublicFallback = "https://ainew.gz.cn";

async function fetchPublicResource(path: string): Promise<Response | null> {
  try {
    const response = await fetch(`${serverApiBaseUrl}${path}`, { cache: "no-store" });
    if (response.ok || process.env.NODE_ENV === "production") return response;
  } catch {
    if (process.env.NODE_ENV === "production") return null;
  }

  if (serverApiBaseUrl === developmentPublicFallback) return null;
  try {
    return await fetch(`${developmentPublicFallback}${path}`, { cache: "no-store" });
  } catch {
    return null;
  }
}

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

export function countBlogDocuments(node: BlogTreeNode): number {
  if (node.kind === "document") return 1;
  return node.children.reduce(
    (total, child) => total + countBlogDocuments(child),
    0,
  );
}

export async function fetchPublicBlogTree() {
  const response = await fetchPublicResource("/api/v1/blog/tree");
  if (!response?.ok) return [];
  return (await response.json()) as BlogNodeSummary[];
}

export async function fetchPublishedPost(slug: string) {
  const response = await fetchPublicResource(
    `/api/v1/blog/posts/${encodeURIComponent(slug)}`,
  );
  if (!response?.ok) return null;
  return (await response.json()) as BlogNodeDetail;
}

export const blogApiBaseUrl = publicApiBaseUrl;
