import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { loadWallet } from "./wallet.js";
import { VERSION, USDC_MINT } from "./env.js";
import * as venice from "./venice.js";
import { catalog, resolve, THE_TEN } from "./catalog.js";
import { ask, convene } from "./council.js";
import { paidFetch } from "./pay.js";
import { readLedger, record } from "./ledger.js";
import * as sol from "./solana.js";

const ok = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });
const err = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] });
const wrap = <A,>(fn: (a: A) => Promise<unknown>) => async (a: A) => {
  try { return ok(await fn(a)); } catch (e) { return err(e); }
};

const READ = { readOnlyHint: true, openWorldHint: true };
const SPEND = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const FINAL = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };

/**
 * Local MCP server. Reads need nothing. Spending tools stay inside the configured budgets and ceilings.
 * Sends and burns are irreversible: they refuse to run unless the call carries confirm: true,
 * which an agent should only set after the human said yes in the conversation.
 */
export async function serve() {
  const server = new McpServer({ name: "council", version: VERSION });
  const cfg = () => loadConfig();
  const ctx = async (maxTokens?: number) => {
    const c = cfg();
    return { signer: await loadWallet(), rpc: c.rpc, maxTokens: maxTokens ?? c.maxTokens, maxPaymentUsd: c.maxPaymentUsd };
  };

  server.registerTool("council_status", {
    title: "Wallet status",
    description: "SOL, USDC and Council token balances of the agent wallet (or any address), plus Venice credit for the agent wallet.",
    inputSchema: { address: z.string().optional().describe("Any Solana address; defaults to the agent wallet") },
    annotations: READ,
  }, wrap(async ({ address }) => {
    const c = cfg(); const signer = await loadWallet(); const who = address ?? signer.address;
    const b = await sol.balances(sol.rpcOf(c.rpc), who, c.mint);
    const v = who === signer.address ? await venice.balance(signer).catch((e) => ({ error: e.message })) : null;
    return { address: who, ...b, venice: v };
  }));

  server.registerTool("council_models", {
    title: "Model catalog",
    description: "Live models on Venice and BlockRun with USD prices per million tokens, and what each seat alias resolves to. Aliases: " + THE_TEN.join(", "),
    inputSchema: { filter: z.string().optional() },
    annotations: READ,
  }, wrap(async ({ filter }) => {
    const models = await catalog();
    const aliases = Object.fromEntries(THE_TEN.map((a) => { try { return [a, resolve(a, models).model]; } catch { return [a, null]; } }));
    const f = (filter ?? "").toLowerCase();
    return { aliases, models: f ? models.filter((m) => m.id.toLowerCase().includes(f) || m.provider === f) : undefined, count: models.length };
  }));

  server.registerTool("council_ask", {
    title: "Ask one model",
    description: "One model answers, paid from the wallet (Venice credit or per-call USDC). Priced at its worst case first; refused above the budget.",
    inputSchema: {
      question: z.string(),
      model: z.string().optional().describe("Alias (claude, gpt, grok, gemini, venice...) or provider:id"),
      system: z.string().optional(),
      budgetUsd: z.number().positive().max(5).optional(),
      maxTokens: z.number().int().positive().max(8000).optional(),
    },
    annotations: SPEND,
  }, wrap(async (a) => ask(await ctx(a.maxTokens), a.question, a.model ?? cfg().judge, a.budgetUsd ?? cfg().runBudgetUsd, a.system)));

  server.registerTool("council_convene", {
    title: "Convene the council",
    description: "Several models answer in parallel, then a judge merges them into one answer and names where they split. The whole run is priced at its worst case before anything is paid.",
    inputSchema: {
      question: z.string(),
      seats: z.array(z.string()).max(10).optional().describe("Defaults to the configured seats; pass the ten aliases for a full council"),
      judge: z.string().optional(),
      budgetUsd: z.number().positive().max(10).optional(),
      maxTokens: z.number().int().positive().max(4000).optional(),
    },
    annotations: SPEND,
  }, wrap(async (a) => {
    const c = cfg();
    return convene(await ctx(a.maxTokens), a.question, a.seats ?? c.seats, a.judge ?? c.judge, a.budgetUsd ?? c.runBudgetUsd);
  }));

  server.registerTool("council_fund", {
    title: "Top up Venice credit",
    description: "Turn USDC in the agent wallet into Venice credit through Venice's x402 top-up. Spends real USDC.",
    inputSchema: { usd: z.number().positive().max(100), confirm: z.literal(true).describe("Only after the human approved this amount") },
    annotations: SPEND,
  }, wrap(async ({ usd }) => {
    const r = await venice.topUp(await loadWallet(), cfg().rpc, usd);
    record({ kind: "topup", provider: "venice", usd: r.usd, tx: r.tx });
    return r;
  }));

  server.registerTool("council_pay", {
    title: "Pay an x402 endpoint",
    description: "Fetch a URL and pay its 402 in USDC on Solana, under a ceiling. Only hosts in allowHosts can be paid from MCP.",
    inputSchema: {
      url: z.string().url(),
      method: z.enum(["GET", "POST"]).optional(),
      body: z.string().optional(),
      maxUsd: z.number().positive().max(5).optional(),
    },
    annotations: SPEND,
  }, wrap(async ({ url, method, body, maxUsd }) => {
    const c = cfg(); const host = new URL(url).host;
    if (!c.allowHosts.includes(host)) throw new Error(`${host} is not in allowHosts. The human can add it: council config allowHosts ${[...c.allowHosts, host].join(",")}`);
    const r = await paidFetch(url, { method: method ?? (body ? "POST" : "GET"), headers: body ? { "content-type": "application/json" } : {}, body }, {
      signer: await loadWallet(), rpc: c.rpc, ceilingUsd: Math.min(maxUsd ?? 0.1, c.maxPaymentUsd),
    });
    if (r.usd > 0) record({ kind: "payment", url, usd: r.usd, tx: r.tx });
    return { status: r.response.status, usd: r.usd, tx: r.tx, body: (await r.response.text()).slice(0, 20000) };
  }));

  server.registerTool("council_ledger", {
    title: "Spend ledger",
    description: "Every payment and charge from this wallet, newest first.",
    inputSchema: { limit: z.number().int().positive().max(500).optional() },
    annotations: { readOnlyHint: true },
  }, wrap(async ({ limit }) => readLedger(limit ?? 50)));

  server.registerTool("token_info", {
    title: "Council token",
    description: "The Council mint: supply, decimals, authorities and largest accounts.",
    inputSchema: {},
    annotations: READ,
  }, wrap(async () => {
    const c = cfg(); if (!c.mint) throw new Error("Mint not set yet");
    const rpc = sol.rpcOf(c.rpc);
    const largest: any = await rpc.getTokenLargestAccounts(c.mint as any).send();
    return { ...(await sol.mintInfo(rpc, c.mint)), largest: largest.value };
  }));

  server.registerTool("token_holders", {
    title: "Token holders",
    description: "Every holder by a full scan of the mint's token accounts, with concentration.",
    inputSchema: { limit: z.number().int().positive().max(1000).optional() },
    annotations: READ,
  }, wrap(async ({ limit }) => {
    const c = cfg(); if (!c.mint) throw new Error("Mint not set yet");
    const h = await sol.holders(sol.rpcOf(c.rpc), c.mint);
    return { ...h, holders: h.holders.slice(0, limit ?? 100) };
  }));

  server.registerTool("token_burns", {
    title: "Token burns",
    description: "Burn instructions found in the mint's recent transactions, with signatures.",
    inputSchema: {},
    annotations: READ,
  }, wrap(async () => {
    const c = cfg(); if (!c.mint) throw new Error("Mint not set yet");
    return sol.burns(sol.rpcOf(c.rpc), c.mint);
  }));

  server.registerTool("wallet_send", {
    title: "Send from the agent wallet",
    description: "Send SOL, USDC or Council. Irreversible: only call with confirm: true after the human approved recipient and amount.",
    inputSchema: { to: z.string(), amount: z.number().positive(), asset: z.enum(["sol", "usdc", "council"]), confirm: z.literal(true) },
    annotations: FINAL,
  }, wrap(async ({ to, amount, asset }) => {
    const c = cfg();
    const mint = asset === "sol" ? "sol" : asset === "usdc" ? USDC_MINT : c.mint;
    if (!mint) throw new Error("Mint not set yet");
    const sig = await sol.send(sol.rpcOf(c.rpc), await loadWallet(), to, amount, mint);
    record({ kind: "send", usd: asset === "usdc" ? amount : 0, tx: sig, note: `${amount} ${asset} to ${to}` });
    return { signature: sig };
  }));

  server.registerTool("token_burn", {
    title: "Burn Council",
    description: "BurnChecked from the agent wallet; supply shrinks for good. Irreversible: only with confirm: true after the human approved.",
    inputSchema: { amount: z.number().positive(), confirm: z.literal(true) },
    annotations: FINAL,
  }, wrap(async ({ amount }) => {
    const c = cfg(); if (!c.mint) throw new Error("Mint not set yet");
    const sig = await sol.burn(sol.rpcOf(c.rpc), await loadWallet(), c.mint, amount);
    record({ kind: "burn", usd: 0, tx: sig, note: `${amount} burned` });
    return { signature: sig };
  }));

  await server.connect(new StdioServerTransport());
}
