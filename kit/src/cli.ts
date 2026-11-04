#!/usr/bin/env node
import { parseArgs } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, setConfigValue, type Config } from "./config.js";
import { createWallet, loadWallet } from "./wallet.js";
import { KEY_FILE, VERSION, USDC_MINT, CONFIG_FILE, LEDGER_FILE } from "./env.js";
import * as venice from "./venice.js";
import { catalog, resolve, FAMILIES, THE_TEN } from "./catalog.js";
import { ask, convene, type Run } from "./council.js";
import { paidFetch } from "./pay.js";
import { readLedger, record } from "./ledger.js";
import * as sol from "./solana.js";
import { bold, clay, dim, fail, green, heading, kv, note, num, red, secs, short, table, usd } from "./out.js";

const HELP = `${clay("council")} ${dim(VERSION)}  the multi-agent kit for Solana

${bold("Wallet")}
  init                       create the agent wallet (~/.council/wallet.json)
  status [address]           SOL, USDC, Council token and Venice credit
  fund <usd>                 top up Venice credit from Solana USDC (x402)

${bold("Think")}
  models [filter]            live catalog with prices, and what each alias resolves to
  ask "<question>"           one model answers        --model claude  --budget 0.05
  convene "<question>"       the council answers      --seats a,b,c | --ten  --judge claude  --budget 0.25

${bold("Pay")}
  pay <url>                  pay any x402 endpoint in USDC on Solana   --max 0.10  --method POST  --data '{}'
  ledger                     every payment and charge from this wallet

${bold("Token")}
  token                      supply, authorities and largest holders
  holders                    every holder by a full scan (needs a full RPC)
  burns                      burn instructions on the mint, with signatures
  send <to> <amount>         --asset sol|usdc|council  --yes
  burn <amount>              burn Council from the agent wallet   --yes

${bold("Agents")}
  mcp                        run the MCP server on stdio (Claude Code, Cursor, Codex)
  skill                      print SKILL.md for agents

${bold("Settings")}
  config [key] [value]       rpc, mint, maxPaymentUsd, runBudgetUsd, allowHosts, seats, judge, maxTokens

Every command takes --json. For agents: council skill`;

const { values: o, positionals: pos } = parseArgs({
  allowPositionals: true,
  strict: false,
  options: {
    json: { type: "boolean" },
    yes: { type: "boolean", short: "y" },
    force: { type: "boolean" },
    full: { type: "boolean" },
    ten: { type: "boolean" },
    model: { type: "string", short: "m" },
    seats: { type: "string" },
    judge: { type: "string" },
    budget: { type: "string" },
    max: { type: "string" },
    "max-tokens": { type: "string" },
    system: { type: "string" },
    method: { type: "string" },
    data: { type: "string" },
    asset: { type: "string" },
    limit: { type: "string" },
    refresh: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
});

const json = Boolean(o.json);
const out = (data: unknown, human: () => void) => (json ? console.log(JSON.stringify(data, null, 2)) : human());
const n = (v: unknown, name: string) => {
  const x = Number(v);
  if (!Number.isFinite(x) || x <= 0) fail(`${name} must be a positive number`);
  return x;
};

async function confirm(q: string): Promise<boolean> {
  if (o.yes) return true;
  if (!process.stdin.isTTY) fail("Irreversible. Re-run with --yes to confirm.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${q} ${dim("[y/N]")} `)).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}

function ctx(cfg: Config, signer: any) {
  const maxTokens = o["max-tokens"] ? Math.round(n(o["max-tokens"], "--max-tokens")) : cfg.maxTokens;
  return { signer, rpc: cfg.rpc, maxTokens, maxPaymentUsd: cfg.maxPaymentUsd };
}

function printRun(r: Run) {
  const main = r.verdict && !r.verdict.error ? r.verdict : r.answers.find((a) => !a.error);
  if (main) {
    const [body, split] = main.text.split(/\n(?=Split:)/);
    console.log("\n" + body.trim() + "\n");
    if (split) console.log(dim(split.trim()) + "\n");
  }
  if (o.full && r.verdict) {
    for (const a of r.answers.filter((x) => !x.error)) {
      heading(`${a.label}  ${dim(a.model)}`);
      console.log(a.text + "\n");
    }
  }
  const rows = r.answers.map((a) => [
    a.label,
    dim(a.model || a.seat),
    a.error ? red("failed") : secs(a.ms),
    a.error ? "" : usd(a.usd),
  ]);
  if (r.verdict) rows.push([clay("judge"), dim(r.verdict.model), r.verdict.error ? red("failed") : secs(r.verdict.ms), r.verdict.error ? "" : usd(r.verdict.usd)]);
  table(["seat", "model", "time>", "cost>"], rows);
  for (const a of [...r.answers, ...(r.verdict ? [r.verdict] : [])].filter((x) => x.error)) note(`${a.label}: ${a.error}`);
  console.log();
  kv([
    ["spent", `${usd(r.spentUsd)} ${dim(`of ${usd(r.budgetUsd, 2)} budget, worst case was ${usd(r.estimateUsd)}`)}`],
    ["run", dim(r.id)],
  ]);
}

async function main() {
  const [cmd, ...args] = pos;
  if (o.version) return console.log(VERSION);
  if (!cmd || o.help || cmd === "help") return console.log(HELP);
  const cfg = loadConfig();

  switch (cmd) {
    case "init": {
      const { signer, created } = await createWallet(Boolean(o.force));
      return out({ address: signer.address, created, keyFile: KEY_FILE }, () => {
        heading(created ? "Wallet created" : "Wallet already exists");
        kv([["address", bold(signer.address)], ["key file", dim(KEY_FILE)]]);
        console.log();
        note("Send USDC (SPL, Solana) to the address above from any exchange or wallet.");
        note("Payments need no SOL. Sends and burns need a little SOL for fees.");
        note(`Then: council fund 5   ${dim("and")}   council convene "your question"`);
      });
    }

    case "status": {
      const signer = await loadWallet();
      const who = args[0] ?? signer.address;
      const rpc = sol.rpcOf(cfg.rpc);
      const [b, v] = await Promise.all([
        sol.balances(rpc, who, cfg.mint),
        who === signer.address ? venice.balance(signer).catch((e) => ({ error: e.message })) : Promise.resolve(null),
      ]);
      return out({ address: who, ...b, venice: v }, () => {
        heading("Status");
        const rows: [string, string][] = [
          ["address", who],
          ["SOL", num(b.sol, 4)],
          ["USDC", num(b.usdc, 4)],
        ];
        if (cfg.mint) rows.push(["Council", num(b.token ?? 0, 2)]);
        if (v && "balanceUsd" in v) rows.push(["Venice credit", `${usd(v.balanceUsd)}${v.canConsume ? "" : dim("  top up to use Venice seats")}`]);
        else if (v && "error" in v) rows.push(["Venice credit", dim(String(v.error))]);
        kv(rows);
      });
    }

    case "fund": {
      const amount = n(args[0], "Amount");
      const signer = await loadWallet();
      if (amount > 500) fail("Top-ups are capped at $500 per command");
      if (!json && !(await confirm(`Top up ${usd(amount, 2)} of Venice credit from ${short(signer.address)}?`))) return;
      const r = await venice.topUp(signer, cfg.rpc, amount);
      record({ kind: "topup", provider: "venice", usd: r.usd, tx: r.tx });
      const after = await venice.balance(signer).catch(() => null);
      return out({ ...r, balanceUsd: after?.balanceUsd }, () => {
        heading("Venice credit topped up");
        kv([["paid", usd(r.usd, 2) + dim(" USDC")], ["tx", r.tx ?? dim("settled by Venice")], ["credit", after ? usd(after.balanceUsd) : dim("unknown")]]);
      });
    }

    case "models": {
      const models = await catalog(Boolean(o.refresh));
      const f = (args[0] ?? "").toLowerCase();
      const seats = THE_TEN.map((a) => {
        try { return { alias: a, ...resolve(a, models).model }; } catch { return { alias: a, id: null as any } as any; }
      });
      const list = models.filter((m) => !f || m.id.toLowerCase().includes(f) || m.name.toLowerCase().includes(f) || m.provider === f);
      return out({ aliases: seats, models: list }, () => {
        heading("The table");
        table(["alias", "model", "via", "in /M>", "out /M>"], seats.map((s: any) => [
          clay(s.alias), s.id ?? red("unavailable"), dim(s.provider ?? ""), s.id ? usd(s.input, 2) : "", s.id ? usd(s.output, 2) : "",
        ]));
        if (f) {
          heading(`Matching "${f}"`);
          table(["model", "via", "in /M>", "out /M>"], list.slice(0, 60).map((m) => [m.id, dim(m.provider), usd(m.input, 2), usd(m.output, 2)]));
        } else note(`${models.length} models live across Venice and BlockRun. Filter: council models claude`);
      });
    }

    case "ask": {
      const q = args.join(" ").trim();
      if (!q) fail('Usage: council ask "<question>" [--model claude]');
      const signer = await loadWallet();
      const budget = o.budget ? n(o.budget, "--budget") : cfg.runBudgetUsd;
      const r = await ask(ctx(cfg, signer), q, String(o.model ?? cfg.judge), budget, o.system as string | undefined);
      if (r.answers[0].error) fail(r.answers[0].error);
      return out(r, () => printRun(r));
    }

    case "convene":
    case "council": {
      const q = args.join(" ").trim();
      if (!q) fail('Usage: council convene "<question>" [--seats venice,claude,gpt] [--ten]');
      const signer = await loadWallet();
      const seats = o.ten ? THE_TEN : o.seats ? String(o.seats).split(",").map((s) => s.trim()).filter(Boolean) : cfg.seats;
      if (seats.length > 10) fail("A council seats at most ten");
      const budget = o.budget ? n(o.budget, "--budget") : cfg.runBudgetUsd;
      if (!json) note(`${seats.length} seats, judge ${o.judge ?? cfg.judge}, budget ${usd(budget, 2)}`);
      const r = await convene(ctx(cfg, signer), q, seats, String(o.judge ?? cfg.judge), budget);
      return out(r, () => printRun(r));
    }

    case "pay": {
      const url = args[0];
      if (!url || !(/^https:\/\//.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url))) fail("Usage: council pay <https url> [--max 0.10]");
      const host = new URL(url).host;
      const ceiling = Math.min(o.max ? n(o.max, "--max") : 0.1, cfg.maxPaymentUsd);
      if (cfg.allowHosts.length && !cfg.allowHosts.includes(host)) fail(`${host} is not in allowHosts (council config allowHosts ${[...cfg.allowHosts, host].join(",")})`);
      if (!cfg.allowHosts.length && !json && !(await confirm(`Pay ${host} up to ${usd(ceiling, 4)}?`))) return;
      const signer = await loadWallet();
      const method = String(o.method ?? (o.data ? "POST" : "GET")).toUpperCase();
      const init: RequestInit = { method, headers: o.data ? { "content-type": "application/json" } : {}, body: o.data ? String(o.data) : undefined };
      const r = await paidFetch(url, init, { signer, rpc: cfg.rpc, ceilingUsd: ceiling });
      const text = await r.response.text();
      if (r.usd > 0) record({ kind: "payment", url, usd: r.usd, tx: r.tx });
      return out({ status: r.response.status, usd: r.usd, tx: r.tx, body: text }, () => {
        console.log(text);
        console.error(dim(`\n${r.response.status} · paid ${usd(r.usd)}${r.tx ? ` · ${r.tx}` : ""}`));
      });
    }

    case "ledger": {
      const rows = readLedger(o.limit ? Number(o.limit) : 30);
      return out(rows, () => {
        heading("Ledger");
        if (!rows.length) return note("Nothing paid yet.");
        table(["time", "kind", "what", "usd>", "tx"], rows.map((e) => [
          dim(e.t.replace("T", " ").slice(0, 19)), e.kind, e.model ?? e.url ?? e.provider ?? "", usd(e.usd), e.tx ? short(e.tx) : dim("—"),
        ]));
        note(LEDGER_FILE);
      });
    }

    case "token": {
      if (!cfg.mint) fail("The mint is not set yet. When it is live: council config mint <address>");
      const rpc = sol.rpcOf(cfg.rpc);
      const info = await sol.mintInfo(rpc, cfg.mint);
      const largest: any = await rpc.getTokenLargestAccounts(cfg.mint as any).send();
      return out({ ...info, largest: largest.value }, () => {
        heading("Council token");
        kv([
          ["mint", info.mint],
          ["supply", num(info.supplyUi, 0)],
          ["decimals", String(info.decimals)],
          ["mint authority", info.mintAuthority ?? green("none (fixed supply)")],
          ["freeze authority", info.freezeAuthority ?? green("none")],
        ]);
      });
    }

    case "holders": {
      if (!cfg.mint) fail("The mint is not set yet: council config mint <address>");
      const h = await sol.holders(sol.rpcOf(cfg.rpc), cfg.mint).catch((e) => fail(`${e.message}. Holder scans need an RPC with getProgramAccounts (council config rpc <url>).`));
      return out(h, () => {
        heading(`${h.count.toLocaleString("en-US")} holders`);
        table(["#>", "owner", "amount>", "share>"], h.holders.slice(0, Number(o.limit ?? 25)).map((x, i) => [String(i + 1), x.owner, num(x.amount, 0), `${x.pct.toFixed(2)}%`]));
        note(`Top 10 hold ${h.top10Pct.toFixed(2)}%`);
      });
    }

    case "burns": {
      if (!cfg.mint) fail("The mint is not set yet: council config mint <address>");
      const b = await sol.burns(sol.rpcOf(cfg.rpc), cfg.mint);
      return out(b, () => {
        heading(`${b.count} burns · ${num(b.total, 0)} burned`);
        table(["time", "amount>", "signature"], b.burns.map((x) => [x.time ? new Date(x.time * 1000).toISOString().slice(0, 16).replace("T", " ") : "", num(x.amount, 0), x.signature]));
      });
    }

    case "send": {
      const [to, amt] = args;
      if (!to || !sol.isAddress(to)) fail("Usage: council send <address> <amount> --asset sol|usdc|council");
      const amount = n(amt, "Amount");
      const assetArg = String(o.asset ?? "usdc").toLowerCase();
      const asset = assetArg === "sol" ? "sol" : assetArg === "usdc" ? USDC_MINT : assetArg === "council" ? cfg.mint : assetArg;
      if (!asset) fail("The Council mint is not set yet");
      const signer = await loadWallet();
      if (!(await confirm(`Send ${amount} ${assetArg.toUpperCase()} to ${to}? This cannot be undone.`))) return;
      const sig = await sol.send(sol.rpcOf(cfg.rpc), signer, to, amount, asset);
      record({ kind: "send", usd: asset === USDC_MINT ? amount : 0, tx: sig, note: `${amount} ${assetArg} to ${to}` });
      return out({ signature: sig }, () => kv([["sent", `${amount} ${assetArg.toUpperCase()}`], ["tx", sig]]));
    }

    case "burn": {
      if (!cfg.mint) fail("The mint is not set yet: council config mint <address>");
      const amount = n(args[0], "Amount");
      const signer = await loadWallet();
      if (!(await confirm(`Burn ${amount} Council for good? Supply shrinks on chain; this cannot be undone.`))) return;
      const sig = await sol.burn(sol.rpcOf(cfg.rpc), signer, cfg.mint, amount);
      record({ kind: "burn", usd: 0, tx: sig, note: `${amount} burned` });
      return out({ signature: sig }, () => kv([["burned", num(amount, 0)], ["tx", sig]]));
    }

    case "config": {
      const [key, value] = args;
      if (key && value !== undefined) {
        const next = setConfigValue(cfg, key, value);
        saveConfig(next);
        return out(next, () => kv([[key, String((next as any)[key])]]));
      }
      if (key) return out((cfg as any)[key], () => console.log((cfg as any)[key]));
      return out(cfg, () => {
        heading("Config");
        kv(Object.entries(cfg).map(([k, v]) => [k, Array.isArray(v) ? v.join(", ") || dim("none") : v === null ? dim("not set") : String(v)]));
        note(CONFIG_FILE);
      });
    }

    case "mcp": {
      const { serve } = await import("./mcp.js");
      return serve();
    }

    case "skill": {
      const here = dirname(fileURLToPath(import.meta.url));
      const p = [join(here, "..", "SKILL.md"), join(here, "SKILL.md")].find(existsSync);
      if (!p) fail("SKILL.md not found in this install");
      return console.log(readFileSync(p, "utf8"));
    }

    default:
      if (FAMILIES[cmd]) fail(`Did you mean: council ask "..." --model ${cmd}`);
      fail(`Unknown command "${cmd}". Run: council help`);
  }
}

main().catch(fail);
