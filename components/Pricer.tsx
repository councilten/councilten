"use client";
import { useMemo, useState } from "react";
import { BLADES } from "@/lib/mark";
import { Command } from "./Copy";
import { Logo } from "./Logo";

export interface PriceSeat {
  alias: string;
  label: string;
  id: string;
  input: number;
  output: number;
  minimum: number;
}

// The CLI's estimate, line for line (kit/src/catalog.ts): full prompt in, every output token out,
// never below the provider's per-call floor. The judge reads every seat's full answer.
const QUESTION_CHARS = 200;
const estTokens = (chars: number) => Math.ceil(chars / 3.5) + 24;
const estimate = (m: PriceSeat, chars: number, out: number) => Math.max((estTokens(chars) * m.input + out * m.output) / 1e6, m.minimum);
const usd = (n: number) => `$${n.toFixed(4)}`;

/** Price a council before it runs, with today's live prices and the same math the CLI uses. */
export function Pricer({ seats, judgeAlias = "claude" }: { seats: PriceSeat[]; judgeAlias?: string }) {
  const [on, setOn] = useState<Set<string>>(() => new Set(["venice", "claude", "gpt", "grok", "gemini"].filter((a) => seats.some((s) => s.alias === a))));
  const [tokens, setTokens] = useState(700);
  const [budget, setBudget] = useState(0.25);
  const judge = seats.find((s) => s.alias === judgeAlias) ?? seats[0];

  const r = useMemo(() => {
    const chosen = seats.filter((s) => on.has(s.alias));
    const rows = chosen.map((s) => ({ s, usd: estimate(s, QUESTION_CHARS, tokens) }));
    const j = estimate(judge, QUESTION_CHARS + chosen.length * tokens * 3.5, tokens * 1.5);
    const total = rows.reduce((a, x) => a + x.usd, 0) + j;
    return { rows, judge: j, total, ok: total <= budget && chosen.length > 0 };
  }, [seats, on, tokens, budget, judge]);

  const max = Math.max(...r.rows.map((x) => x.usd), r.judge, 1e-9);
  const pct = Math.min(r.total / budget, 1.4);
  const order = seats.map((s) => s.alias);
  const cmd = `council convene "…" --seats ${[...on].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(",") || "venice"} --budget ${budget.toFixed(2)} --max-tokens ${tokens}`;

  const toggle = (a: string) =>
    setOn((prev) => {
      const n = new Set(prev);
      n.has(a) ? n.delete(a) : n.add(a);
      return n;
    });

  return (
    <div className="pr">
      <div className="pr-left">
        <span className="label">Seats</span>
        <div className="pr-seats" role="group" aria-label="Seats at the table">
          {seats.map((s) => (
            <button key={s.alias} type="button" className="pr-seat" aria-pressed={on.has(s.alias)} onClick={() => toggle(s.alias)}>
              <span className="a"><Logo k={s.alias} size={16} />{s.alias}</span>
              <span className="id">{s.id}</span>
            </button>
          ))}
        </div>
        <label className="pr-range">
          <span className="label">Output tokens per seat</span>
          <output className="num">{tokens.toLocaleString("en-US")}</output>
          <input type="range" min={100} max={2000} step={50} value={tokens} onChange={(e) => setTokens(Number(e.target.value))} />
        </label>
        <label className="pr-range">
          <span className="label">Budget for the run</span>
          <output className="num">${budget.toFixed(2)}</output>
          <input type="range" min={0.01} max={1} step={0.01} value={budget} onChange={(e) => setBudget(Number(e.target.value))} />
        </label>
      </div>

      <div className="pr-right" data-ok={r.ok || undefined}>
        <div className="pr-top">
          <svg className="pr-mark" viewBox="0 0 100 100" aria-hidden="true">
            {BLADES.map((d, i) => <path key={i} d={d} data-on={(seats[i] && on.has(seats[i].alias)) || undefined} />)}
          </svg>
          <div>
            <span className="label">Worst case</span>
            <div className="pr-total num" key={r.total.toFixed(4)}>{usd(r.total)}</div>
            <div className="pr-verdict">
              {r.rows.length === 0
                ? "Pick at least one seat."
                : r.ok
                  ? `Runs. Worst case is ${Math.round((r.total / budget) * 100)}% of the budget.`
                  : `Refused before signing. Over by ${usd(r.total - budget)}; nothing is paid.`}
            </div>
          </div>
        </div>
        <div className="pr-meter" aria-hidden="true">
          <i style={{ transform: `scaleX(${pct / 1.4})` }} />
          <b style={{ left: `${(1 / 1.4) * 100}%` }} />
        </div>
        <ul className="pr-rows">
          {r.rows.map(({ s, usd: u }) => (
            <li key={s.alias}>
              <span className="pr-n"><Logo k={s.alias} size={14} />{s.alias}</span>
              <span className="bar"><i style={{ transform: `scaleX(${u / max})` }} /></span>
              <span className="num">{usd(u)}</span>
            </li>
          ))}
          <li className="j">
            <span>judge</span>
            <span className="bar"><i style={{ transform: `scaleX(${r.judge / max})` }} /></span>
            <span className="num">{usd(r.judge)}</span>
          </li>
        </ul>
        <Command text={cmd} />
      </div>
    </div>
  );
}
