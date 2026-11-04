import { randomBytes } from "node:crypto";
import { createSIWxPayload, encodeSIWxHeader } from "@x402/extensions/sign-in-with-x";
import type { KeyPairSigner } from "@solana/kit";
import { SOLANA_MAINNET, USER_AGENT, USDC_DECIMALS, VENICE_API } from "./env.js";
import { paidFetch } from "./pay.js";
import type { ChatMessage, ChatResult } from "./types.js";

const nonce = () => randomBytes(12).toString("hex");

/** A fresh Sign-In-With-X header for one Venice request. Each one is single use and lives five minutes. */
export async function siwx(signer: KeyPairSigner, url: string, server?: any): Promise<string> {
  const u = new URL(url);
  const now = new Date();
  const info = {
    domain: u.host,
    uri: url,
    version: "1",
    statement: "Sign in to Venice AI",
    nonce: nonce(),
    issuedAt: now.toISOString(),
    expirationTime: new Date(now.getTime() + 5 * 60_000).toISOString(),
    ...(server ?? {}),
    chainId: SOLANA_MAINNET,
    type: "ed25519" as const,
  };
  const payload = await createSIWxPayload(info as any, signer as any, url);
  return encodeSIWxHeader(payload);
}

async function authed(signer: KeyPairSigner, url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("user-agent", USER_AGENT);
  headers.set("SIGN-IN-WITH-X", await siwx(signer, url));
  let res = await fetch(url, { ...init, headers });
  // If Venice issued its own challenge (402 with a sign-in-with-x extension), sign exactly that once.
  if (res.status === 402 || res.status === 401) {
    const body: any = await res.clone().json().catch(() => null);
    const server = body?.extensions?.["sign-in-with-x"]?.info;
    if (server) {
      headers.set("SIGN-IN-WITH-X", await siwx(signer, url, server));
      res = await fetch(url, { ...init, headers });
    }
  }
  return res;
}

async function failure(res: Response, what: string): Promise<Error> {
  const body: any = await res.json().catch(() => ({}));
  const msg = body?.error?.message || body?.error || body?.message || res.statusText;
  if (res.status === 402) return new Error(`${what}: Venice credit is empty. Run: council fund <usd>`);
  return new Error(`${what}: Venice ${res.status} ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
}

export interface VeniceBalance {
  balanceUsd: number;
  canConsume: boolean;
  minimumTopUpUsd?: number;
  suggestedTopUpUsd?: number;
  diemBalanceUsd?: number;
}

export async function balance(signer: KeyPairSigner): Promise<VeniceBalance> {
  const url = `${VENICE_API}/x402/balance/${signer.address}`;
  const res = await authed(signer, url);
  if (!res.ok) throw await failure(res, "balance");
  const b: any = await res.json();
  const d = b.data ?? b;
  return {
    balanceUsd: Number(d.balanceUsd ?? 0),
    canConsume: Boolean(d.canConsume),
    minimumTopUpUsd: d.minimumTopUpUsd !== undefined ? Number(d.minimumTopUpUsd) : undefined,
    suggestedTopUpUsd: d.suggestedTopUpUsd !== undefined ? Number(d.suggestedTopUpUsd) : undefined,
    diemBalanceUsd: d.diemBalanceUsd !== undefined ? Number(d.diemBalanceUsd) : undefined,
  };
}

/** Top up Venice credit straight from Solana USDC through Venice's own x402 top-up. */
export async function topUp(signer: KeyPairSigner, rpc: string, usd: number) {
  const units = BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
  const paid = await paidFetch(`${VENICE_API}/x402/top-up`, { method: "POST" }, { signer, rpc, ceilingUsd: usd, amountUnits: units });
  if (!paid.response.ok) throw await failure(paid.response, "top-up");
  const body: any = await paid.response.json().catch(() => ({}));
  return { usd: paid.usd, tx: paid.tx, body };
}

export async function chat(signer: KeyPairSigner, model: string, messages: ChatMessage[], maxTokens: number): Promise<ChatResult> {
  const url = `${VENICE_API}/chat/completions`;
  const started = Date.now();
  const res = await authed(signer, url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: maxTokens,
      venice_parameters: { include_venice_system_prompt: false },
    }),
  });
  if (!res.ok) throw await failure(res, model);
  const body: any = await res.json();
  const remaining = res.headers.get("X-Balance-Remaining");
  return {
    text: body?.choices?.[0]?.message?.content ?? "",
    usage: { input: body?.usage?.prompt_tokens ?? 0, output: body?.usage?.completion_tokens ?? 0 },
    ms: Date.now() - started,
    balanceAfter: remaining !== null ? Number(remaining) : undefined,
  };
}

export async function transactions(signer: KeyPairSigner, limit = 20) {
  const url = `${VENICE_API}/x402/transactions/${signer.address}?limit=${limit}&offset=0`;
  const res = await authed(signer, url);
  if (!res.ok) throw await failure(res, "transactions");
  const b: any = await res.json();
  return (b.data ?? b.transactions ?? b) as any[];
}
