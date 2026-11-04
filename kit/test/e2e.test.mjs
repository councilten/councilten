import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startMock } from "./mock.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");
let mock, env, home;

function run(args, extra = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { ...env, ...extra } }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code ?? 1 : 0, stdout, stderr, json: (() => { try { return JSON.parse(stdout); } catch { return null; } })() });
    });
  });
}

before(async () => {
  mock = await startMock();
  home = mkdtempSync(join(tmpdir(), "council-"));
  env = {
    PATH: process.env.PATH,
    NO_COLOR: "1",
    COUNCIL_HOME: home,
    COUNCIL_RPC: `${mock.base}/rpc`,
    COUNCIL_VENICE_API: `${mock.base}/venice`,
    COUNCIL_BLOCKRUN_API: `${mock.base}/blockrun`,
  };
});
after(() => mock.close());

test("init writes a 64-byte keypair readable only by the owner", async () => {
  const r = await run(["init", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.json.address, /^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  const key = JSON.parse(readFileSync(join(home, "wallet.json"), "utf8"));
  assert.equal(key.length, 64);
  assert.equal(statSync(join(home, "wallet.json")).mode & 0o777, 0o600);
  const again = await run(["init", "--json"]);
  assert.equal(again.json.created, false, "init never overwrites a wallet");
});

test("status reads chain balances and Venice credit with a verified Sign-In-With-X", async () => {
  const r = await run(["status", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.usdc, 12.5);
  assert.equal(r.json.venice.balanceUsd, 0);
  assert.ok(mock.state.siwx >= 1);
});

test("fund tops up Venice through x402: a signed TransferChecked of exactly the chosen amount", async () => {
  const r = await run(["fund", "7", "--yes", "--json"]);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.equal(r.json.usd, 7);
  assert.equal(r.json.tx, "5VeniceTopupSig");
  assert.equal(mock.state.topups.at(-1).amount, 7_000_000);
  assert.equal(r.json.balanceUsd, 7);
});

test("fund also answers a v1 challenge (network name 'solana')", async () => {
  mock.state.v1 = true;
  const r = await run(["fund", "5", "--yes", "--json"]);
  mock.state.v1 = false;
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.equal(mock.state.topups.at(-1).version, 1);
  assert.equal(mock.state.topups.at(-1).amount, 5_000_000);
});

test("models resolves every alias to the newest live model in its family", async () => {
  const r = await run(["models", "--json", "--refresh"]);
  assert.equal(r.code, 0, r.stderr);
  const a = Object.fromEntries(r.json.aliases.map((x) => [x.alias, x.id]));
  assert.equal(a.claude, "claude-sonnet-5-5");
  assert.equal(a.grok, "grok-4-7");
  assert.equal(a.gpt, "openai/gpt-5.5", "pro tiers are not picked");
  assert.equal(a.venice, "venice-uncensored-1-2");
  assert.equal(a.mistral, "mistral/mistral-large-4");
});

test("ask on Venice spends credit and is recorded", async () => {
  const r = await run(["ask", "What is x402?", "--model", "claude", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.answers[0].text, "answer from claude-sonnet-5-5");
  assert.equal(r.json.answers[0].provider, "venice");
});

test("ask on BlockRun pays per call in USDC, with the settlement signature", async () => {
  const r = await run(["ask", "hello", "--model", "gpt", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.answers[0].usd, 0.0021);
  assert.equal(r.json.answers[0].tx, "5BlockrunSig");
});

test("convene: seats answer in parallel, the judge merges, every charge lands in the ledger", async () => {
  const r = await run(["convene", "Is a fee buyback better than a burn?", "--seats", "venice,claude,gpt,grok", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.answers.length, 4);
  assert.ok(r.json.answers.every((a) => !a.error), JSON.stringify(r.json.answers));
  assert.match(r.json.verdict.text, /Merged answer/);
  assert.ok(r.json.spentUsd <= r.json.budgetUsd);
  const led = await run(["ledger", "--json", "--limit", "50"]);
  assert.ok(led.json.filter((e) => e.run === r.json.id).length >= 5, "four seats and the judge");
});

test("a council priced above its budget never runs and pays nothing", async () => {
  const before = mock.state.chats.length;
  const r = await run(["convene", "q", "--ten", "--budget", "0.01", "--json"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /above the \$0\.01 budget/);
  assert.equal(mock.state.chats.length, before);
});

test("pay settles an x402 seller under the ceiling", async () => {
  const r = await run(["pay", `${mock.base}/paid/data`, "--max", "0.10", "--yes", "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.usd, 0.05);
  assert.equal(JSON.parse(r.json.body).data, 42);
});

test("pay refuses a price above the ceiling before signing anything", async () => {
  const paid = mock.state.payments.length;
  const r = await run(["pay", `${mock.base}/paid/expensive`, "--max", "0.10", "--yes", "--json"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /above your \$0\.1 ceiling/);
  assert.equal(mock.state.payments.length, paid);
});

test("pay respects allowHosts", async () => {
  await run(["config", "allowHosts", "example.com"]);
  const r = await run(["pay", `${mock.base}/paid/data`, "--yes", "--json"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /not in allowHosts/);
  await run(["config", "allowHosts", ""]);
});

test("send and burn refuse to run without confirmation when not interactive", async () => {
  const r = await run(["send", "11111111111111111111111111111112", "1", "--asset", "sol"]);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /--yes/);
});

test("the MCP server starts and lists its tools", async () => {
  const { spawn } = await import("node:child_process");
  const p = spawn(process.execPath, [CLI, "mcp"], { env });
  const send = (m) => p.stdin.write(JSON.stringify(m) + "\n");
  let buf = "";
  const tools = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("mcp timeout " + buf)), 8000);
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        try { const m = JSON.parse(line); if (m.id === 2) { clearTimeout(t); resolve(m.result.tools); } } catch {}
      }
    });
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  });
  p.kill();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["council_ask", "council_convene", "council_fund", "council_ledger", "council_models", "council_pay", "council_status", "token_burn", "token_burns", "token_holders", "token_info", "wallet_send"]);
  assert.equal(tools.find((t) => t.name === "wallet_send").annotations.destructiveHint, true);
});
