import type { NextConfig } from "next";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const config: NextConfig = {
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: { "/": ["./data/runs/**"] },
  typescript: { ignoreBuildErrors: true },
  webpack(config) {
    config.resolve.modules = [...(config.resolve.modules ?? ["node_modules"]), path.join(path.resolve(import.meta.dirname), "node_modules")];
    return config;
  },
};
export default config;
