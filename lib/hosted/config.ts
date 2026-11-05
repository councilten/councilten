import "server-only";
import { createHash } from "node:crypto";

const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Hosted councils: a visitor pays the council's wallet once in USDC, and that wallet pays every model
 * over x402. Everything here is read from the environment so it can be tuned without a deploy of code.
 */
export const hosted = {
  /** Off until HOSTED_ENABLED=1, so the page can ship before the table opens. */
  enabled: process.env.HOSTED_ENABLED === "1",
  /** Table fee on top of the worst-case model cost, in basis points (1500 = 15%). */
  markupBps: Math.max(0, Math.round(num(process.env.HOSTED_MARKUP_BPS, 1500))),
  /** No single question may cost more than this. */
  maxUsd: num(process.env.HOSTED_MAX_USD, 0.5),
  /** Holder discount on the table fee, in basis points of the fee (0 = off). */
  holderDiscountBps: Math.max(0, Math.min(10000, Math.round(num(process.env.HOSTED_HOLDER_DISCOUNT_BPS, 0)))),
  /** Tokens a wallet must hold for the holder discount. */
  holderMin: num(process.env.HOSTED_HOLDER_MIN, 1),
  /** Venice credit is refilled by this much when it runs low. */
  veniceTopUpUsd: num(process.env.HOSTED_VENICE_TOPUP_USD, 5),
  /** Councils per wallet per hour. */
  perWalletHour: Math.max(1, Math.round(num(process.env.HOSTED_WALLET_HOURLY, 20))),
  rpc: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
  mint: process.env.NEXT_PUBLIC_TOKEN_MINT || "",
};

export function walletKey(): string {
  const k = process.env.COUNCIL_WALLET_KEY;
  if (!k) throw new Error("COUNCIL_WALLET_KEY is not set");
  return k;
}

/** Secret for signing quotes. Defaults to a hash of the wallet key, so one variable is enough. */
export function quoteSecret(): Buffer {
  const s = process.env.HOSTED_SECRET;
  if (s) return createHash("sha256").update(s).digest();
  return createHash("sha256").update("council-quote:" + walletKey()).digest();
}

/** The table is ready to take money only when it is switched on and has a wallet and a store. */
export function readiness(): { ok: boolean; why?: string } {
  if (!hosted.enabled) return { ok: false, why: "off" };
  if (!process.env.COUNCIL_WALLET_KEY) return { ok: false, why: "no wallet" };
  const store = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || process.env.HOSTED_MEMORY_STORE === "1";
  if (!store) return { ok: false, why: "no store" };
  return { ok: true };
}
