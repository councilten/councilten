import { randomBytes } from "node:crypto";
import type { KeyPairSigner } from "@solana/kit";
import { actual, catalog, estimate, resolve, type Seat } from "./catalog.js";
import * as venice from "./venice.js";
import * as blockrun from "./blockrun.js";
import { record } from "./ledger.js";
import type { ChatMessage, ChatResult } from "./types.js";

export class BudgetExceeded extends Error {}

export interface SeatAnswer {
  seat: string;
  label: string;
  model: string;
  provider: string;
  text: string;
  ms: number;
  usd: number;
  tx?: string;
  error?: string;
}

export interface Run {
  id: string;
  question: string;
  answers: SeatAnswer[];
  verdict?: SeatAnswer;
  budgetUsd: number;
  estimateUsd: number;
  spentUsd: number;
}

interface Ctx {
  signer: KeyPairSigner;
  rpc: string;
  maxTokens: number;
  maxPaymentUsd: number;
}

async function call(ctx: Ctx, seat: Seat, messages: ChatMessage[], runId: string, ceilingUsd: number): Promise<SeatAnswer> {
  const base = { seat: seat.alias, label: seat.label, model: seat.model.id, provider: seat.model.provider };
  try {
    let r: ChatResult;
    if (seat.model.provider === "venice") r = await venice.chat(ctx.signer, seat.model.id, messages, ctx.maxTokens);
    else r = await blockrun.chat(ctx.signer, ctx.rpc, seat.model.id, messages, ctx.maxTokens, Math.min(ceilingUsd, ctx.maxPaymentUsd));
    const usd = r.usd ?? actual(seat.model, r.usage);
    record({ kind: "inference", provider: seat.model.provider, model: seat.model.id, usd, tx: r.tx, run: runId });
    return { ...base, text: r.text.trim(), ms: r.ms, usd, tx: r.tx };
  } catch (e: any) {
    return { ...base, text: "", ms: 0, usd: 0, error: e?.message ?? String(e) };
  }
}

const JUDGE_SYSTEM = [
  "You chair a council of AI models. You receive one question and the members' answers.",
  "Write the single best answer to the question. Keep what is correct, drop what is wrong or unsupported,",
  "and resolve disagreements on the merits, not by majority. Do not mention the members or this process in the answer.",
  "After the answer, add one line starting with 'Split:' naming the main point the members disagreed on, or 'Split: none'.",
].join(" ");

function judgePrompt(q: string, answers: SeatAnswer[]): string {
  const ok = answers.filter((a) => !a.error && a.text);
  return [`Question:\n${q}`, ...ok.map((a, i) => `Member ${i + 1}:\n${a.text}`)].join("\n\n---\n\n");
}

/** One model, one answer, inside a budget. */
export async function ask(ctx: Ctx, question: string, ref: string, budgetUsd: number, system?: string): Promise<Run> {
  const models = await catalog();
  const seat = resolve(ref, models);
  const messages: ChatMessage[] = [...(system ? [{ role: "system" as const, content: system }] : []), { role: "user", content: question }];
  const est = estimate(seat.model, question.length + (system?.length ?? 0), ctx.maxTokens);
  if (est > budgetUsd) throw new BudgetExceeded(`${seat.model.id} could cost up to $${est.toFixed(4)}, above the $${budgetUsd} budget. Raise --budget or lower --max-tokens.`);
  const id = randomBytes(4).toString("hex");
  const a = await call(ctx, seat, messages, id, budgetUsd);
  return { id, question, answers: [a], budgetUsd, estimateUsd: est, spentUsd: a.usd };
}

/**
 * Convene the council: every seat answers in parallel, then the judge merges them into one answer.
 * The whole run is priced at its worst case before anything is paid; above the budget, nothing runs.
 */
export async function convene(ctx: Ctx, question: string, refs: string[], judgeRef: string, budgetUsd: number): Promise<Run> {
  const models = await catalog();
  const seats: Seat[] = [];
  const skipped: SeatAnswer[] = [];
  for (const r of refs) {
    try {
      const s = resolve(r, models);
      if (!seats.some((x) => x.model.id === s.model.id)) seats.push(s);
    } catch (e: any) {
      skipped.push({ seat: r, label: r, model: "", provider: "", text: "", ms: 0, usd: 0, error: e.message });
    }
  }
  if (!seats.length) throw new Error("No seat resolved to a live model");
  const judge = resolve(judgeRef, models);
  const seatEst = seats.map((s) => estimate(s.model, question.length, ctx.maxTokens));
  const judgeEst = estimate(judge.model, question.length + seats.length * ctx.maxTokens * 3.5, ctx.maxTokens * 1.5);
  const est = seatEst.reduce((a, b) => a + b, 0) + judgeEst;
  if (est > budgetUsd) {
    throw new BudgetExceeded(`This council could cost up to $${est.toFixed(4)} (${seats.length} seats + judge), above the $${budgetUsd} budget. Raise --budget, drop seats or lower --max-tokens.`);
  }
  const id = randomBytes(4).toString("hex");
  const messages: ChatMessage[] = [{ role: "user", content: question }];
  const answers = await Promise.all(seats.map((s, i) => call(ctx, s, messages, id, seatEst[i])));
  const good = answers.filter((a) => !a.error && a.text);
  let verdict: SeatAnswer | undefined;
  if (good.length >= 2) {
    verdict = await call(
      { ...ctx, maxTokens: Math.round(ctx.maxTokens * 1.5) },
      judge,
      [{ role: "system", content: JUDGE_SYSTEM }, { role: "user", content: judgePrompt(question, good) }],
      id,
      judgeEst,
    );
  }
  const all = [...answers, ...skipped];
  const spent = all.reduce((s, a) => s + a.usd, 0) + (verdict?.usd ?? 0);
  return { id, question, answers: all, verdict, budgetUsd, estimateUsd: est, spentUsd: spent };
}
