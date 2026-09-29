import type { NextConfig } from "next";

const apiUrl = process.env.API_URL || "http://127.0.0.1:8080";
if (process.env.VERCEL === "1") {
  const target = new URL(apiUrl);
  if (
    target.protocol !== "https:" ||
    ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) ||
    target.username ||
    target.password ||
    target.pathname !== "/" ||
    target.search ||
    target.hash
  ) {
    throw new Error(
      "Set API_URL to the public HTTPS origin of the Go backend before deploying to Vercel.",
    );
  }
}

const config: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl.replace(/\/$/, "")}/api/:path*`,
      },
    ];
  },
  poweredByHeader: false,
  turbopack: { root: process.cwd() },
};
export default config;
