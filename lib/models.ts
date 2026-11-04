import "server-only";
import { FAMILIES, THE_TEN, parseBlockrun, parseVenice, resolve, type Model } from "../kit/src/families";

const VENICE = process.env.VENICE_MODELS_URL || "https://api.venice.ai/api/v1/models?type=text";
const BLOCKRUN = process.env.BLOCKRUN_MODELS_URL || "https://sol.blockrun.ai/api/v1/models";

export interface SeatRow {
  alias: string;
  label: string;
  model: Model | null;
}

export interface Catalog {
  ok: boolean;
  updatedAt: string;
  total: number;
  venice: number;
  blockrun: number;
  seats: SeatRow[];
}

async function get(url: string) {
  const res = await fetch(url, { next: { revalidate: 600 }, headers: { accept: "application/json", "user-agent": "council-site" } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** Both public catalogs, re-read every ten minutes. The aliases resolve exactly as the CLI resolves them. */
export async function getCatalog(): Promise<Catalog> {
  const [v, b] = await Promise.allSettled([get(VENICE), get(BLOCKRUN)]);
  const vm = v.status === "fulfilled" ? parseVenice(v.value) : [];
  const bm = b.status === "fulfilled" ? parseBlockrun(b.value) : [];
  const all = [...vm, ...bm];
  const seats = THE_TEN.map((alias) => {
    try {
      return { alias, label: FAMILIES[alias].label, model: resolve(alias, all).model };
    } catch {
      return { alias, label: FAMILIES[alias].label, model: null };
    }
  });
  return { ok: all.length > 0, updatedAt: new Date().toISOString(), total: all.length, venice: vm.length, blockrun: bm.length, seats };
}

/** What one seat costs for a short answer at today's prices: 60 tokens in, 220 out, never below the gateway floor. */
export function seatCost(m: Model | null, inTok = 60, outTok = 220): number {
  if (!m) return 0;
  return Math.max((inTok * m.input + outTok * m.output) / 1e6, m.minimum ?? 0);
}
