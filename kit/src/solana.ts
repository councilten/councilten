import {
  address,
  appendTransactionMessageInstructions,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import * as tok from "@solana-program/token";
import * as tok22 from "@solana-program/token-2022";
import { getTransferSolInstruction } from "@solana-program/system";
import { USDC_MINT } from "./env.js";

export type Rpc = ReturnType<typeof createSolanaRpc>;
export const rpcOf = (url: string): Rpc => createSolanaRpc(url);

const T22 = tok22.TOKEN_2022_PROGRAM_ADDRESS as string;

export interface MintInfo {
  mint: string;
  program: string;
  decimals: number;
  supply: string;
  supplyUi: number;
  mintAuthority: string | null;
  freezeAuthority: string | null;
}

export async function mintInfo(rpc: Rpc, mint: string): Promise<MintInfo> {
  const acc: any = await rpc.getAccountInfo(address(mint), { encoding: "jsonParsed" }).send();
  if (!acc?.value) throw new Error(`Mint ${mint} not found`);
  const info = acc.value.data?.parsed?.info;
  if (!info) throw new Error(`${mint} is not a token mint`);
  const decimals = Number(info.decimals);
  return {
    mint,
    program: String(acc.value.owner),
    decimals,
    supply: String(info.supply),
    supplyUi: Number(info.supply) / 10 ** decimals,
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
  };
}

export async function tokenBalance(rpc: Rpc, owner: string, mint: string): Promise<number> {
  const res: any = await rpc.getTokenAccountsByOwner(address(owner), { mint: address(mint) }, { encoding: "jsonParsed" }).send();
  return (res.value ?? []).reduce((s: number, a: any) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
}

export async function balances(rpc: Rpc, owner: string, mint?: string | null) {
  const [sol, usdc, own] = await Promise.all([
    rpc.getBalance(address(owner)).send().then((r: any) => Number(r.value) / 1e9),
    tokenBalance(rpc, owner, USDC_MINT),
    mint ? tokenBalance(rpc, owner, mint) : Promise.resolve(null),
  ]);
  return { sol, usdc, token: own };
}

/** Every holder, by a full scan of the mint's token accounts. Needs an RPC that allows getProgramAccounts. */
export async function holders(rpc: Rpc, mint: string) {
  const info = await mintInfo(rpc, mint);
  const filters: any[] = [{ memcmp: { offset: 0n, bytes: mint, encoding: "base58" } }];
  if (info.program !== T22) filters.push({ dataSize: 165n });
  const accounts: any[] = await rpc
    .getProgramAccounts(address(info.program), { encoding: "base64", filters, dataSlice: { offset: 32, length: 40 } } as any)
    .send() as any;
  const byOwner = new Map<string, bigint>();
  const { getAddressDecoder } = await import("@solana/kit");
  const dec = getAddressDecoder();
  for (const a of accounts) {
    const raw = Buffer.from(a.account.data[0], "base64");
    const owner = dec.decode(raw.subarray(0, 32));
    const amount = raw.readBigUInt64LE(32);
    if (amount > 0n) byOwner.set(owner, (byOwner.get(owner) ?? 0n) + amount);
  }
  const total = BigInt(info.supply) || 1n;
  const list = [...byOwner.entries()]
    .sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0))
    .map(([owner, amt]) => ({ owner, amount: Number(amt) / 10 ** info.decimals, pct: Number((amt * 1_000_000n) / total) / 10_000 }));
  const top10 = list.slice(0, 10).reduce((s, h) => s + h.pct, 0);
  return { mint: info, count: list.length, top10Pct: Math.round(top10 * 100) / 100, holders: list };
}

/** Burn instructions on the mint, read from its recent transactions. */
export async function burns(rpc: Rpc, mint: string, limit = 100) {
  const sigs: any[] = (await rpc.getSignaturesForAddress(address(mint), { limit }).send()) as any;
  const out: { signature: string; amount: number; time: number | null }[] = [];
  for (const s of sigs) {
    if (s.err) continue;
    const tx: any = await rpc.getTransaction(s.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }).send();
    const ixs = [
      ...(tx?.transaction?.message?.instructions ?? []),
      ...((tx?.meta?.innerInstructions ?? []).flatMap((i: any) => i.instructions)),
    ];
    for (const ix of ixs) {
      const p = ix?.parsed;
      if (p && (p.type === "burn" || p.type === "burnChecked") && p.info?.mint === mint) {
        const amt = p.info.tokenAmount?.uiAmount ?? Number(p.info.amount) / 10 ** (p.info.tokenAmount?.decimals ?? 6);
        out.push({ signature: String(s.signature), amount: Number(amt), time: s.blockTime ? Number(s.blockTime) : null });
      }
    }
  }
  return { count: out.length, total: out.reduce((a, b) => a + b.amount, 0), burns: out };
}

async function sendAndConfirm(rpc: Rpc, signer: KeyPairSigner, instructions: any[]): Promise<string> {
  const { value: bh } = await rpc.getLatestBlockhash().send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await signTransactionMessageWithSigners(msg);
  const sig = getSignatureFromTransaction(signed);
  await rpc.sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64" }).send();
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    const st: any = await rpc.getSignatureStatuses([sig]).send();
    const s = st.value?.[0];
    if (s?.err) throw new Error(`Transaction ${sig} failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return sig;
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error(`Transaction ${sig} not confirmed within 60 s; check it on an explorer`);
}

function programOf(info: MintInfo) {
  return info.program === T22 ? tok22 : tok;
}

/** Send SOL, USDC or any SPL token. Creates the recipient's token account when it does not exist. */
export async function send(rpc: Rpc, signer: KeyPairSigner, to: string, amount: number, asset: "sol" | string) {
  if (asset === "sol") {
    const ix = getTransferSolInstruction({ source: signer, destination: address(to), amount: lamports(BigInt(Math.round(amount * 1e9))) });
    return sendAndConfirm(rpc, signer, [ix]);
  }
  const info = await mintInfo(rpc, asset);
  const P: any = programOf(info);
  const programAddress = address(info.program);
  const [src] = await P.findAssociatedTokenPda({ owner: signer.address, mint: address(asset), tokenProgram: programAddress });
  const [dst] = await P.findAssociatedTokenPda({ owner: address(to), mint: address(asset), tokenProgram: programAddress });
  const create = P.getCreateAssociatedTokenIdempotentInstruction({ payer: signer, ata: dst, owner: address(to), mint: address(asset), tokenProgram: programAddress });
  const units = BigInt(Math.round(amount * 10 ** info.decimals));
  const xfer = P.getTransferCheckedInstruction({ source: src, mint: address(asset), destination: dst, authority: signer, amount: units, decimals: info.decimals });
  return sendAndConfirm(rpc, signer, [create, xfer]);
}

/** BurnChecked from the agent wallet: the supply shrinks on chain, for good. */
export async function burn(rpc: Rpc, signer: KeyPairSigner, mint: string, amount: number) {
  const info = await mintInfo(rpc, mint);
  const P: any = programOf(info);
  const programAddress = address(info.program);
  const [ata] = await P.findAssociatedTokenPda({ owner: signer.address, mint: address(mint), tokenProgram: programAddress });
  const units = BigInt(Math.round(amount * 10 ** info.decimals));
  const ix = P.getBurnCheckedInstruction({ account: ata, mint: address(mint), authority: signer, amount: units, decimals: info.decimals });
  return sendAndConfirm(rpc, signer, [ix]);
}

export const isAddress = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
export type { Address };
