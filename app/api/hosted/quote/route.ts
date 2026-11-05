import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import * as venice from "../../../../kit/src/venice";
import { tokenBalance, rpcOf } from "../../../../kit/src/solana";
import { hosted, readiness } from "@/lib/hosted/config";
import { councilWallet, paymentTransaction, solBalance, usdcBalance } from "@/lib/hosted/chain";
import { clientIp, issue, memoOf, plan, price, QUESTION_MAX, QUESTION_MIN, QuoteError } from "@/lib/hosted/quote";
import { get, hit } from "@/lib/hosted/store";
import { ANSWER_LENGTHS, fmtUsd, type AnswerLength } from "@/lib/hosted/price";

export const dynamic = "force-dynamic";

const isAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/**
 * Price a council. Without a wallet it returns the price only (for the live preview).
 * With a wallet it also returns the one transaction that pays it, and a signed quote that the run checks.
 */
export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return fail("Bad request"); }
  const question = String(body?.question ?? "").trim();
  const seats: string[] = Array.isArray(body?.seats) ? body.seats.map(String).slice(0, 10) : [];
  const length = String(body?.length ?? "standard") as AnswerLength;
  const wallet = body?.wallet ? String(body.wallet) : "";
  if (!(length in ANSWER_LENGTHS)) return fail("Unknown answer length");
  if (question.length > QUESTION_MAX) return fail(`Keep the question under ${QUESTION_MAX} characters`);

  const ip = clientIp(req.headers);
  try {
    if (!wallet) {
      if ((await hit(`hosted:price-ip:${ip}:${Math.floor(Date.now() / 600_000)}`, 600).catch(() => 0)) > 240) return fail("Too many requests, slow down a little", 429);
      const p = await plan(seats, length, question.length >= 4 ? question.length : 120);
      const pr = price(p);
      return NextResponse.json({ priceUsd: pr.usd, costUsd: p.costUsd, feeUsd: pr.feeUsd, judge: p.judge.label, seats: p.seats.map((s) => ({ alias: s.alias, model: s.model.id, provider: s.model.provider, est: s.est })) });
    }

    const ready = readiness();
    if (!ready.ok) return fail(ready.why === "off" ? "The table opens at launch." : "The table is not open yet.", 503);
    if (!isAddress(wallet)) return fail("That is not a Solana address");
    if (question.length < QUESTION_MIN) return fail("Ask a full question");
    if ((await hit(`hosted:quote-wallet:${wallet}:${Math.floor(Date.now() / 3_600_000)}`, 3600)) > hosted.perWalletHour * 3) return fail("Too many quotes from this wallet. Try again within the hour.", 429);
    if (Number((await get(`hosted:runs-wallet:${wallet}:${Math.floor(Date.now() / 3_600_000)}`)) ?? 0) >= hosted.perWalletHour) return fail(`This wallet has convened ${hosted.perWalletHour} councils this hour. Try again later.`, 429);

    const p = await plan(seats, length, question.length);
    let discountBps = 0;
    if (hosted.holderDiscountBps > 0 && hosted.mint) {
      const held = await tokenBalance(rpcOf(hosted.rpc), wallet, hosted.mint).catch(() => 0);
      if (held >= hosted.holderMin) discountBps = hosted.holderDiscountBps;
    }
    const pr = price(p, discountBps);
    if (pr.usd > hosted.maxUsd) return fail(`This council could cost up to ${fmtUsd(pr.usd)}, above the ${fmtUsd(hosted.maxUsd)} limit per question. Drop a seat or pick shorter answers.`);

    const signer = await councilWallet();
    const veniceNeed = p.seats.filter((s) => s.model.provider === "venice").reduce((a, s) => a + s.est, 0) + (p.judge.model.provider === "venice" ? p.judge.est : 0);
    const otherNeed = p.costUsd - veniceNeed;
    const [floatUsdc, credit, userUsdc, userSol] = await Promise.all([
      usdcBalance(signer.address),
      venice.balance(signer).then((b) => b.balanceUsd).catch(() => 0),
      usdcBalance(wallet),
      solBalance(wallet).catch(() => 0),
    ]);
    const veniceOk = credit >= veniceNeed + 0.25 || floatUsdc >= otherNeed + Math.max(hosted.veniceTopUpUsd, veniceNeed + 0.25);
    if (floatUsdc < otherNeed + 0.05 || !veniceOk) return fail("The table is full right now. Nothing was charged. Try again in a few minutes.", 503);
    if (userUsdc < pr.usd) return fail(`This wallet holds ${fmtUsd(userUsdc)} USDC on Solana. This council costs ${fmtUsd(pr.usd)}.`, 402);
    if (userSol < 0.00002) return fail("This wallet needs a little SOL (0.0001 is plenty) for the network fee.", 402);

    const q = createHash("sha256").update(question).digest("hex");
    const { token, claims } = issue({ w: wallet, u: pr.units.toString(), s: p.seats.map((s) => s.alias), l: length, q });
    const tx = await paymentTransaction(wallet, signer.address, pr.units, memoOf(claims));
    return NextResponse.json({
      quote: token,
      tx,
      priceUsd: pr.usd,
      costUsd: p.costUsd,
      feeUsd: pr.feeUsd,
      discounted: discountBps > 0,
      expiresAt: claims.e,
      payTo: signer.address,
      judge: p.judge.label,
      seats: p.seats.map((s) => ({ alias: s.alias, model: s.model.id, provider: s.model.provider, est: s.est })),
    });
  } catch (e: any) {
    if (e instanceof QuoteError) return fail(e.message, e.status);
    console.error("quote", e);
    return fail("Could not price this council right now", 502);
  }
}
