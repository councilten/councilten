import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { LEDGER_FILE } from "./env.js";
import { ensureHome } from "./config.js";

export type EntryKind = "topup" | "inference" | "payment" | "send" | "burn";

export interface Entry {
  t: string;
  kind: EntryKind;
  usd: number;
  provider?: string;
  model?: string;
  url?: string;
  tx?: string;
  run?: string;
  note?: string;
}

/** Append-only spend ledger at ~/.council/ledger.jsonl. One line per payment or charge. */
export function record(e: Omit<Entry, "t">): Entry {
  ensureHome();
  const entry: Entry = { t: new Date().toISOString(), ...e, usd: round6(e.usd) };
  appendFileSync(LEDGER_FILE, JSON.stringify(entry) + "\n", { mode: 0o600 });
  return entry;
}

export function readLedger(limit = 50): Entry[] {
  if (!existsSync(LEDGER_FILE)) return [];
  const lines = readFileSync(LEDGER_FILE, "utf8").trim().split("\n").filter(Boolean);
  return lines.slice(-limit).map((l) => JSON.parse(l) as Entry).reverse();
}

export function spentSince(iso: string): number {
  return readLedger(100000).filter((e) => e.t >= iso && e.kind !== "topup").reduce((s, e) => s + e.usd, 0);
}

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
