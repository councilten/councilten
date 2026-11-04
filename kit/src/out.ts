const color = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";
const wrap = (open: string, close = "\x1b[0m") => (s: string | number) => (color ? `${open}${s}${close}` : String(s));

export const dim = wrap("\x1b[2m");
export const bold = wrap("\x1b[1m");
export const clay = wrap("\x1b[38;5;209m");
export const red = wrap("\x1b[38;5;203m");
export const green = wrap("\x1b[38;5;114m");

export const usd = (n: number, d = 4) => `$${n.toFixed(d)}`;
export const num = (n: number, d = 4) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
export const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
const pad = (s: string, w: number, right = false) => {
  const n = w - strip(s).length;
  return n > 0 ? (right ? " ".repeat(n) + s : s + " ".repeat(n)) : s;
};

export function kv(rows: [string, string][]) {
  const w = Math.max(...rows.map(([k]) => k.length));
  for (const [k, v] of rows) console.log(`  ${dim(pad(k, w))}   ${v}`);
}

/** Columns: right-align any column whose header ends with ">". */
export function table(head: string[], rows: string[][]) {
  const right = head.map((h) => h.endsWith(">"));
  const h = head.map((x) => x.replace(/>$/, ""));
  const w = h.map((x, i) => Math.max(x.length, ...rows.map((r) => strip(r[i] ?? "").length)));
  console.log("  " + h.map((x, i) => dim(pad(x, w[i], right[i]))).join("   "));
  for (const r of rows) console.log("  " + r.map((x, i) => pad(x ?? "", w[i], right[i])).join("   "));
}

export function heading(s: string) {
  console.log(`\n${clay("▍")}${bold(s)}`);
}

export function note(s: string) {
  console.log(dim(`  ${s}`));
}

export function fail(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`${red("error")} ${msg}`);
  process.exit(1);
}
