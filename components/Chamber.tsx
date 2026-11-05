"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BLADES } from "@/lib/mark";
import { Logo } from "./Logo";

export interface ChamberSeat {
  label: string;
  id: string;
  ms: number;
  usd: number;
}

interface Props {
  question: string;
  seats: ChamberSeat[];
  judge: ChamberSeat;
  answer: string;
  split: string;
  budget: number;
  worstCase: number;
}

const fmt = (n: number) => `$${n.toFixed(4)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
// Paint before the browser shows the server HTML when we can; fall back quietly on the server.
const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The signature panel: a council run as the CLI prints it. Each seat that answers lights its blade of
 * the Turbine; the judge lights the mark's last blade and the merged answer appears.
 * The server renders the finished run, so the content never depends on JavaScript.
 */
export function Chamber({ question, seats, judge, answer, split, budget, worstCase }: Props) {
  const total = seats.length;
  const judgeAt = Math.max(...seats.map((s) => s.ms)) + judge.ms;
  const [t, setT] = useState<number>(Number.POSITIVE_INFINITY);
  const [run, setRun] = useState(0);
  const raf = useRef<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const play = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    const start = performance.now();
    const step = (now: number) => {
      const el = now - start;
      setT(el);
      if (el < judgeAt + 600) raf.current = requestAnimationFrame(step);
    };
    setT(0);
    setRun((r) => r + 1);
    raf.current = requestAnimationFrame(step);
  }, [judgeAt]);

  useIso(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || !root.current) return;
    const r = root.current.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) {
      play();
      return () => { if (raf.current) cancelAnimationFrame(raf.current); };
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        play();
        io.disconnect();
      }
    }, { threshold: 0.35 });
    io.observe(root.current);
    return () => { io.disconnect(); if (raf.current) cancelAnimationFrame(raf.current); };
  }, [play]);

  const done = seats.map((s) => t >= s.ms);
  const judged = t >= judgeAt;
  const answered = done.filter(Boolean).length;
  const spent = seats.reduce((a, s, i) => a + (done[i] ? s.usd : 0), 0) + (judged ? judge.usd : 0);

  // Ten blades: the seat at index i lights blade i. Fewer seats light fewer blades.
  return (
    <div className="chamber" ref={root} aria-label="Example council run">
      <div className="ch-top">
        <span><b>council</b> convene --ten</span>
        <span className="sp num" aria-live="polite">{judged ? "done" : `${answered}/${total} answered`}</span>
        <button type="button" onClick={play}>Replay</button>
      </div>
      <div className="ch-q">
        <div className="bubble">{question}</div>
      </div>
      <div className="ch-body">
        <svg className="turbine" viewBox="0 0 100 100" aria-hidden="true">
          {BLADES.map((d, i) => (
            <path key={i} d={d} data-on={(i < total ? done[i] : judged) || undefined} />
          ))}
        </svg>
        <ul className="seats">
          {seats.map((s, i) => (
            <li key={`${run}-${s.label}`} data-on={done[i] || undefined} data-flash={done[i] && t < s.ms + 450 ? true : undefined}>
              <span className="n"><Logo k={s.label} size={15} />{s.label}</span>
              <span className="id">{s.id}</span>
              <span className="t num">{done[i] ? secs(s.ms) : <i className="wait" />}</span>
              <span className="c num">{done[i] ? fmt(s.usd) : ""}</span>
            </li>
          ))}
          <li className="judge" data-on={judged || undefined}>
            <span className="n">judge</span>
            <span className="id">{judge.id}</span>
            <span className="t num">{judged ? secs(judge.ms) : <i className="wait" />}</span>
            <span className="c num">{judged ? fmt(judge.usd) : ""}</span>
          </li>
        </ul>
      </div>
      <div className="ch-answer" data-hidden={!judged || undefined}>
        <p>{answer}</p>
        <div className="split">{split}</div>
      </div>
      <div className="ch-foot">
        <span>spent <b className="num">{fmt(spent)}</b> of <span className="num">${budget.toFixed(2)}</span></span>
        <span>worst case <span className="num">{fmt(worstCase)}</span></span>
        <span>{total} seats + judge</span>
      </div>
    </div>
  );
}
