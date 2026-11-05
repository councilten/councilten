"use client";
import { useEffect, useRef, useState } from "react";
import { BLADES, BLADE_DIR, RING_CENTER as C, RING_R as R } from "@/lib/mark";
import { Logo } from "./Logo";

export interface SeatInfo {
  alias: string;
  label: string;
  id: string | null;
  provider: string | null;
  input: number | null;
  output: number | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The mark at banner scale. It assembles blade by blade on first paint, turns with the page as you
 * scroll, leans toward the pointer, and every blade is a seat: point at one and it lifts and names the
 * live model sitting there. Without JavaScript it is simply the finished mark.
 */
export function HeroTurbine({ seats }: { seats: SeatInfo[] }) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let px = 0, py = 0, tx = 0, ty = 0;
    const frame = () => {
      tx += (px - tx) * 0.08;
      ty += (py - ty) * 0.08;
      el.style.setProperty("--rot", `${(window.scrollY * 0.055).toFixed(2)}deg`);
      el.style.setProperty("--px", `${tx.toFixed(2)}px`);
      el.style.setProperty("--py", `${ty.toFixed(2)}px`);
      raf = Math.abs(px - tx) > 0.05 || Math.abs(py - ty) > 0.05 ? requestAnimationFrame(frame) : 0;
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      px = ((e.clientX - (r.left + r.width / 2)) / r.width) * 18;
      py = ((e.clientY - (r.top + r.height / 2)) / r.height) * 18;
      kick();
    };
    window.addEventListener("scroll", kick, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    kick();
    return () => {
      window.removeEventListener("scroll", kick);
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  const s = active !== null ? seats[active] : null;
  const ticks = Array.from({ length: 72 }, (_, k) => {
    const a = (k / 72) * Math.PI * 2;
    const r1 = R * 1.22, r2 = R * (k % 6 === 0 ? 1.29 : 1.255);
    return `M${(C.x + r1 * Math.cos(a)).toFixed(2)} ${(C.y + r1 * Math.sin(a)).toFixed(2)}L${(C.x + r2 * Math.cos(a)).toFixed(2)} ${(C.y + r2 * Math.sin(a)).toFixed(2)}`;
  }).join("");

  return (
    <div className="ht" ref={root}>
      <svg className="ht-svg" viewBox="-12 -12 134 124" aria-label="The Council mark: ten blades, ten seats" role="img">
        <defs>
          <radialGradient id="ht-warm" cx={C.x} cy={C.y} r={R * 2.2} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--clay)" stopOpacity="0.16" />
            <stop offset="1" stopColor="var(--clay)" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={C.x} cy={C.y} r={R * 2.2} fill="url(#ht-warm)" />
        <g className="ht-orbits">
          {[1.12, 1.42, 1.62, 1.86].map((k) => <circle key={k} cx={C.x} cy={C.y} r={R * k} />)}
        </g>
        <path className="ht-dial" d={ticks} />
        <g className="ht-rot" style={{ transformOrigin: `${C.x}px ${C.y}px` }}>
          {BLADES.map((d, i) => (
            <path
              key={i}
              d={d}
              className="ht-b"
              data-on={active === i || undefined}
              style={{ ["--i" as any]: i, ["--dx" as any]: BLADE_DIR[i][0], ["--dy" as any]: BLADE_DIR[i][1] }}
              onPointerEnter={() => setActive(i)}
              onPointerLeave={() => setActive((a) => (a === i ? null : a))}
              onPointerDown={() => setActive(i)}
            />
          ))}
        </g>
      </svg>
      <div className="ht-cap" aria-live="polite">
        {s ? (
          <>
            <span className="ht-n num">Seat {pad((active ?? 0) + 1)}</span>
            <b className="ht-name"><Logo k={s.alias} size={18} />{s.label}</b>
            <span className="num">{s.id ?? "unavailable"}</span>
            {s.provider && <span>via {s.provider}</span>}
            {s.input !== null && <span className="num">${s.input.toFixed(2)} / ${s.output!.toFixed(2)} per M</span>}
          </>
        ) : (
          <>
            <span className="ht-n num">10 seats</span>
            <span>Point at a blade. Each one is a live model.</span>
          </>
        )}
      </div>
    </div>
  );
}
