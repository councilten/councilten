import "server-only";
import type { KeyPairSigner } from "@solana/kit";
import * as venice from "../../kit/src/venice";
import * as blockrun from "../../kit/src/blockrun";
import { rpcOf, send } from "../../kit/src/solana";
import { USDC_MINT } from "../../kit/src/env";
import type { Model } from "../../kit/src/families";
import { hosted } from "./config";
import { councilWallet, verifyPayment } from "./chain";
import { memoOf, plan, type Plan, type QuoteClaims } from "./quote";
import { addFloat, claim, get, hit, release } from "./store";
import { usdOfUnits } from "./price";

export type Event =
  | { type: "confirming" }
  | { type: "paid"; tx: string; usd: number }
  | { type: "seat"; alias: string; label: string; model: string; provider: string; ms: number; text?: string; error?: string }
  | { type: "judging"; model: string }
  | { type: "verdict"; model: string; text: string; split: string; ms: number; solo?: boolean }
  | { type: "refund"; tx?: string; usd: number; error?: string }
  | { type: "error"; message: string }
  | { type: "done"; ms: number; chargedUsd: number; spentUsd: number; answered: number; seats: number };

const JUDGE_SYSTEM = [
  "You chair a council of AI models. You receive one question and the members' answers.",
  "Write the single best answer to the question. Keep what is correct, drop what is wrong or unsupported,",
  "and resolve disagreements on the merits, not by majority. Do not mention the members or this process in the answer.",
  "Be concise: at most 180 words.",
  "After the answer, add one line starting with 'Split:' naming the main point the members disagreed on, or 'Split: none'.",
].join(" ");

const SEAT_SYSTEM = "Answer the question directly and concisely, in at most 150 words. No preamble.";

const costOf = (m: Model, u: { input: number; output: number }) => Math.max((u.input * m.input + u.output * m.output) / 1e6, m.minimum ?? 0);

async function chat(signer: KeyPairSigner, m: Model, messages: { role: "system" | "user"; content: string }[], maxTokens: number, ceiling: number) {
  const r =
    m.provider === "venice"
      ? await venice.chat(signer, m.id, messages, maxTokens)
      : await blockrun.chat(signer, hosted.rpc, m.id, messages, maxTokens, ceiling);
  return { text: (r.text || "").trim(), ms: r.ms, usd: r.usd ?? costOf(m, r.usage) };
}

/** Venice draws on prepaid credit. Refill it from the council's USDC before a run that needs it. */
async function ensureVeniceCredit(signer: KeyPairSigner, needUsd: number) {
  if (needUsd <= 0) return;
  const bal = await venice.balance(signer).catch(() => null);
  if (bal && bal.balanceUsd >= needUsd + 0.25) return;
  if (!(await claim("hosted:topup-lock", 90))) {
    await new Promise((r) => setTimeout(r, 4000)); // another run is refilling right now
    return;
  }
  try {
    const amount = Math.max(hosted.veniceTopUpUsd, bal?.minimumTopUpUsd ?? 0, Math.ceil(needUsd + 0.25));
    await venice.topUp(signer, hosted.rpc, amount);
    await addFloat("hosted:topups", amount);
  } finally {
    await release("hosted:topup-lock");
  }
}

function splitVerdict(text: string) {
  const lines = text.trim().split("\n");
  const i = lines.findIndex((l) => /^\s*\**split:?\**/i.test(l));
  if (i < 0) return { text: text.trim(), split: "" };
  const split = lines[i].replace(/^\s*\**split:?\**\s*/i, "").trim();
  return { text: lines.filter((_, k) => k !== i).join("\n").trim(), split: /^none\.?$/i.test(split) ? "" : split };
}

/**
 * One paid council. Emits events as they happen: confirming, paid, a seat each time a model answers,
 * judging, the verdict, then done. If no seat answers at all, the visitor is refunded in full.
 */
export async function* hostedCouncil(c: QuoteClaims, question: string, signature: string): AsyncGenerator<Event> {
  const started = Date.now();
  const units = BigInt(c.u);
  const signer = await councilWallet();

  yield { type: "confirming" };
  const v = await verifyPayment(signature, c.w, signer.address, units, memoOf(c));
  if (!v.ok) { yield { type: "error", message: v.why! }; return; }
  // The memo binds this transaction to this quote, so one claim on the nonce stops any replay.
  if (!(await claim(`hosted:nonce:${c.n}`, 7 * 86400, signature))) {
    const prev = await get(`hosted:nonce:${c.n}`);
    yield { type: "error", message: prev === signature ? "This payment already ran a council." : "This quote was already used." };
    return;
  }
  await hit(`hosted:runs-wallet:${c.w}:${Math.floor(Date.now() / 3_600_000)}`, 3600);
  yield { type: "paid", tx: signature, usd: usdOfUnits(units) };

  let p: Plan;
  try {
    p = await plan(c.s, c.l, question.length);
  } catch (e: any) {
    yield* refund(signer, c, units, e.message);
    return;
  }

  const veniceNeed = p.seats.filter((s) => s.model.provider === "venice").reduce((a, s) => a + s.est, 0) + (p.judge.model.provider === "venice" ? p.judge.est : 0);
  await ensureVeniceCredit(signer, veniceNeed).catch(() => undefined);

  // Every seat in parallel; each answer is streamed the moment it lands.
  const messages = [{ role: "system" as const, content: SEAT_SYSTEM }, { role: "user" as const, content: question }];
  const queue: Event[] = [];
  let wake: (() => void) | null = null;
  const answers: { label: string; text: string }[] = [];
  let spent = 0;
  let pending = p.seats.length;
  p.seats.forEach((s) => {
    chat(signer, s.model, messages, p.maxTokens, Math.max(s.est * 1.5, 0.003))
      .then((r) => {
        spent += r.usd;
        if (r.text) answers.push({ label: s.label, text: r.text });
        queue.push({ type: "seat", alias: s.alias, label: s.label, model: s.model.id, provider: s.model.provider, ms: r.ms, ...(r.text ? { text: r.text } : { error: "Empty answer" }) });
      })
      .catch((e: any) => {
        queue.push({ type: "seat", alias: s.alias, label: s.label, model: s.model.id, provider: s.model.provider, ms: 0, error: String(e?.message ?? e).slice(0, 160) });
      })
      .finally(() => { pending -= 1; wake?.(); });
  });
  while (pending > 0 || queue.length) {
    if (!queue.length) await new Promise<void>((r) => (wake = r));
    wake = null;
    while (queue.length) yield queue.shift()!;
  }

  if (answers.length === 0) {
    yield* refund(signer, c, units, "No seat could answer right now.");
    return;
  }

  if (answers.length === 1) {
    yield { type: "verdict", model: answers[0].label, text: answers[0].text, split: "", ms: 0, solo: true };
  } else {
    yield { type: "judging", model: p.judge.model.id };
    const prompt = [`Question:\n${question}`, ...answers.map((a, i) => `Member ${i + 1}:\n${a.text}`)].join("\n\n---\n\n");
    try {
      const r = await chat(signer, p.judge.model, [{ role: "system", content: JUDGE_SYSTEM }, { role: "user", content: prompt }], Math.round(p.maxTokens * 1.5), Math.max(p.judge.est * 1.5, 0.003));
      spent += r.usd;
      const { text, split } = splitVerdict(r.text);
      yield { type: "verdict", model: p.judge.model.id, text: text || "The judge returned an empty verdict. Every seat's answer is above.", split, ms: r.ms };
    } catch (e: any) {
      yield { type: "verdict", model: p.judge.model.id, text: "The judge could not be reached. Every seat's answer is above.", split: "", ms: 0 };
    }
  }

  await Promise.all([hit("hosted:runs", 10 * 365 * 86400), addFloat("hosted:charged", usdOfUnits(units)), addFloat("hosted:spent", spent)]).catch(() => undefined);
  yield { type: "done", ms: Date.now() - started, chargedUsd: usdOfUnits(units), spentUsd: spent, answered: answers.length, seats: p.seats.length };
}

async function* refund(signer: KeyPairSigner, c: QuoteClaims, units: bigint, why: string): AsyncGenerator<Event> {
  yield { type: "error", message: `${why} Refunding your payment.` };
  try {
    const r: any = await send(rpcOf(hosted.rpc), signer, c.w, usdOfUnits(units), USDC_MINT);
    yield { type: "refund", tx: typeof r === "string" ? r : r?.signature ?? r?.tx, usd: usdOfUnits(units) };
  } catch (e: any) {
    yield { type: "refund", usd: usdOfUnits(units), error: "The refund could not be sent automatically. It will be sent manually." };
  }
}
