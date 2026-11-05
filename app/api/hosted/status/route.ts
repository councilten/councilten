import { NextResponse } from "next/server";
import * as venice from "../../../../kit/src/venice";
import { hosted, readiness } from "@/lib/hosted/config";
import { councilWallet, usdcBalance } from "@/lib/hosted/chain";
import { get } from "@/lib/hosted/store";

export const dynamic = "force-dynamic";

let cache: { at: number; body: any } | null = null;

/** Is the table open, what does it charge, how many councils has it run. Cached for 30 seconds. */
export async function GET() {
  if (cache && Date.now() - cache.at < 30_000) return NextResponse.json(cache.body);
  const ready = readiness();
  let open = ready.ok;
  let runs = 0;
  if (ready.ok) {
    try {
      const signer = await councilWallet();
      const [usdc, credit, n] = await Promise.all([
        usdcBalance(signer.address),
        venice.balance(signer).then((b) => b.balanceUsd).catch(() => 0),
        get("hosted:runs").catch(() => null),
      ]);
      runs = Number(n ?? 0);
      // Enough float to pay the models of an average council before the visitor's payment is reused.
      open = usdc + credit >= 1;
    } catch {
      open = false;
    }
  }
  const body = {
    enabled: hosted.enabled,
    open,
    reason: !ready.ok ? ready.why : open ? undefined : "float",
    markupBps: hosted.markupBps,
    maxUsd: hosted.maxUsd,
    holderDiscountBps: hosted.holderDiscountBps,
    runs,
  };
  cache = { at: Date.now(), body };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
