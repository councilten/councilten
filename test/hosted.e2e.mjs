// End-to-end test of hosted councils: the real site (production build) against mainnet-shaped mocks of
// Solana, Venice and BlockRun. Run: node test/hosted.e2e.mjs [--keep]
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from "@solana/kit";
import { startMock } from "../kit/test/mock.mjs";
import { keypair, startRpc } from "./rpc-mock.mjs";

const PORT = 3100;
const SITE = `http://127.0.0.1:${PORT}`;
const ok = (m) => console.log(`  ✓ ${m}`);

const providers = await startMock();
const server = await keypair();
const user = await keypair();
const poor = await keypair();
const rpc = await startRpc({ owners: [[server.signer.address, 20, 0.05], [user.signer.address, 5, 0.05], [poor.signer.address, 0.01, 0.05]] });
rpc.setUser(user);

const env = {
  ...process.env,
  HOSTED_ENABLED: "1",
  HOSTED_MEMORY_STORE: "1",
  COUNCIL_WALLET_KEY: server.secretJson,
  SOLANA_RPC_URL: `${rpc.url}`,
  COUNCIL_VENICE_API: `${providers.base}/venice`,
  COUNCIL_BLOCKRUN_API: `${providers.base}/blockrun`,
  VENICE_MODELS_URL: `${providers.base}/venice/models`,
  BLOCKRUN_MODELS_URL: `${providers.base}/blockrun/v1/models`,
  NEXT_TELEMETRY_DISABLED: "1",
};

console.log("building the site against the mocks");
// Async on purpose: the mocks live in this process and must keep answering while the build fetches the catalogs.
const b = await new Promise((resolve) => {
  const p = spawn("npx", ["next", "build", "--webpack"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.stderr.on("data", (d) => (out += d));
  p.on("close", (status) => resolve({ status, out }));
});
if (b.status !== 0) { console.error(b.out.slice(-4000)); process.exit(1); }
const next = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
next.stdout.on("data", (d) => (serverLog += d));
next.stderr.on("data", (d) => (serverLog += d));
for (let i = 0; i < 60; i++) { try { if ((await fetch(SITE + "/api/hosted/status")).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }

const post = (path, body) => fetch(SITE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const events = async (res) => (await res.text()).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const usdc = (a) => Number(rpc.state.units.get(a) ?? 0n) / 1e6;
const Q = "Should a treasury agent keep its USDC on Solana or bridge half to Base?";
const SEATS = ["venice", "claude", "gpt", "grok", "gemini"];

let failed = 0;
async function test(name, fn) {
  try { await fn(); ok(name); } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.stack?.split("\n").slice(0, 3).join("\n    ")}`); }
}

console.log("hosted councils");
await test("status: open, 15% table fee", async () => {
  const s = await (await fetch(SITE + "/api/hosted/status")).json();
  assert.equal(s.enabled, true); assert.equal(s.open, true); assert.equal(s.markupBps, 1500);
});

let preview;
await test("price preview without a wallet: cost plus 15%, rounded up to $0.001", async () => {
  const r = await post("/api/hosted/quote", { question: Q, seats: SEATS, length: "standard" });
  preview = await r.json();
  assert.equal(r.status, 200, JSON.stringify(preview));
  assert.equal(preview.seats.length, 5);
  const want = Math.max(10, Math.ceil(preview.costUsd * 1.15 * 1000 - 1e-9)) / 1000;
  assert.ok(Math.abs(preview.priceUsd - want) < 1e-9, `${preview.priceUsd} vs ${want}`);
  assert.ok(!("tx" in preview));
});

let quote;
await test("quote with a wallet: one TransferChecked of exactly the price to the council's USDC account, plus the memo", async () => {
  const r = await post("/api/hosted/quote", { question: Q, seats: SEATS, length: "standard", wallet: user.signer.address });
  quote = await r.json();
  assert.equal(r.status, 200, JSON.stringify(quote));
  const tx = getTransactionDecoder().decode(getBase64Encoder().encode(quote.tx));
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  const keys = msg.staticAccounts.map(String);
  assert.equal(keys[0], user.signer.address, "visitor pays the network fee");
  const x = msg.instructions.find((ix) => ix.data?.[0] === 12 && keys[ix.programAddressIndex].startsWith("Tokenkeg"));
  assert.equal(Buffer.from(x.data).readBigUInt64LE(1), BigInt(Math.round(quote.priceUsd * 1e6)));
  const memo = msg.instructions.find((ix) => keys[ix.programAddressIndex].startsWith("Memo"));
  assert.match(Buffer.from(memo.data).toString(), /^council:/);
  assert.equal(Object.values(tx.signatures).filter(Boolean).length, 0, "the site never signs for the visitor");
});

let paidSig;
const before = { user: usdc(user.signer.address), server: usdc(server.signer.address) };
await test("pay and convene: payment verified, five seats answer, judge writes the verdict", async () => {
  const s = await (await fetch(rpc.url + "/wallet/sign-and-send", { method: "POST", body: JSON.stringify({ tx: quote.tx }) })).json();
  paidSig = s.signature;
  const ev = await events(await post("/api/hosted/run", { quote: quote.quote, question: Q, signature: paidSig }));
  const types = ev.map((e) => e.type);
  assert.deepEqual(types.slice(0, 2), ["confirming", "paid"], types.join(","));
  assert.equal(ev.filter((e) => e.type === "seat" && e.text).length, 5, JSON.stringify(ev.filter((e) => e.type === "seat")));
  assert.ok(types.includes("judging"));
  const v = ev.find((e) => e.type === "verdict");
  assert.equal(v.text, "Merged answer from the council.");
  assert.equal(v.split, "", "Split: none is shown as no split");
  assert.equal(ev.at(-1).type, "done");
  assert.ok(Math.abs(usdc(user.signer.address) - (before.user - quote.priceUsd)) < 1e-9, "visitor paid exactly the price");
  assert.ok(Math.abs(usdc(server.signer.address) - (before.server + quote.priceUsd)) < 1e-9, "council received it");
});

await test("the council's wallet paid the models itself: Venice topped up over x402, BlockRun paid per call", async () => {
  assert.ok(providers.state.topups.length >= 1, "venice top-up");
  assert.equal(providers.state.topups[0].payer, server.signer.address);
  assert.ok(providers.state.payments.some((p) => p.payer === server.signer.address), "blockrun x402 from the council wallet");
  assert.ok(providers.state.siwx > 0);
});

await test("replay: the same payment cannot run a second council", async () => {
  const ev = await events(await post("/api/hosted/run", { quote: quote.quote, question: Q, signature: paidSig }));
  assert.equal(ev.at(-1).type, "error");
  assert.match(ev.at(-1).message, /already ran/);
});

await test("a forged quote is refused before anything runs", async () => {
  const [body] = quote.quote.split(".");
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  claims.u = "10000";
  const forged = Buffer.from(JSON.stringify(claims)).toString("base64url") + "." + quote.quote.split(".")[1];
  const r = await post("/api/hosted/run", { quote: forged, question: Q, signature: paidSig });
  assert.equal(r.status, 400);
});

await test("a different question than the one quoted is refused", async () => {
  const r = await post("/api/hosted/run", { quote: quote.quote, question: Q + " Really?", signature: paidSig });
  assert.equal(r.status, 400);
});

await test("paying a cheaper quote's transaction does not unlock a bigger council", async () => {
  const big = await (await post("/api/hosted/quote", { question: Q, seats: ["venice", "claude", "gpt", "grok", "gemini", "deepseek", "kimi", "qwen", "glm", "mistral"], length: "long", wallet: user.signer.address })).json();
  const small = await (await post("/api/hosted/quote", { question: Q, seats: ["venice", "claude"], length: "short", wallet: user.signer.address })).json();
  assert.ok(big.priceUsd > small.priceUsd);
  const s = await (await fetch(rpc.url + "/wallet/sign-and-send", { method: "POST", body: JSON.stringify({ tx: small.tx }) })).json();
  const ev = await events(await post("/api/hosted/run", { quote: big.quote, question: Q, signature: s.signature }));
  assert.equal(ev.at(-1).type, "error");
  assert.match(ev.at(-1).message, /less than the quoted price|different quote/);
});

await test("a wallet without enough USDC gets a clear message and no transaction", async () => {
  const r = await post("/api/hosted/quote", { question: Q, seats: SEATS, length: "standard", wallet: poor.signer.address });
  const j = await r.json();
  assert.equal(r.status, 402);
  assert.match(j.error, /holds \$0\.010 USDC/);
  assert.ok(!j.tx);
});

await test("price cap: a council above the per-question limit is refused", async () => {
  const r = await post("/api/hosted/quote", { question: "x".repeat(1200), seats: ["venice", "claude", "gpt", "grok", "gemini", "deepseek", "kimi", "qwen", "glm", "mistral"], length: "long", wallet: user.signer.address });
  const j = await r.json();
  if (r.status === 200) assert.ok(j.priceUsd <= 0.5); else assert.match(j.error, /limit per question/);
});

await test("every model down: the visitor is refunded in full, automatically", async () => {
  providers.state.failChats = true;
  const q = await (await post("/api/hosted/quote", { question: Q, seats: SEATS, length: "short", wallet: user.signer.address })).json();
  const userBefore = usdc(user.signer.address);
  const s = await (await fetch(rpc.url + "/wallet/sign-and-send", { method: "POST", body: JSON.stringify({ tx: q.tx }) })).json();
  assert.ok(Math.abs(usdc(user.signer.address) - (userBefore - q.priceUsd)) < 1e-9);
  const ev = await events(await post("/api/hosted/run", { quote: q.quote, question: Q, signature: s.signature }));
  providers.state.failChats = false;
  const rf = ev.find((e) => e.type === "refund");
  assert.ok(rf && rf.tx && !rf.error, JSON.stringify(ev));
  assert.ok(Math.abs(usdc(user.signer.address) - userBefore) < 1e-9, "refunded to the cent");
});

await test("the counters moved", async () => {
  await new Promise((r) => setTimeout(r, 31_000)); // status is cached for 30 s
  const s = await (await fetch(SITE + "/api/hosted/status")).json();
  assert.equal(s.runs, 1);
});

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (process.argv.includes("--keep")) {
  console.log(JSON.stringify({ site: SITE, rpc: rpc.url, user: user.signer.address }));
  process.env.KEEP_INFO = "1";
  await new Promise(() => {});
}
next.kill();
providers.close();
rpc.close();
if (failed) { console.log(serverLog.slice(-4000)); process.exit(1); }
process.exit(0);
