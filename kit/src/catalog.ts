import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BLOCKRUN_API, HOME, USER_AGENT, VENICE_API } from "./env.js";
import { ensureHome } from "./config.js";
import type { Model } from "./types.js";
import { parseBlockrun, parseVenice } from "./families.js";
export { FAMILIES, THE_TEN, resolve, type Seat } from "./families.js";

const CACHE = join(HOME, "models.json");
const TTL_MS = 10 * 60_000;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" } });
  if (!res.ok) throw new Error(`${new URL(url).host} models: ${res.status}`);
  return res.json();
}

export async function catalog(refresh = false): Promise<Model[]> {
  if (!refresh && existsSync(CACHE)) {
    const c = JSON.parse(readFileSync(CACHE, "utf8"));
    if (Date.now() - c.at < TTL_MS) return c.models;
  }
  const [v, b] = await Promise.allSettled([getJson(`${VENICE_API}/models?type=text`), getJson(`${BLOCKRUN_API}/v1/models`)]);
  const models = [
    ...(v.status === "fulfilled" ? parseVenice(v.value) : []),
    ...(b.status === "fulfilled" ? parseBlockrun(b.value) : []),
  ];
  if (!models.length) throw new Error("Could not load the model catalogs (Venice and BlockRun both unreachable)");
  ensureHome();
  writeFileSync(CACHE, JSON.stringify({ at: Date.now(), models }));
  return models;
}

const estTokens = (chars: number) => Math.ceil(chars / 3.5) + 24;

/** Worst-case cost: the full prompt in, every allowed output token out, never below the gateway floor. */
export function estimate(m: Model, promptChars: number, maxTokens: number): number {
  const usd = (estTokens(promptChars) * m.input + maxTokens * m.output) / 1e6;
  return Math.max(usd, m.minimum ?? 0);
}

export function actual(m: Model, usage: { input: number; output: number }): number {
  return Math.max((usage.input * m.input + usage.output * m.output) / 1e6, m.minimum ?? 0);
}
