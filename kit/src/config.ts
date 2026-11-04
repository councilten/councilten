import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CONFIG_FILE, DEFAULT_RPC, HOME } from "./env.js";

export interface Config {
  /** Solana RPC. The public endpoint works for payments; holder scans need a full RPC. */
  rpc: string;
  /** The Council token mint, set the day it goes live. */
  mint: string | null;
  /** Hard cap on any single x402 payment, in USD. */
  maxPaymentUsd: number;
  /** Default budget for one ask or one council run, in USD. */
  runBudgetUsd: number;
  /** Hosts `council pay` may pay. Empty means: ask every time (CLI) or refuse (MCP). */
  allowHosts: string[];
  /** Default seats at the table and the judge that merges them. */
  seats: string[];
  judge: string;
  /** Output tokens per seat. Bounds the cost of every answer. */
  maxTokens: number;
}

export const DEFAULTS: Config = {
  rpc: process.env.COUNCIL_RPC || DEFAULT_RPC,
  mint: process.env.COUNCIL_MINT || null,
  maxPaymentUsd: 1,
  runBudgetUsd: 0.25,
  allowHosts: [],
  seats: ["venice", "claude", "gpt", "grok", "gemini"],
  judge: "claude",
  maxTokens: 700,
};

export function ensureHome() {
  if (!existsSync(HOME)) mkdirSync(HOME, { recursive: true, mode: 0o700 });
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) return { ...DEFAULTS };
  const raw = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  const cfg = { ...DEFAULTS, ...raw } as Config;
  if (process.env.COUNCIL_RPC) cfg.rpc = process.env.COUNCIL_RPC;
  if (process.env.COUNCIL_MINT) cfg.mint = process.env.COUNCIL_MINT;
  return cfg;
}

export function saveConfig(cfg: Config) {
  ensureHome();
  const { rpc, mint, maxPaymentUsd, runBudgetUsd, allowHosts, seats, judge, maxTokens } = cfg;
  writeFileSync(CONFIG_FILE, JSON.stringify({ rpc, mint, maxPaymentUsd, runBudgetUsd, allowHosts, seats, judge, maxTokens }, null, 2) + "\n", { mode: 0o600 });
}

const NUMERIC = new Set(["maxPaymentUsd", "runBudgetUsd", "maxTokens"]);
const LISTS = new Set(["allowHosts", "seats"]);

export function setConfigValue(cfg: Config, key: string, value: string): Config {
  if (!(key in DEFAULTS)) throw new Error(`Unknown key "${key}". Keys: ${Object.keys(DEFAULTS).join(", ")}`);
  const next: any = { ...cfg };
  if (NUMERIC.has(key)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${key} must be a positive number`);
    next[key] = n;
  } else if (LISTS.has(key)) {
    next[key] = value.split(",").map((s) => s.trim()).filter(Boolean);
  } else if (key === "mint") {
    next[key] = value === "none" ? null : value;
  } else {
    next[key] = value;
  }
  return next as Config;
}
