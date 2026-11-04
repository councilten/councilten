export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatResult {
  text: string;
  usage: { input: number; output: number };
  ms: number;
  /** USD paid for this call when it is known exactly (per-call x402). */
  usd?: number;
  tx?: string;
  /** Venice credit left after the call, from X-Balance-Remaining. */
  balanceAfter?: number;
}

export type { Provider, Model } from "./families.js";
