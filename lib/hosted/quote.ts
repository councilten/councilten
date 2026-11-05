import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { THE_TEN, type Model } from "../../kit/src/families";
import { getCatalog } from "../models";
import { hosted, quoteSecret } from "./config";
import { ANSWER_LENGTHS, chargeUnits, councilCost, usdOfUnits, type AnswerLength } from "./price";

export const QUESTION_MIN = 4;
export const QUESTION_MAX = 1200;
export const QUOTE_TTL_SEC = 180;

export interface Plan {
  seats: { alias: string; label: string; model: Model; est: number }[];
  judge: { alias: string; label: string; model: Model; est: number };
  maxTokens: number;
  costUsd: number;
}

export class QuoteError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Resolve the requested seats against today's live catalogs and price the run at its worst case. */
export async function plan(aliases: string[], length: AnswerLength, questionChars: number): Promise<Plan> {
  const maxTokens = ANSWER_LENGTHS[length];
  if (!maxTokens) throw new QuoteError("Unknown answer length");
  const wanted = [...new Set(aliases)].filter((a) => (THE_TEN as readonly string[]).includes(a));
  if (wanted.length < 2) throw new QuoteError("Pick at least two seats");
  const cat = await getCatalog();
  const live = cat.seats.filter((s) => s.model);
  const seats = wanted.map((a) => live.find((s) => s.alias === a)).filter(Boolean) as { alias: string; label: string; model: Model }[];
  if (seats.length < 2) throw new QuoteError("Those seats are not available right now", 503);
  const j = live.find((s) => s.alias === "claude") ?? live[0];
  const { seatEst, judgeEst, total } = councilCost(seats.map((s) => s.model), j.model!, questionChars, maxTokens);
  return {
    seats: seats.map((s, i) => ({ ...s, est: seatEst[i] })),
    judge: { alias: j.alias, label: j.label, model: j.model!, est: judgeEst },
    maxTokens,
    costUsd: total,
  };
}

export function price(p: Plan, discountBps = 0) {
  const units = chargeUnits(p.costUsd, hosted.markupBps, discountBps);
  return { units, usd: usdOfUnits(units), feeUsd: usdOfUnits(units) - p.costUsd };
}

/* ---------------------------------------------------------------- signed quotes */

export interface QuoteClaims {
  n: string; // nonce, also the transaction memo
  w: string; // payer wallet
  u: string; // USDC units charged
  s: string[]; // seats
  l: AnswerLength;
  q: string; // sha256 of the question
  e: number; // expiry, unix seconds
}

const b64u = (b: Buffer) => b.toString("base64url");
const sign = (body: string) => b64u(createHmac("sha256", quoteSecret()).update(body).digest());

export function issue(claims: Omit<QuoteClaims, "n" | "e">): { token: string; claims: QuoteClaims } {
  const full: QuoteClaims = { ...claims, n: randomBytes(9).toString("base64url"), e: Math.floor(Date.now() / 1000) + QUOTE_TTL_SEC };
  const body = b64u(Buffer.from(JSON.stringify(full)));
  return { token: `${body}.${sign(body)}`, claims: full };
}

export function read(token: string): QuoteClaims {
  const [body, mac] = String(token || "").split(".");
  if (!body || !mac) throw new QuoteError("Invalid quote");
  const want = Buffer.from(sign(body)), got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new QuoteError("Invalid quote");
  const c = JSON.parse(Buffer.from(body, "base64url").toString()) as QuoteClaims;
  // A quote can be paid within its lifetime; the run may start a little later while the payment confirms.
  if (c.e + 120 < Date.now() / 1000) throw new QuoteError("This quote expired. Nothing was charged; ask again.", 410);
  return c;
}

export const memoOf = (c: QuoteClaims) => `council:${c.n}`;

export function clientIp(h: Headers): string {
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
}
