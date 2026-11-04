import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { ExactSvmSchemeV1 } from "@x402/svm/exact/v1/client";
import type { KeyPairSigner } from "@solana/kit";
import { USDC_MINT, USDC_DECIMALS, USER_AGENT } from "./env.js";

export class PaymentRefused extends Error {}

export interface Paid {
  response: Response;
  /** USD actually committed in the signed payment (0 when the server answered without a 402). */
  usd: number;
  /** Settlement transaction signature, when the server returns PAYMENT-RESPONSE. */
  tx?: string;
  payTo?: string;
}

interface PayOptions {
  signer: KeyPairSigner;
  rpc: string;
  /** Refuse any single payment above this many USD. */
  ceilingUsd: number;
  /** Optional hook to rewrite requirements (top-ups choose their own amount). */
  amountUnits?: bigint;
}

const isSolana = (net: string) => net === "solana" || net.startsWith("solana:");
const usdOf = (units: string | number | bigint) => Number(units) / 10 ** USDC_DECIMALS;

function makeClient(o: PayOptions) {
  const client = new x402Client();
  // v2 challenges name the chain by CAIP-2 ("solana:5eyk..."), v1 by name ("solana"). Answer both,
  // and build every transaction against our own RPC.
  client.register("solana:*" as any, new ExactSvmScheme(o.signer as any, { rpcUrl: o.rpc }));
  client.registerV1("solana", new ExactSvmSchemeV1(o.signer as any, { rpcUrl: o.rpc }));
  // The protocol's own cap (default $1) is set to ours, so both layers agree.
  client.setSpendControls({ maxAmountPerPayment: `$${o.ceilingUsd}` } as any);
  // Hard ceiling, enforced before anything is signed. USDC on Solana only.
  client.registerPolicy((_version: number, reqs: any[]) =>
    reqs
      .filter((r) => isSolana(String(r.network)) && String(r.asset) === USDC_MINT)
      .map((r) => {
        if (o.amountUnits === undefined) return r;
        const units = o.amountUnits.toString();
        return { ...r, amount: units, maxAmountRequired: units };
      })
      .filter((r) => usdOf(r.amount ?? r.maxAmountRequired) <= o.ceilingUsd + 1e-9),
  );
  return { client, http: new x402HTTPClient(client) };
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.clone().text();
  try { return JSON.parse(text); } catch { return undefined; }
}

/**
 * fetch() that answers an x402 challenge in USDC on Solana, under a hard ceiling.
 * The facilitator named in the challenge pays the network fee, so the wallet needs no SOL.
 */
export async function paidFetch(url: string, init: RequestInit, o: PayOptions): Promise<Paid> {
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
  const first = await fetch(url, { ...init, headers });
  if (first.status !== 402) return { response: first, usd: 0 };

  const { http } = makeClient(o);
  const get = (n: string) => first.headers.get(n);
  const required: any = http.getPaymentRequiredResponse(get, await readBody(first));
  const offered = (required.accepts || []).filter((r: any) => isSolana(String(r.network)));
  if (!offered.length) throw new PaymentRefused(`${new URL(url).host} does not accept USDC on Solana`);
  const cheapest = Math.min(...offered.map((r: any) => usdOf(o.amountUnits ?? r.amount ?? r.maxAmountRequired)));
  if (cheapest > o.ceilingUsd + 1e-9) {
    throw new PaymentRefused(`${new URL(url).host} asks $${cheapest.toFixed(4)}, above your $${o.ceilingUsd} ceiling`);
  }

  let attempt = 0;
  while (true) {
    attempt += 1;
    const payload: any = await http.createPaymentPayload(required);
    const sigHeaders = http.encodePaymentSignatureHeader(payload);
    const retryHeaders = new Headers(headers);
    for (const [k, v] of Object.entries(sigHeaders)) retryHeaders.set(k, v);
    const res = await fetch(url, { ...init, headers: retryHeaders });
    const accepted = payload.accepted ?? payload.paymentRequirements ?? offered[0];
    const usd = usdOf(o.amountUnits ?? accepted?.amount ?? accepted?.maxAmountRequired ?? 0);
    // A stale blockhash during verification comes back as a second 402: sign once more, then stop.
    if (res.status === 402 && attempt < 2) continue;
    if (res.status === 402) throw new PaymentRefused(`Payment to ${new URL(url).host} was rejected. Check the USDC balance.`);
    let tx: string | undefined;
    try { tx = (http.getPaymentSettleResponse((n) => res.headers.get(n)) as any)?.transaction || undefined; } catch { /* no settle header */ }
    return { response: res, usd, tx, payTo: accepted?.payTo };
  }
}
