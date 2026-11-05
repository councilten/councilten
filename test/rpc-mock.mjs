// A mainnet-shaped Solana RPC for the hosted-council tests, plus a test wallet that signs like Phantom.
// It keeps real USDC balances per token account, applies every TransferChecked it receives, verifies
// signatures, and answers getTransaction in jsonParsed form exactly like a real RPC does.
import { createServer } from "node:http";
import { createPublicKey, verify } from "node:crypto";
import {
  address, createKeyPairSignerFromPrivateKeyBytes, getAddressEncoder, getBase58Decoder, getBase64Encoder, getBase64Decoder,
  getCompiledTransactionMessageDecoder, getTransactionDecoder, getTransactionEncoder, signBytes,
} from "@solana/kit";
import { findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { randomBytes } from "node:crypto";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = String(TOKEN_PROGRAM_ADDRESS);
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";
const SPKI = Buffer.from("302a300506032b6570032100", "hex");

export async function keypair() {
  const seed = new Uint8Array(randomBytes(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
  const bytes = new Uint8Array(64);
  bytes.set(seed, 0);
  bytes.set(getAddressEncoder().encode(signer.address), 32);
  return { signer, secretJson: JSON.stringify(Array.from(bytes)) };
}

export async function startRpc({ owners }) {
  const ata = new Map(); // ata -> owner
  const units = new Map(); // owner -> USDC units
  const sol = new Map(); // owner -> lamports
  for (const [owner, usd, s] of owners) {
    const [a] = await findAssociatedTokenPda({ owner: address(owner), mint: address(USDC), tokenProgram: TOKEN_PROGRAM_ADDRESS });
    ata.set(String(a), owner);
    units.set(owner, BigInt(Math.round(usd * 1e6)));
    sol.set(owner, BigInt(Math.round((s ?? 0.05) * 1e9)));
  }
  const txs = new Map(); // signature -> parsed result
  const blockhash = getBase58Decoder().decode(new Uint8Array(32).fill(9));
  const state = { txs, units, sent: [] };

  function apply(wireB64) {
    const tx = getTransactionDecoder().decode(getBase64Encoder().encode(wireB64));
    const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    const keys = msg.staticAccounts.map(String);
    // every required signature must be present and valid
    for (let i = 0; i < msg.header.numSignerAccounts; i++) {
      const k = keys[i];
      const sig = tx.signatures[k];
      if (!sig) throw new Error(`missing signature for ${k}`);
      const pub = createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(getAddressEncoder().encode(k))]), format: "der", type: "spki" });
      if (!verify(null, Buffer.from(tx.messageBytes), pub, Buffer.from(sig))) throw new Error(`bad signature for ${k}`);
    }
    const signature = getBase58Decoder().decode(tx.signatures[keys[0]]);
    const parsed = [];
    for (const ix of msg.instructions) {
      const prog = keys[ix.programAddressIndex];
      if (prog === TOKEN && ix.data?.[0] === 12) {
        const [source, mint, destination, authority] = ix.accountIndices.map((i) => keys[i]);
        const amount = Buffer.from(ix.data).readBigUInt64LE(1);
        const from = ata.get(source), to = ata.get(destination);
        if (mint !== USDC) throw new Error("not USDC");
        if (!from || from !== authority) throw new Error("source is not the authority's USDC account");
        if (!to) throw new Error("destination account does not exist");
        if ((units.get(from) ?? 0n) < amount) throw new Error("insufficient funds");
        units.set(from, units.get(from) - amount);
        units.set(to, (units.get(to) ?? 0n) + amount);
        parsed.push({ program: "spl-token", programId: TOKEN, parsed: { type: "transferChecked", info: { source, mint, destination, authority, tokenAmount: { amount: String(amount), decimals: 6, uiAmount: Number(amount) / 1e6 } } } });
      } else if (prog === MEMO) {
        parsed.push({ program: "spl-memo", programId: MEMO, parsed: Buffer.from(ix.data).toString("utf8") });
      } else {
        parsed.push({ programId: prog, accounts: (ix.accountIndices ?? []).map((i) => keys[i]), data: "" });
      }
    }
    txs.set(signature, {
      slot: 2,
      blockTime: Math.floor(Date.now() / 1000),
      meta: { err: null, fee: 5000, innerInstructions: [], logMessages: [], preBalances: [], postBalances: [] },
      transaction: { signatures: [signature], message: { accountKeys: keys.map((k, i) => ({ pubkey: k, signer: i < msg.header.numSignerAccounts, writable: true })), instructions: parsed } },
      version: 0,
    });
    state.sent.push(signature);
    return signature;
  }

  const rpc = (method, params) => {
    const ctx = { context: { slot: 2 } };
    switch (method) {
      case "getLatestBlockhash": return { ...ctx, value: { blockhash, lastValidBlockHeight: 2000 } };
      case "getBalance": return { ...ctx, value: Number(sol.get(params[0]) ?? 0n) };
      case "getTokenAccountBalance": {
        const owner = ata.get(params[0]);
        if (!owner) throw Object.assign(new Error("could not find account"), { code: -32602 });
        const u = units.get(owner) ?? 0n;
        return { ...ctx, value: { amount: String(u), decimals: 6, uiAmount: Number(u) / 1e6, uiAmountString: String(Number(u) / 1e6) } };
      }
      case "getTokenAccountsByOwner": {
        const [owner, filter] = params;
        if (filter?.mint !== USDC) return { ...ctx, value: [] };
        const u = units.get(owner) ?? 0n;
        return { ...ctx, value: [{ pubkey: "x", account: { data: { parsed: { info: { tokenAmount: { amount: String(u), uiAmount: Number(u) / 1e6 } } } } } }] };
      }
      case "getAccountInfo": {
        const [addr, cfg] = params;
        if (addr === USDC) {
          if (cfg?.encoding === "jsonParsed") return { ...ctx, value: { owner: TOKEN, lamports: 1, executable: false, rentEpoch: 0, space: 82, data: { program: "spl-token", parsed: { type: "mint", info: { decimals: 6, supply: "1000000000", mintAuthority: null, freezeAuthority: null, isInitialized: true } }, space: 82 } } };
          const d = Buffer.alloc(82); d.writeBigUInt64LE(1000000000n, 36); d[44] = 6; d[45] = 1;
          return { ...ctx, value: { owner: TOKEN, lamports: 1, executable: false, rentEpoch: 0, space: 82, data: [d.toString("base64"), "base64"] } };
        }
        if (ata.has(addr)) return { ...ctx, value: { owner: TOKEN, lamports: 2039280, executable: false, rentEpoch: 0, space: 165, data: [Buffer.alloc(165).toString("base64"), "base64"] } };
        return { ...ctx, value: null };
      }
      case "sendTransaction": return apply(params[0]);
      case "getSignatureStatuses": return { ...ctx, value: params[0].map((s) => (txs.has(s) ? { slot: 2, confirmations: null, err: null, confirmationStatus: "confirmed" } : null)) };
      case "getTransaction": return txs.get(params[0]) ?? null;
      default: throw new Error(`unmocked RPC ${method}`);
    }
  };

  let user = null;
  const server = createServer(async (req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    let body = "";
    for await (const c of req) body += c;
    const send = (data, status = 200) => { res.writeHead(status, { "content-type": "application/json", ...cors }); res.end(JSON.stringify(data)); };
    try {
      if (req.url === "/wallet/sign-and-send") {
        // The test wallet: sign the transaction the site built, exactly as a wallet would, then send it.
        const { tx } = JSON.parse(body);
        const decoded = getTransactionDecoder().decode(getBase64Encoder().encode(tx));
        const sig = await signBytes(user.signer.keyPair.privateKey, decoded.messageBytes);
        const signed = { ...decoded, signatures: { ...decoded.signatures, [user.signer.address]: sig } };
        const wire = getBase64Decoder().decode(getTransactionEncoder().encode(signed));
        const signature = apply(wire);
        return send({ signature, signatureB64: Buffer.from(sig).toString("base64") });
      }
      const { id, method, params } = JSON.parse(body);
      try { return send({ jsonrpc: "2.0", id, result: rpc(method, params) }); }
      catch (e) { return send({ jsonrpc: "2.0", id, error: { code: e.code ?? -32601, message: e.message } }); }
    } catch (e) {
      send({ error: e.message }, 400);
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}`, state, setUser: (u) => (user = u), close: () => server.close() };
}
