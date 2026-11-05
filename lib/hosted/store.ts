import "server-only";

/**
 * A tiny Redis client over the Upstash REST API (what Vercel's Redis integration provides).
 * Used for: one-time use of every payment, rate limits, and the public counters.
 * HOSTED_MEMORY_STORE=1 keeps it in memory for local tests only; serverless needs Redis.
 */
const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

const mem = new Map<string, { v: string; exp: number }>();
const live = (k: string) => {
  const e = mem.get(k);
  if (e && e.exp && e.exp < Date.now()) { mem.delete(k); return undefined; }
  return e;
};

async function cmd(args: (string | number)[]): Promise<any> {
  if (!URL_) return memCmd(args);
  const res = await fetch(URL_, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(args.map(String)),
    cache: "no-store",
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`store: ${body.error ?? res.status}`);
  return body.result;
}

function memCmd(args: (string | number)[]): any {
  const [c, k, ...rest] = args.map(String);
  const op = c.toUpperCase();
  if (op === "GET") return live(k)?.v ?? null;
  if (op === "SET") {
    const nx = rest.includes("NX");
    const exIdx = rest.indexOf("EX");
    const exp = exIdx >= 0 ? Date.now() + Number(rest[exIdx + 1]) * 1000 : 0;
    if (nx && live(k)) return null;
    mem.set(k, { v: rest[0], exp });
    return "OK";
  }
  if (op === "INCR" || op === "INCRBYFLOAT") {
    const by = op === "INCR" ? 1 : Number(rest[0]);
    const cur = Number(live(k)?.v ?? 0) + by;
    mem.set(k, { v: String(cur), exp: live(k)?.exp ?? 0 });
    return op === "INCR" ? cur : String(cur);
  }
  if (op === "EXPIRE") { const e = live(k); if (e) e.exp = Date.now() + Number(rest[0]) * 1000; return 1; }
  if (op === "DEL") { mem.delete(k); return 1; }
  throw new Error(`memory store: ${op} not supported`);
}

/** Set once. Returns false if the key already exists. */
export async function claim(key: string, ttlSec: number, value = "1"): Promise<boolean> {
  return (await cmd(["SET", key, value, "NX", "EX", ttlSec])) === "OK";
}

export async function release(key: string) {
  await cmd(["DEL", key]);
}

/** Fixed-window counter. Returns the count in the current window. */
export async function hit(key: string, windowSec: number): Promise<number> {
  const n = Number(await cmd(["INCR", key]));
  if (n === 1) await cmd(["EXPIRE", key, windowSec]);
  return n;
}

export async function addFloat(key: string, by: number) {
  await cmd(["INCRBYFLOAT", key, by.toFixed(6)]);
}

export async function get(key: string): Promise<string | null> {
  return cmd(["GET", key]);
}
