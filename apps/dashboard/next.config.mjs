/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server output (server.js + only the node_modules files
  // actually traced as used) — required for a minimal production Docker
  // image (Dockerfile copies `.next/standalone` rather than shipping the
  // full node_modules tree). No effect on `next dev`.
  output: "standalone",
};

export default nextConfig;
