import "server-only";
import { env } from "./site";

async function rpc<T = any>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(env.rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    next: { revalidate: 120 },
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message ?? "RPC error");
  return j.result as T;
}

export interface Ledger {
  state: "unset" | "unavailable" | "live";
  mint?: string;
  supply?: number;
  decimals?: number;
  mintAuthority?: string | null;
  freezeAuthority?: string | null;
  program?: string;
  top?: { owner: string; amount: number; pct: number }[];
  top10Pct?: number;
  burns?: { signature: string; amount: number; time: number | null }[];
  burned?: number;
  slot?: number;
  error?: string;
}

/** The Council mint, read from Solana. Nothing on this page is typed by hand. */
export async function getLedger(): Promise<Ledger> {
  if (!env.mint) return { state: "unset" };
  if (!env.rpc) return { state: "unavailable", mint: env.mint, error: "No RPC configured" };
  try {
    const [acc, largest, slot] = await Promise.all([
      rpc("getAccountInfo", [env.mint, { encoding: "jsonParsed" }]),
      rpc("getTokenLargestAccounts", [env.mint]),
      rpc<number>("getSlot", []),
    ]);
    const info = acc?.value?.data?.parsed?.info;
    if (!info) throw new Error("Not a token mint");
    const decimals = Number(info.decimals);
    const supply = Number(info.supply) / 10 ** decimals;
    const accounts: any[] = largest?.value ?? [];
    const owners = accounts.length
      ? await rpc("getMultipleAccounts", [accounts.map((a) => a.address), { encoding: "jsonParsed" }])
      : { value: [] };
    const top = accounts.map((a, i) => {
      const owner = owners.value?.[i]?.data?.parsed?.info?.owner ?? a.address;
      const amount = Number(a.uiAmount ?? 0);
      return { owner, amount, pct: supply ? (amount / supply) * 100 : 0 };
    });
    const sigs: any[] = await rpc("getSignaturesForAddress", [env.mint, { limit: 25 }]);
    const burns: Ledger["burns"] = [];
    for (const s of sigs.filter((x) => !x.err)) {
      const tx = await rpc("getTransaction", [s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }]);
      const ixs = [...(tx?.transaction?.message?.instructions ?? []), ...((tx?.meta?.innerInstructions ?? []).flatMap((i: any) => i.instructions))];
      for (const ix of ixs) {
        const p = ix?.parsed;
        if (p && (p.type === "burn" || p.type === "burnChecked") && p.info?.mint === env.mint) {
          const amt = p.info.tokenAmount?.uiAmount ?? Number(p.info.amount) / 10 ** decimals;
          burns.push({ signature: s.signature, amount: Number(amt), time: s.blockTime ?? null });
        }
      }
    }
    return {
      state: "live",
      mint: env.mint,
      supply,
      decimals,
      program: acc.value.owner,
      mintAuthority: info.mintAuthority ?? null,
      freezeAuthority: info.freezeAuthority ?? null,
      top,
      top10Pct: top.slice(0, 10).reduce((s, h) => s + h.pct, 0),
      burns,
      burned: burns.reduce((s, b) => s + b.amount, 0),
      slot,
    };
  } catch (e: any) {
    return { state: "unavailable", mint: env.mint, error: e?.message ?? "RPC unreachable" };
  }
}
