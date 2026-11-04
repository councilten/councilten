import { MARK_PATH, WORDMARK } from "@/lib/mark";

export function Mark({ className = "m", title }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" role={title ? "img" : "presentation"} aria-label={title} aria-hidden={title ? undefined : true}>
      <path d={MARK_PATH} fill="var(--clay)" fillRule="evenodd" />
    </svg>
  );
}

export function Wordmark({ className = "w" }: { className?: string }) {
  return (
    <svg className={className} viewBox={WORDMARK.viewBox} aria-hidden="true">
      <g transform={`translate(${WORDMARK.translate})`}>
        <path d={WORDMARK.d} />
      </g>
    </svg>
  );
}
