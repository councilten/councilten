"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WalletAccount } from "@wallet-standard/base";
import { BLADES } from "@/lib/mark";
import { ANSWER_LENGTHS, chargeUnits, councilCost, fmtUsd, usdOfUnits, type AnswerLength, type PriceModel } from "@/lib/hosted/price";
import { connect, disconnect, listWallets, onWallets, signAndSend, type SolanaWallet } from "@/lib/wallet-client";
import { Logo } from "./Logo";

export interface AskSeat {
  alias: string;
  label: string;
  model: (PriceModel & { id: string; provider: string }) | null;
}

interface Props {
  seats: AskSeat[];
  judge: (PriceModel & { id: string }) | null;
  markupBps: number;
  maxUsd: number;
  open: boolean;
  closedReason?: string;
}

type Phase = "idle" | "quoting" | "signing" | "confirming" | "running" | "judging" | "done" | "error";
interface SeatRun { status: "waiting" | "ok" | "fail"; ms?: number; text?: string; error?: string; model?: string }

const DEFAULT = ["venice", "claude", "gpt", "grok", "gemini"];
const LENGTHS: [AnswerLength, string][] = [["short", "Short"], ["standard", "Standard"], ["long", "Long"]];
const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const EXAMPLE = "Should a treasury agent keep its USDC on Solana or bridge half to Base?";

export function Ask({ seats, judge, markupBps, maxUsd, open: openAtRender, closedReason: reasonAtRender }: Props) {
  const live = seats.filter((s) => s.model);
  const [open, setOpen] = useState(openAtRender);
  const [closedReason, setClosedReason] = useState(reasonAtRender);
  useEffect(() => {
    if (!openAtRender) return;
    fetch("/api/hosted/status").then((r) => r.json()).then((s) => { setOpen(Boolean(s.open)); setClosedReason(s.reason); }).catch(() => undefined);
  }, [openAtRender]);
  const [q, setQ] = useState("");
  const [on, setOn] = useState<string[]>(() => DEFAULT.filter((a) => live.some((s) => s.alias === a)));
  const [len, setLen] = useState<AnswerLength>("standard");
  const [wallets, setWallets] = useState<SolanaWallet[]>([]);
  const [picker, setPicker] = useState(false);
  const [w, setW] = useState<SolanaWallet | null>(null);
  const [acct, setAcct] = useState<WalletAccount | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState("");
  const [runs, setRuns] = useState<Record<string, SeatRun>>({});
  const [verdict, setVerdict] = useState<{ text: string; split: string; model: string; solo?: boolean } | null>(null);
  const [receipt, setReceipt] = useState<{ tx: string; usd: number } | null>(null);
  const [refund, setRefund] = useState<{ tx?: string; usd: number; error?: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [opened, setOpened] = useState<string | null>(null);
  const t0 = useRef(0);
  const tableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sync = () => setWallets(listWallets());
    sync();
    return onWallets(sync);
  }, []);

  // Live preview of the fixed price, with the same formula the server charges.
  const price = useMemo(() => {
    const chosen = live.filter((s) => on.includes(s.alias));
    if (chosen.length < 2 || !judge) return null;
    // Same input as the server: the real question once there is one, a typical length before that.
    const chars = q.trim().length >= 4 ? q.trim().length : 120;
    const c = councilCost(chosen.map((s) => s.model!), judge, chars, ANSWER_LENGTHS[len]);
    return usdOfUnits(chargeUnits(c.total, markupBps));
  }, [live, on, q, len, judge, markupBps]);

  const busy = ["quoting", "signing", "confirming", "running", "judging"].includes(phase);
  const toggle = (a: string) => !busy && setOn((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));

  const pickWallet = useCallback(async (sw: SolanaWallet) => {
    setPicker(false);
    setErr("");
    try {
      const a = await connect(sw);
      setW(sw);
      setAcct(a);
    } catch (e: any) {
      setErr(e?.message?.includes("reject") ? "Connection was cancelled in the wallet." : "The wallet did not connect.");
    }
  }, []);

  const onConnect = () => {
    setErr("");
    if (wallets.length === 1) return void pickWallet(wallets[0]);
    setPicker(true);
  };

  const onDisconnect = async () => {
    if (w) await disconnect(w);
    setW(null);
    setAcct(null);
  };

  useEffect(() => {
    if (!["confirming", "running", "judging"].includes(phase)) return;
    const id = setInterval(() => setElapsed(performance.now() - t0.current), 100);
    return () => clearInterval(id);
  }, [phase]);

  const convene = async () => {
    if (!w || !acct) return;
    const question = q.trim();
    if (question.length < 4) return setErr("Type a question first.");
    setErr("");
    setVerdict(null);
    setReceipt(null);
    setRefund(null);
    setOpened(null);
    setRuns({});
    setPhase("quoting");
    let quote: any;
    try {
      const r = await fetch("/api/hosted/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question, seats: on, length: len, wallet: acct.address }) });
      quote = await r.json();
      if (!r.ok) throw new Error(quote.error || "Could not price this council");
    } catch (e: any) {
      setPhase("error");
      return setErr(e.message);
    }
    setPhase("signing");
    let signature: string;
    try {
      signature = await signAndSend(w, acct, quote.tx);
    } catch (e: any) {
      setPhase("idle");
      return setErr(/reject|cancel|denied/i.test(String(e?.message)) ? "Payment cancelled in the wallet. Nothing was charged." : "The wallet could not send the payment. Nothing was charged.");
    }
    setRuns(Object.fromEntries(quote.seats.map((s: any) => [s.alias, { status: "waiting", model: s.model } as SeatRun])));
    t0.current = performance.now();
    setElapsed(0);
    setPhase("confirming");
    // On narrow screens the table sits under the form: bring it into view once the payment is sent.
    if (window.matchMedia("(max-width: 1020px)").matches) tableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      const r = await fetch("/api/hosted/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quote: quote.quote, question, signature }) });
      if (!r.ok || !r.body) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b.error || "The council could not start");
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let failed = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === "paid") { setReceipt({ tx: e.tx, usd: e.usd }); setPhase("running"); }
          else if (e.type === "seat") setRuns((p) => ({ ...p, [e.alias]: { status: e.text ? "ok" : "fail", ms: e.ms, text: e.text, error: e.error, model: e.model } }));
          else if (e.type === "judging") setPhase("judging");
          else if (e.type === "verdict") setVerdict({ text: e.text, split: e.split, model: e.model, solo: e.solo });
          else if (e.type === "refund") setRefund({ tx: e.tx, usd: e.usd, error: e.error });
          else if (e.type === "error") { failed = true; setErr(e.message); }
          else if (e.type === "done") setElapsed(e.ms);
        }
      }
      setPhase(failed ? "error" : "done");
    } catch (e: any) {
      setPhase("error");
      setErr(e.message);
    }
  };

  const chosen = live.filter((s) => on.includes(s.alias));
  const answered = Object.values(runs).filter((r) => r.status !== "waiting").length;
  const total = Object.keys(runs).length || chosen.length;
  const status =
    phase === "quoting" ? "Pricing the council"
    : phase === "signing" ? "Approve the payment in your wallet"
    : phase === "confirming" ? "Confirming your payment on Solana"
    : phase === "running" ? `Seats answering · ${answered} of ${total}`
    : phase === "judging" ? "The judge is writing the verdict"
    : phase === "done" ? `Council closed in ${secs(elapsed)}`
    : phase === "error" ? "Stopped"
    : open ? "The table is waiting for a question" : "The table opens at launch";

  const button = !open
    ? { label: closedReason === "float" ? "The table is full, back soon" : "The table opens at launch", disabled: true, act: () => {} }
    : !acct
      ? { label: "Connect wallet", disabled: false, act: onConnect }
      : busy
        ? { label: phase === "signing" ? "Waiting for your wallet" : phase === "quoting" ? "Pricing" : "The council is in session", disabled: true, act: () => {} }
        : { label: price ? `Pay ${fmtUsd(price)} and convene` : "Pick at least two seats", disabled: !price || q.trim().length < 4 || price > maxUsd, act: convene };

  const bladeState = (i: number) => {
    const s = seats[i];
    if (!s || !on.includes(s.alias)) return "off";
    const r = runs[s.alias];
    if (!r) return "on";
    return r.status === "waiting" ? "wait" : r.status;
  };

  return (
    <div className="ask">
      <div className="ask-form">
        <label className="ask-field">
          <span className="label">Your question</span>
          <textarea
            value={q}
            maxLength={1200}
            rows={4}
            placeholder={EXAMPLE}
            disabled={busy}
            onChange={(e) => setQ(e.target.value)}
          />
          <span className="ask-count num">{q.length} / 1200</span>
        </label>

        <div className="ask-field">
          <div className="ask-row">
            <span className="label">Seats</span>
            <span className="ask-meta num">{chosen.length} of {live.length}</span>
            <span className="ask-quick">
              <button type="button" disabled={busy} onClick={() => setOn(DEFAULT.filter((a) => live.some((s) => s.alias === a)))}>Five</button>
              <button type="button" disabled={busy} onClick={() => setOn(live.map((s) => s.alias))}>All ten</button>
            </span>
          </div>
          <div className="ask-seats" role="group" aria-label="Seats at the table">
            {seats.map((s) => (
              <button key={s.alias} type="button" className="ask-seat" disabled={!s.model || busy} aria-pressed={on.includes(s.alias)} onClick={() => toggle(s.alias)}>
                <i aria-hidden="true" />
                <Logo k={s.alias} size={22} className="ask-seat-logo" />
                <b>{s.label}</b>
                <span className="num">{s.model ? s.model.id.replace(/^[a-z-]+\//, "") : "unavailable"}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="ask-field">
          <span className="label">Answer length</span>
          <div className="ask-seg" role="radiogroup" aria-label="Answer length">
            {LENGTHS.map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={len === k} disabled={busy} onClick={() => setLen(k)}>{l}</button>
            ))}
          </div>
        </div>

        <div className="ask-price">
          <div>
            <span className="label">Fixed price</span>
            <div className="ask-usd num"><Logo k="usdc" size={30} />{price ? fmtUsd(price) : "—"}</div>
          </div>
          <p>Set before you pay, in USDC. Includes a {(markupBps / 100).toFixed(0)}% table fee.{price && price > maxUsd ? ` Above the ${fmtUsd(maxUsd)} limit: drop a seat or pick shorter answers.` : ""}</p>
        </div>

        {acct && (
          <div className="ask-wallet">
            {w?.icon && <img src={w.icon} alt="" width={18} height={18} />}
            <span className="num">{short(acct.address)}</span>
            <button type="button" onClick={onDisconnect} disabled={busy}>Disconnect</button>
          </div>
        )}

        <button type="button" className="btn btn-primary ask-go" disabled={button.disabled} onClick={button.act}>{button.label}</button>

        {picker && (
          <div className="ask-picker" role="dialog" aria-label="Choose a wallet">
            {wallets.length ? (
              wallets.map((sw) => (
                <button key={sw.name} type="button" onClick={() => pickWallet(sw)}>
                  <img src={sw.icon} alt="" width={22} height={22} />
                  {sw.name}
                </button>
              ))
            ) : (
              <div className="ask-nowallet">
                <p>No Solana wallet found in this browser. Install Phantom or Solflare, or open this page in your wallet app.</p>
                <a className="btn btn-quiet" href={`https://phantom.app/ul/browse/${typeof window !== "undefined" ? encodeURIComponent(window.location.href) : ""}?ref=${typeof window !== "undefined" ? encodeURIComponent(window.location.origin) : ""}`}>Open in Phantom</a>
              </div>
            )}
            <button type="button" className="ask-x" onClick={() => setPicker(false)}>Close</button>
          </div>
        )}

        {err && <p className="ask-err" role="alert">{err}</p>}
        <p className="ask-fine">One USDC payment from your wallet to the council&apos;s wallet. The council pays each model over x402 on Solana. Answers are AI output, not advice.</p>
      </div>

      <div className="ask-table" aria-live="polite" ref={tableRef}>
        <div className="ask-top">
          <svg className="ask-mark" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <linearGradient id="ask-g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#F7A47E" />
                <stop offset=".5" stopColor="#E2703F" />
                <stop offset="1" stopColor="#B3461F" />
              </linearGradient>
            </defs>
            {BLADES.map((d, i) => <path key={i} d={d} data-s={bladeState(i)} />)}
          </svg>
          <div>
            <span className="ask-status" data-phase={phase}>{status}</span>
            {receipt && (
              <a className="ask-receipt num" href={`https://solscan.io/tx/${receipt.tx}`} target="_blank" rel="noopener"><Logo k="usdc" size={13} />Paid {fmtUsd(receipt.usd)} USDC · view payment</a>
            )}
          </div>
        </div>

        <ul className="ask-list">
          {(Object.keys(runs).length ? Object.keys(runs) : chosen.map((s) => s.alias)).map((a) => {
            const s = seats.find((x) => x.alias === a)!;
            const r = runs[a];
            const st = r?.status ?? "idle";
            const can = st === "ok" || st === "fail";
            return (
              <li key={a} data-s={st}>
                <button type="button" disabled={!can} aria-expanded={opened === a} onClick={() => setOpened(opened === a ? null : a)}>
                  <i aria-hidden="true" />
                  <b><Logo k={a} size={16} />{s.label}</b>
                  <span className="num m">{(r?.model ?? s.model?.id ?? "").replace(/^[a-z-]+\//, "")}</span>
                  <span className="num t">{st === "ok" ? secs(r!.ms!) : st === "fail" ? "no answer" : st === "waiting" ? "thinking" : ""}</span>
                </button>
                {opened === a && can && <div className="ask-ans">{r!.text ?? r!.error}</div>}
              </li>
            );
          })}
        </ul>

        {verdict ? (
          <div className="ask-verdict">
            <div className="ask-vh">
              <span className="label">{verdict.solo ? "Only answer" : "Verdict"}</span>
              <span className="num">{verdict.model.replace(/^[a-z-]+\//, "")}</span>
            </div>
            <p>{verdict.text}</p>
            {verdict.split && <div className="ask-split"><b>Split</b> {verdict.split}</div>}
          </div>
        ) : (
          <div className="ask-verdict ask-empty">
            <span className="label">Verdict</span>
            <p>{phase === "judging" ? "The judge is reading every answer." : "The judge reads every seat's answer and writes one verdict, plus the point they split on."}</p>
          </div>
        )}

        {refund && (
          <p className="ask-refund">
            {refund.error ? refund.error : <>Refunded {fmtUsd(refund.usd)} USDC{refund.tx && <> · <a href={`https://solscan.io/tx/${refund.tx}`} target="_blank" rel="noopener">view refund</a></>}</>}
          </p>
        )}
      </div>
    </div>
  );
}
