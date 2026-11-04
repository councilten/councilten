import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingIncludes: { "/skill.md": ["./kit/SKILL.md"], "/llms.txt": ["./kit/SKILL.md"] },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      { source: "/downloads/(.*)", headers: [{ key: "Cache-Control", value: "public, max-age=300" }] },
    ];
  },
};

export default config;
