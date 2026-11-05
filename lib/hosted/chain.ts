import "server-only";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { findAssociatedTokenPda, getTransferCheckedInstruction, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from "@solana-program/compute-budget";
import { loadWallet } from "../../kit/src/wallet";
import { USDC_MINT } from "../../kit/src/env";
import { hosted } from "./config";

export const MEMO_PROGRAM = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const USDC = address(USDC_MINT);

export const rpc = () => createSolanaRpc(hosted.rpc);

let cached: Promise<KeyPairSigner> | null = null;
/** The council's own wallet: it receives visitors' payments and pays the models. */
export const councilWallet = () => (cached ??= loadWallet());

export async function usdcAccount(owner: string): Promise<Address> {
  const [ata] = await findAssociatedTokenPda({ owner: address(owner), mint: USDC, tokenProgram: TOKEN_PROGRAM_ADDRESS });
  return ata;
}

/** USDC held in an owner's associated token account (0 when it does not exist). */
export async function usdcBalance(owner: string): Promise<number> {
  try {
    const r: any = await rpc().getTokenAccountBalance(await usdcAccount(owner), { commitment: "confirmed" }).send();
    return Number(r.value.uiAmountString ?? r.value.uiAmount ?? 0);
  } catch {
    return 0;
  }
}

export async function solBalance(owner: string): Promise<number> {
  const r: any = await rpc().getBalance(address(owner), { commitment: "confirmed" }).send();
  return Number(r.value) / 1e9;
}

/**
 * The visitor's one transaction: a USDC TransferChecked to the council's wallet, tagged with the quote's
 * memo. The visitor's wallet signs and sends it; nothing here can move funds on its own.
 */
export async function paymentTransaction(payer: string, to: string, units: bigint, memo: string): Promise<string> {
  const { value: blockhash } = await rpc().getLatestBlockhash({ commitment: "confirmed" }).send();
  const owner = createNoopSigner(address(payer));
  const memoIx = {
    programAddress: address(MEMO_PROGRAM),
    accounts: [],
    data: new TextEncoder().encode(memo),
  };
  const [src, dst] = await Promise.all([usdcAccount(payer), usdcAccount(to)]);
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(owner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          getSetComputeUnitLimitInstruction({ units: 60_000 }),
          getSetComputeUnitPriceInstruction({ microLamports: 50_000n }),
          getTransferCheckedInstruction({ source: src, mint: USDC, destination: dst, authority: owner, amount: units, decimals: 6 }),
          memoIx as any,
        ],
        m,
      ),
  );
  return getBase64EncodedWireTransaction(compileTransaction(msg));
}

export interface Settled {
  ok: boolean;
  why?: string;
  units?: bigint;
}

/**
 * Wait for the visitor's transaction and check it the way a cashier would: it succeeded, it moved at least
 * the quoted USDC from this wallet into the council's account, and it carries this quote's memo.
 */
export async function verifyPayment(signature: string, payer: string, to: string, units: bigint, memo: string, timeoutMs = 45_000): Promise<Settled> {
  const dst = String(await usdcAccount(to));
  const started = Date.now();
  let tx: any = null;
  while (Date.now() - started < timeoutMs) {
    try {
      tx = await rpc()
        .getTransaction(signature as any, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" })
        .send();
    } catch {
      tx = null;
    }
    if (tx) break;
    await new Promise((r) => setTimeout(r, 1200));
  }
  if (!tx) return { ok: false, why: "The payment did not confirm in time. If USDC left your wallet, it will be refunded." };
  if (tx.meta?.err) return { ok: false, why: "The payment transaction failed on chain. Nothing was charged." };
  const ixs: any[] = [...(tx.transaction?.message?.instructions ?? []), ...((tx.meta?.innerInstructions ?? []).flatMap((i: any) => i.instructions))];
  const xfer = ixs.find(
    (i) =>
      (i.program === "spl-token" || String(i.programId) === String(TOKEN_PROGRAM_ADDRESS)) &&
      i.parsed?.type === "transferChecked" &&
      String(i.parsed.info?.destination) === dst &&
      String(i.parsed.info?.mint) === USDC_MINT &&
      String(i.parsed.info?.authority) === payer,
  );
  if (!xfer) return { ok: false, why: "That transaction does not pay the council from this wallet." };
  const paid = BigInt(xfer.parsed.info.tokenAmount?.amount ?? 0);
  if (paid < units) return { ok: false, why: "That transaction pays less than the quoted price." };
  const memoOk = ixs.some((i) => (i.program === "spl-memo" || String(i.programId) === MEMO_PROGRAM) && String(i.parsed ?? "") === memo);
  if (!memoOk) return { ok: false, why: "That transaction belongs to a different quote." };
  return { ok: true, units: paid };
}
