import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter-tight";
import "@fontsource-variable/source-serif-4";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

const site = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
const description =
  "Pay in USDC. Think with Venice, Claude, GPT, Grok and Gemini. The multi-agent kit for Solana: x402 payments, CLI, MCP server, a council of models under a budget, on-chain ledger. Open source.";

export const metadata: Metadata = {
  metadataBase: site ? new URL(site) : undefined,
  title: { default: "Council", template: "%s · Council" },
  description,
  applicationName: "Council",
  manifest: "/site.webmanifest",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/favicon-32.png", sizes: "32x32" }],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    title: "Council",
    description: "Ten models. One answer. The multi-agent kit for Solana.",
    images: [{ url: "/og-1200x630.png", width: 1200, height: 630, alt: "Council" }],
  },
  twitter: { card: "summary_large_image", title: "Council", description: "Ten models. One answer.", images: ["/og-1200x630.png"] },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f3eee5" },
    { media: "(prefers-color-scheme: dark)", color: "#0e0c0b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
