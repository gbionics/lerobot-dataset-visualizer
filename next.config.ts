import type { NextConfig } from "next";
import packageJson from "./package.json";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  transpilePackages: ["three"],
  // Avoid the 200-800ms cold-start cost of barrel-file imports.
  // react-icons re-exports thousands of icon components from /fa, etc.;
  // recharts and @huggingface/hub also have wide entry surfaces.
  experimental: {
    optimizePackageImports: ["react-icons", "recharts", "@huggingface/hub"],
  },
  generateBuildId: () => packageJson.version,
  async rewrites() {
    if (!process.env.LOCAL_DATASET_PATH) return [];
    // The Hub client's URLs for "local/<dataset>" become reads of the local dataset directory.
    return [
      {
        source: "/api/local-hub/datasets/:org/:repo*/resolve/:rev/:file*",
        destination: "/api/local-dataset/:repo*/:file*",
      },
    ];
  },
  env: {
    NEXT_PUBLIC_LOCAL_MODE: process.env.LOCAL_DATASET_PATH ? "1" : "",
  },
};

export default nextConfig;
