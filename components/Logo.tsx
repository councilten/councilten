/**
 * Provider and network logos (public/logos). Files supplied by the Council team; scripts/logos.py prepares
 * them. A dark variant, when there is one, swaps in with the colour scheme. Decorative by default because
 * the name is always written next to it; pass `title` when a logo stands alone.
 */
export const LOGOS: Record<string, { name: string; dark?: boolean; wide?: boolean }> = {
  venice: { name: "Venice", dark: true },
  claude: { name: "Claude" },
  gpt: { name: "OpenAI", dark: true },
  grok: { name: "Grok", dark: true },
  gemini: { name: "Gemini" },
  deepseek: { name: "DeepSeek" },
  kimi: { name: "Kimi", dark: true },
  qwen: { name: "Qwen" },
  glm: { name: "Z.ai", dark: true },
  mistral: { name: "Mistral" },
  solana: { name: "Solana" },
  usdc: { name: "USDC" },
  x402: { name: "x402", dark: true, wide: true },
};

export function Logo({ k, size = 18, title, className }: { k: string; size?: number; title?: string; className?: string }) {
  const l = LOGOS[k];
  if (!l) return null;
  const w = l.wide ? Math.round(size * 2.4) : size;
  return (
    <span className={`logo${l.dark ? " has-dark" : ""}${className ? " " + className : ""}`} style={{ width: w, height: size }} title={title} aria-hidden={title ? undefined : true}>
      <img className="lg-l" src={`/logos/${k}.png`} alt={title ?? ""} width={w} height={size} decoding="async" />
      {l.dark && <img className="lg-d" src={`/logos/${k}-dark.png`} alt="" width={w} height={size} decoding="async" />}
    </span>
  );
}
