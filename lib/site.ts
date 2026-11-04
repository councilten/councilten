import { headers } from "next/headers";

export const KIT_VERSION = "0.1.0";
export const KIT_FILE = `council-kit-${KIT_VERSION}.tgz`;

export const env = {
  xUrl: process.env.NEXT_PUBLIC_X_URL || "",
  githubUrl: process.env.NEXT_PUBLIC_GITHUB_URL || "",
  mint: process.env.NEXT_PUBLIC_TOKEN_MINT || "",
  rpc: process.env.SOLANA_RPC_URL || "",
};

/** The site's own origin: NEXT_PUBLIC_SITE_URL, else the request host. */
export async function origin(): Promise<string> {
  const fixed = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "");
  if (fixed) return fixed.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function commands() {
  const o = await origin();
  const tgz = `${o}/downloads/${KIT_FILE}`;
  return {
    tgz,
    init: `npx ${tgz} init`,
    global: `npm install -g ${tgz}`,
    mcp: `claude mcp add council -- npx -y ${tgz} mcp`,
  };
}
