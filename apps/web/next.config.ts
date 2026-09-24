import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    root: projectRoot,
  },
  async rewrites() {
    if (process.env.NODE_ENV === "production") return [];

    return [
      {
        source: "/a2ui-api/:path*",
        destination: "http://127.0.0.1:3001/:path*",
      },
      {
        source: "/a2ui-profile/:path*",
        destination: "http://127.0.0.1:5173/a2ui/:path*",
      },
      {
        source: "/a2ui/:path*",
        destination: "http://127.0.0.1:5173/a2ui/:path*",
      },
    ];
  },
};

export default nextConfig;
