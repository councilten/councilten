/**
 * The council's price, shared by the browser (instant preview) and the server (the price that is charged).
 * Same worst case as the CLI (kit/src/council.ts): full prompt in, every allowed token out, never below a
 * gateway's per-call floor, and the judge reads every seat's full answer.
 */
export interface PriceModel {
  input: number;
  output: number;
  minimum?: number;
}

export const ANSWER_LENGTHS = { short: 400, standard: 700, long: 1200 } as const;
export type AnswerLength = keyof typeof ANSWER_LENGTHS;

const estTokens = (chars: number) => Math.ceil(chars / 3.5) + 24;

export function estimate(m: PriceModel, promptChars: number, maxTokens: number): number {
  return Math.max((estTokens(promptChars) * m.input + maxTokens * m.output) / 1e6, m.minimum ?? 0);
}

export function councilCost(seats: PriceModel[], judge: PriceModel, questionChars: number, maxTokens: number) {
  const seatEst = seats.map((m) => estimate(m, questionChars, maxTokens));
  const judgeEst = estimate(judge, questionChars + seats.length * maxTokens * 3.5, maxTokens * 1.5);
  return { seatEst, judgeEst, total: seatEst.reduce((a, b) => a + b, 0) + judgeEst };
}

/** USDC base units (6 decimals) charged for a council: cost plus the table fee, rounded up to $0.001, never under $0.01. */
export function chargeUnits(costUsd: number, markupBps: number, discountBps = 0): bigint {
  const fee = costUsd * (markupBps / 10_000) * (1 - discountBps / 10_000);
  const usd = costUsd + fee;
  return BigInt(Math.max(10, Math.ceil(usd * 1000 - 1e-9)) * 1000);
}

export const usdOfUnits = (u: bigint | number) => Number(u) / 1e6;
export const fmtUsd = (n: number) => (n < 0.1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
