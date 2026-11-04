"use client";
import { useState } from "react";

/** A command line with a copy button. The text is always selectable; the button is a convenience. */
export function Command({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="cmd">
      <span className="p" aria-hidden="true">$</span>
      <code>{text}</code>
      <button
        type="button"
        data-done={done || undefined}
        aria-label={`Copy command: ${text}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setDone(true);
            setTimeout(() => setDone(false), 1400);
          } catch {
            /* clipboard blocked: the text stays selectable */
          }
        }}
      >
        {done ? "Copied" : label}
      </button>
    </div>
  );
}
