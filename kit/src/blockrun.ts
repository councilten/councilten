import type { KeyPairSigner } from "@solana/kit";
import { BLOCKRUN_API } from "./env.js";
import { paidFetch } from "./pay.js";
import type { ChatMessage, ChatResult } from "./types.js";

/**
 * BlockRun's Solana gateway: GPT, Claude, Grok, Gemini and others, each call paid on its own
 * in USDC over x402. Nothing is prepaid; the 402 states the exact price of the call.
 */
export async function chat(
  signer: KeyPairSigner,
  rpc: string,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  ceilingUsd: number,
): Promise<ChatResult> {
  const started = Date.now();
  const paid = await paidFetch(
    `${BLOCKRUN_API}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
    },
    { signer, rpc, ceilingUsd },
  );
  if (!paid.response.ok) {
    const body: any = await paid.response.json().catch(() => ({}));
    const msg = body?.error?.message || body?.error || paid.response.statusText;
    throw new Error(`${model}: BlockRun ${paid.response.status} ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  const body: any = await paid.response.json();
  return {
    text: body?.choices?.[0]?.message?.content ?? "",
    usage: { input: body?.usage?.prompt_tokens ?? 0, output: body?.usage?.completion_tokens ?? 0 },
    ms: Date.now() - started,
    usd: paid.usd,
    tx: paid.tx,
  };
}
