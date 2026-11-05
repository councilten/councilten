"use client";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { getBase58Decoder, getBase64Encoder } from "@solana/kit";

export const SOLANA_CHAIN = "solana:mainnet";
const CONNECT = "standard:connect";
const DISCONNECT = "standard:disconnect";
const SIGN_AND_SEND = "solana:signAndSendTransaction";

export interface SolanaWallet {
  name: string;
  icon: string;
  wallet: Wallet;
}

const usable = (w: Wallet) => w.chains.some((c) => c.startsWith("solana:")) && CONNECT in w.features && SIGN_AND_SEND in w.features;

/** Every Solana wallet the browser has registered through Wallet Standard (Phantom, Solflare, Backpack, ...). */
export function listWallets(): SolanaWallet[] {
  return getWallets().get().filter(usable).map((w) => ({ name: w.name, icon: w.icon, wallet: w }));
}

/** Call back whenever a wallet registers late (extensions inject after the page loads). */
export function onWallets(cb: () => void): () => void {
  const api = getWallets();
  const a = api.on("register", cb);
  const b = api.on("unregister", cb);
  return () => { a(); b(); };
}

export async function connect(w: SolanaWallet): Promise<WalletAccount> {
  const out: any = await (w.wallet.features[CONNECT] as any).connect();
  const acc: WalletAccount | undefined = out?.accounts?.[0] ?? w.wallet.accounts[0];
  if (!acc) throw new Error("The wallet did not share an account");
  return acc;
}

export async function disconnect(w: SolanaWallet) {
  const f: any = w.wallet.features[DISCONNECT];
  if (f) await f.disconnect().catch(() => undefined);
}

/** Ask the wallet to sign and send one transaction (base64 wire format). Returns its signature in base58. */
export async function signAndSend(w: SolanaWallet, account: WalletAccount, txBase64: string): Promise<string> {
  const bytes = getBase64Encoder().encode(txBase64);
  const f: any = w.wallet.features[SIGN_AND_SEND];
  const [out] = await f.signAndSendTransaction({ account, chain: SOLANA_CHAIN, transaction: new Uint8Array(bytes), options: { commitment: "confirmed" } });
  return getBase58Decoder().decode(out.signature);
}
