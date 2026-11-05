// Mainnet-shaped mocks of Venice, BlockRun, a generic x402 seller and a Solana RPC.
// They verify what a real server verifies: SIWX signatures, and that every x402 payment is a
// partially signed Solana transaction with a TransferChecked of the right amount, signed by the payer.
import { createServer } from "node:http";
import { createPublicKey, verify } from "node:crypto";
import {
  generateKeyPairSigner, getAddressEncoder, getBase58Decoder, getBase64Encoder,
  getTransactionDecoder, getCompiledTransactionMessageDecoder,
} from "@solana/kit";
import { parseSIWxHeader, verifySIWxSignature } from "@x402/extensions/sign-in-with-x";

const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SOL_NET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const unb64 = (s) => JSON.parse(Buffer.from(s, "base64").toString());

export async function startMock() {
  const veniceTo = (await generateKeyPairSigner()).address;
  const brTo = (await generateKeyPairSigner()).address;
  const feePayer = (await generateKeyPairSigner()).address;
  const blockhash = getBase58Decoder().decode(new Uint8Array(32).fill(7));
  const state = { credit: 0, topups: [], payments: [], siwx: 0, chats: [], log: [] };

  function checkPayment(header, amountUnits, payTo) {
    const p = unb64(header);
    const txB64 = p.payload?.transaction;
    if (!txB64) throw new Error("no transaction in payload");
    const bytes = getBase64Encoder().encode(txB64);
    const tx = getTransactionDecoder().decode(bytes);
    const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    const keys = msg.staticAccounts.map(String);
    if (keys[0] !== feePayer) throw new Error(`fee payer is ${keys[0]}, expected facilitator`);
    const xfer = msg.instructions.find((ix) => keys[ix.programAddressIndex] === TOKEN && ix.data?.[0] === 12);
    if (!xfer) throw new Error("no TransferChecked");
    const amount = Buffer.from(xfer.data).readBigUInt64LE(1);
    if (amountUnits !== undefined && amount !== BigInt(amountUnits)) throw new Error(`amount ${amount} != ${amountUnits}`);
    if (keys[xfer.accountIndices[1]] !== USDC) throw new Error("mint is not USDC");
    const authority = keys[xfer.accountIndices[3]];
    const sig = tx.signatures[authority];
    if (!sig) throw new Error("payer did not sign");
    const pub = createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(getAddressEncoder().encode(authority))]), format: "der", type: "spki" });
    if (!verify(null, Buffer.from(tx.messageBytes), pub, Buffer.from(sig))) throw new Error("bad payer signature");
    return { payer: authority, amount: Number(amount), payTo, version: p.x402Version };
  }

  async function checkSiwx(req, url) {
    const h = req.headers["sign-in-with-x"];
    if (!h) return { ok: false, why: "missing" };
    const p = parseSIWxHeader(h);
    if (p.domain !== url.host || p.uri !== `http://${url.host}${url.pathname}${url.search}`) return { ok: false, why: "not bound" };
    if (p.chainId !== SOL_NET || p.type !== "ed25519") return { ok: false, why: "chain" };
    const v = await verifySIWxSignature(p);
    if (!v?.isValid) return { ok: false, why: "signature" };
    state.siwx += 1;
    return { ok: true, address: p.address };
  }

  const required = (url, amount, payTo, version = 2) =>
    version === 2
      ? { x402Version: 2, resource: { url, mimeType: "application/json" }, accepts: [{ scheme: "exact", network: SOL_NET, asset: USDC, amount: String(amount), payTo, maxTimeoutSeconds: 300, extra: { feePayer } }] }
      : { x402Version: 1, accepts: [{ scheme: "exact", network: "solana", asset: USDC, maxAmountRequired: String(amount), payTo, resource: url, description: "", mimeType: "application/json", maxTimeoutSeconds: 300, extra: { feePayer } }] };

  const rpc = (method, params) => {
    const ctx = { context: { slot: 1 } };
    switch (method) {
      case "getLatestBlockhash": return { ...ctx, value: { blockhash, lastValidBlockHeight: 1000 } };
      case "getAccountInfo": {
        const [addr, cfg] = params;
        if (addr !== USDC) return { ...ctx, value: null };
        if (cfg?.encoding === "jsonParsed") return { ...ctx, value: { owner: TOKEN, lamports: 1, executable: false, rentEpoch: 0, space: 82, data: { program: "spl-token", parsed: { type: "mint", info: { decimals: 6, supply: "1000000000", mintAuthority: null, freezeAuthority: null, isInitialized: true } }, space: 82 } } };
        const d = Buffer.alloc(82); d.writeBigUInt64LE(1000000000n, 36); d[44] = 6; d[45] = 1;
        return { ...ctx, value: { owner: TOKEN, lamports: 1, executable: false, rentEpoch: 0, space: 82, data: [d.toString("base64"), "base64"] } };
      }
      case "getBalance": return { ...ctx, value: 0 };
      case "getTokenAccountsByOwner": return { ...ctx, value: [{ pubkey: brTo, account: { data: { parsed: { info: { tokenAmount: { uiAmount: 12.5 } } } } } }] };
      default: throw new Error(`unmocked RPC ${method}`);
    }
  };

  const veniceModels = { data: [
    ["venice-uncensored-1-2", 0.2, 0.9], ["claude-sonnet-5-5", 2, 10], ["claude-sonnet-5", 2, 10], ["claude-opus-5-5", 4, 20],
    ["grok-4-6", 2.27, 6.8], ["grok-4-7", 2.27, 6.8], ["gemini-3-5-flash", 1.55, 9.45], ["deepseek-v4-pro", 1.65, 3.3],
    ["kimi-k3-1-pro", 2, 10], ["qwen-3-8-max", 2.5, 7.5], ["z-ai-glm-5-3", 1.75, 5.5],
  ].map(([id, i, o]) => ({ id, type: "text", model_spec: { name: id, pricing: { input: { usd: i }, output: { usd: o } } } })) };
  const brModels = { data: [
    ["openai/gpt-5.4", 2.5, 15], ["openai/gpt-5.5", 5, 30], ["openai/gpt-5.5-pro", 30, 180], ["anthropic/claude-sonnet-5.5", 2, 10],
    ["mistral/mistral-large-4", 1.36, 4.18], ["xai/grok-4.7", 2, 6],
  ].map(([id, i, o]) => ({ id, billing_mode: "paid", pricing: { input: i, output: o } })) };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let body = "";
    for await (const c of req) body += c;
    const send = (status, data, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(data)); };
    const reply = (text, model) => ({ id: "c1", model, choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 40, completion_tokens: 60 } });
    state.log.push(`${req.method} ${url.pathname}`);
    try {
      if (url.pathname === "/rpc") {
        const { id, method, params } = JSON.parse(body);
        try { return send(200, { jsonrpc: "2.0", id, result: rpc(method, params) }); }
        catch (e) { return send(200, { jsonrpc: "2.0", id, error: { code: -32601, message: e.message } }); }
      }
      // ---- Venice
      if (url.pathname === "/venice/models") return send(200, veniceModels);
      if (url.pathname.startsWith("/venice/x402/balance/")) {
        const a = await checkSiwx(req, url);
        if (!a.ok) return send(401, { error: a.why });
        if (a.address !== url.pathname.split("/").pop()) return send(403, { error: "wallet mismatch" });
        return send(200, { data: { balanceUsd: state.credit, canConsume: state.credit > 0, minimumTopUpUsd: 5, suggestedTopUpUsd: 10, diemBalanceUsd: 0 } });
      }
      if (url.pathname === "/venice/x402/top-up") {
        const sig = req.headers["payment-signature"] || req.headers["x-payment"];
        const full = `http://${url.host}${url.pathname}`;
        if (!sig) return send(402, { error: "Payment required" }, { "PAYMENT-REQUIRED": b64(required(full, 5_000_000, veniceTo, state.v1 ? 1 : 2)) });
        const p = unb64(sig);
        const want = p.accepted?.amount ?? p.paymentRequirements?.maxAmountRequired;
        const chk = checkPayment(sig, want, veniceTo); // v1 payloads carry no amount: the transaction is the truth
        state.credit += chk.amount / 1e6;
        state.topups.push(chk);
        return send(200, { success: true, balanceUsd: state.credit }, { "PAYMENT-RESPONSE": b64({ success: true, transaction: "5VeniceTopupSig", network: SOL_NET }) });
      }
      if (state.failChats && (url.pathname === "/venice/chat/completions" || url.pathname === "/blockrun/v1/chat/completions")) return send(503, { error: "upstream unavailable" });
      if (url.pathname === "/venice/chat/completions") {
        const a = await checkSiwx(req, url);
        if (!a.ok) return send(401, { error: a.why });
        const j = JSON.parse(body);
        if (j.venice_parameters?.include_venice_system_prompt !== false) return send(400, { error: "expected venice_parameters" });
        if (state.credit <= 0) return send(402, { error: "Insufficient balance" });
        state.credit -= 0.001;
        state.chats.push(j.model);
        const isJudge = j.messages[0]?.role === "system" && /chair a council/.test(j.messages[0].content);
        return send(200, reply(isJudge ? "Merged answer from the council.\nSplit: none" : `answer from ${j.model}`, j.model), { "X-Balance-Remaining": String(state.credit) });
      }
      // ---- BlockRun
      if (url.pathname === "/blockrun/v1/models") return send(200, brModels);
      if (url.pathname === "/blockrun/v1/chat/completions") {
        const sig = req.headers["payment-signature"];
        const full = `http://${url.host}${url.pathname}`;
        if (!sig) return send(402, {}, { "payment-required": b64(required(full, 2100, brTo)) });
        const chk = checkPayment(sig, 2100, brTo);
        state.payments.push(chk);
        const j = JSON.parse(body);
        state.chats.push(j.model);
        return send(200, reply(`answer from ${j.model}`, j.model), { "PAYMENT-RESPONSE": b64({ success: true, transaction: "5BlockrunSig", network: SOL_NET }) });
      }
      // ---- any x402 seller
      if (url.pathname === "/paid/data" || url.pathname === "/paid/expensive") {
        const amount = url.pathname.endsWith("expensive") ? 5_000_000 : 50_000;
        const sig = req.headers["payment-signature"];
        if (!sig) return send(402, {}, { "PAYMENT-REQUIRED": b64(required(`http://${url.host}${url.pathname}`, amount, brTo)) });
        state.payments.push(checkPayment(sig, amount, brTo));
        return send(200, { data: 42 }, { "PAYMENT-RESPONSE": b64({ success: true, transaction: "5SellerSig", network: SOL_NET }) });
      }
      send(404, { error: "not found" });
    } catch (e) {
      state.log.push(`ERR ${e.message}`);
      send(400, { error: e.message });
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, state, close: () => server.close() };
}
