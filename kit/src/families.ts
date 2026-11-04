/**
 * Pure model logic shared by the CLI and the website: no imports, no I/O.
 */
export type Provider = "venice" | "blockrun";
export interface Model {
  provider: Provider;
  id: string;
  name: string;
  /** USD per million tokens. */
  input: number;
  output: number;
  context?: number;
  /** Per-call floor charged by the gateway, in USD. */
  minimum?: number;
  private?: boolean;
}

/**
 * Aliases resolve against the live catalogs, never a hard-coded id: within a family the
 * newest version wins, so `claude` keeps pointing at the current Sonnet as the catalogs move.
 * Providers are tried in order; Venice first where it serves the model (private, prepaid credit).
 */
type Rule = [Provider, RegExp];
export const FAMILIES: Record<string, { label: string; rules: Rule[] }> = {
  venice: { label: "Venice", rules: [["venice", /^venice-uncensored-(\d+)-(\d+)$/], ["venice", /^venice-uncensored$/]] },
  claude: { label: "Claude", rules: [["venice", /^claude-sonnet-(\d+)(?:-(\d+))?$/], ["blockrun", /^anthropic\/claude-sonnet-(\d+)(?:\.(\d+))?$/]] },
  gpt: { label: "GPT", rules: [["blockrun", /^openai\/gpt-(\d+)(?:\.(\d+))?$/], ["venice", /^openai-gpt-oss-(\d+)b$/]] },
  grok: { label: "Grok", rules: [["venice", /^grok-(\d+)-(\d+)$/], ["blockrun", /^xai\/grok-(\d+)(?:\.(\d+))?$/]] },
  gemini: { label: "Gemini", rules: [["venice", /^gemini-(\d+)-(\d+)-flash$/], ["blockrun", /^google\/gemini-(\d+)(?:\.(\d+))?-flash$/]] },
  deepseek: { label: "DeepSeek", rules: [["venice", /^deepseek-v(\d+)-pro$/], ["blockrun", /^deepseek\/deepseek-v(\d+)-pro$/]] },
  kimi: { label: "Kimi", rules: [["venice", /^kimi-k(\d+)-(\d+)-pro$/], ["blockrun", /^moonshot\/kimi-k(\d+)\.(\d+)-pro$/]] },
  qwen: { label: "Qwen", rules: [["venice", /^qwen-(\d+)-(\d+)-max$/], ["blockrun", /^qwen\/qwen(\d+)\.(\d+)-max$/]] },
  glm: { label: "GLM", rules: [["venice", /^z-ai-glm-(\d+)-(\d+)$/], ["blockrun", /^zai\/glm-(\d+)(?:\.(\d+))?$/]] },
  mistral: { label: "Mistral", rules: [["blockrun", /^mistral\/mistral-large-(\d+)$/], ["venice", /^mistral-small-(\d+)-(\d+)-24b-instruct$/]] },
};
export const THE_TEN = Object.keys(FAMILIES);

export function parseVenice(body: any): Model[] {
  return (body?.data ?? [])
    .filter((m: any) => (m.type ?? "text") === "text" && !m.model_spec?.offline)
    .map((m: any) => ({
      provider: "venice" as const,
      id: m.id,
      name: m.model_spec?.name ?? m.id,
      input: Number(m.model_spec?.pricing?.input?.usd ?? 0),
      output: Number(m.model_spec?.pricing?.output?.usd ?? 0),
      context: m.model_spec?.availableContextTokens ?? m.context_length,
      private: m.model_spec?.privacy === "private",
    }));
}

export function parseBlockrun(body: any): Model[] {
  return (body?.data ?? [])
    .filter((m: any) => (m.billing_mode === "paid" || m.billing_mode === "free") && m.pricing && "input" in m.pricing)
    .map((m: any) => ({
      provider: "blockrun" as const,
      id: m.id,
      name: m.name ?? m.id,
      input: Number(m.pricing.input ?? 0),
      output: Number(m.pricing.output ?? 0),
      context: m.context_window,
      minimum: m.billing_mode === "free" ? 0 : 0.001,
    }));
}

const version = (m: RegExpMatchArray) => m.slice(1).map((x) => Number(x ?? 0));
const newer = (a: number[], b: number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
};

export interface Seat {
  alias: string;
  label: string;
  model: Model;
}

/** Resolve "claude", "venice:claude-opus-5-5", "blockrun:openai/gpt-5.5" or a bare id. */
export function resolve(ref: string, models: Model[]): Seat {
  const r = ref.trim();
  const fam = FAMILIES[r.toLowerCase()];
  if (fam) {
    for (const [provider, re] of fam.rules) {
      let best: { m: Model; v: number[] } | null = null;
      for (const m of models) {
        if (m.provider !== provider) continue;
        const hit = m.id.match(re);
        if (hit && (!best || newer(version(hit), best.v))) best = { m, v: version(hit) };
      }
      if (best) return { alias: r.toLowerCase(), label: fam.label, model: best.m };
    }
    throw new Error(`No live model for "${r}" on Venice or BlockRun right now`);
  }
  const [prov, ...rest] = r.split(":");
  const id = rest.length ? rest.join(":") : r;
  const provider = rest.length ? (prov as Provider) : undefined;
  const m = models.find((x) => x.id === id && (!provider || x.provider === provider));
  if (!m) throw new Error(`Unknown model "${r}". See: council models`);
  return { alias: id, label: m.name, model: m };
}

