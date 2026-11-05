import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Command } from "@/components/Copy";
import { Chamber, type ChamberSeat } from "@/components/Chamber";
import { Flow } from "@/components/Flow";
import { Mark } from "@/components/Mark";
import { HeroTurbine } from "@/components/HeroTurbine";
import { Pricer } from "@/components/Pricer";
import { commands, env } from "@/lib/site";
import { getCatalog, seatCost } from "@/lib/models";

export const revalidate = 600;

// Typical answer latencies per family, used only to pace the example run.
const PACE: Record<string, number> = {
  venice: 1300, claude: 2600, gpt: 3100, grok: 2200, gemini: 1500,
  deepseek: 2900, kimi: 2400, qwen: 2000, glm: 1800, mistral: 1700,
};

const TOOLS: [string, string, "read" | "spend" | "final"][] = [
  ["council_status", "SOL, USDC and Council balances, and Venice credit.", "read"],
  ["council_models", "Live catalog, prices per million tokens, alias targets.", "read"],
  ["council_ask", "One model answers, inside a budget.", "spend"],
  ["council_convene", "Seats in parallel, one judge, one answer and the split.", "spend"],
  ["council_fund", "Top up Venice credit from Solana USDC over x402.", "spend"],
  ["council_pay", "Pay any x402 endpoint under a ceiling, allowlisted hosts only.", "spend"],
  ["council_ledger", "Every payment and charge, with signatures.", "read"],
  ["token_info", "The Council mint: supply, authorities, largest accounts.", "read"],
  ["token_holders", "Every holder by a full scan of the mint. Concentration.", "read"],
  ["token_burns", "Burn instructions on the mint, with signatures.", "read"],
  ["wallet_send", "Send SOL, USDC or Council. Asks the human first.", "final"],
  ["token_burn", "Burn Council from the agent wallet. Asks first.", "final"],
];
const TAG = { read: "read", spend: "spends", final: "irreversible" };

const FAQ: [string, string][] = [
  ["Is Council an official Venice, Anthropic or OpenAI product?", "No. Council is an independent kit built on public APIs: Venice's x402 API and BlockRun's Solana gateway. Venice bills the wallet that signs; Council holds no key and no credit."],
  ["Why Solana?", "Fees under a cent and finality in seconds. Venice accepts USDC on Solana for top-ups directly, and the x402 facilitator pays the network fee, so the paying wallet needs no SOL at all."],
  ["What does a payment look like?", "An x402 endpoint answers 402 with its price in USDC. The kit builds a TransferChecked to the recipient, signs it on your machine, and the server's facilitator lands it. One request, one receipt, no account and no API key."],
  ["How is a council different from asking one model?", "Every seat answers on its own, in parallel, without seeing the others. The judge reads all of them, keeps what holds up, drops what does not, and writes one answer, plus the one point the seats disagreed on. Use it when a single model's blind spot is the risk."],
  ["What does a run cost?", "Exactly what the seats cost at the providers' prices, shown live in the table above. Council adds nothing on top in 0.1.0. Every run prints its worst case before it starts and what it actually spent when it ends."],
  ["Can an agent use it without a human?", "Yes, inside the limits you set. Reads, asks and councils run within the budget and the per-payment ceiling. Sends and burns are marked irreversible: over MCP they refuse to run unless the call carries an explicit confirmation."],
  ["Where is the token?", "On Solana, with a new mint we publish here and on X the moment it goes live. Only trust the address printed on this page."],
];

const ctx = (n?: number) => (!n ? "—" : n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

export default async function Home() {
  const [cmd, cat] = await Promise.all([commands(), getCatalog()]);
  const live = cat.seats.filter((s) => s.model);
  const seats: ChamberSeat[] = live.map((s) => ({ label: s.alias, id: s.model!.id, ms: PACE[s.alias] ?? 2000, usd: seatCost(s.model) }));
  const judgeModel = cat.seats.find((s) => s.alias === "claude")?.model ?? live[0]?.model ?? null;
  const judge: ChamberSeat = { label: "judge", id: judgeModel?.id ?? "claude", ms: 2400, usd: seatCost(judgeModel, 2400, 320) };
  const heroSeats = cat.seats.map((s) => ({ alias: s.alias, label: s.label, id: s.model?.id ?? null, provider: s.model?.provider ?? null, input: s.model?.input ?? null, output: s.model?.output ?? null }));
  const priceSeats = live.map((s) => ({ alias: s.alias, label: s.label, id: s.model!.id, input: s.model!.input, output: s.model!.output, minimum: s.model!.minimum ?? 0 }));
  const worst = live.reduce((a, s) => a + seatCost(s.model, 60, 700), 0) + seatCost(judgeModel, 60 + live.length * 700, 1050);

  return (
    <>
      <Header />
      <main id="main">
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <div className="kicker">
                <span>Venice · Claude · GPT · Grok · Gemini</span>
                <span>on Solana</span>
              </div>
              <h1 className="display">
                Ten models.
                <br />
                <em>One answer.</em>
              </h1>
              <p className="lede">
                A wallet-native agent kit for Solana. One USDC balance pays <b>Venice, Claude, GPT, Grok and Gemini</b>. They
                answer together, a judge merges them into one answer, and no run can spend past the budget you set.
              </p>
              <div className="hero-actions">
                <Command text={cmd.init} />
                <div className="row">
                  <Link className="btn btn-primary" href="/ask">Ask the council</Link>
                  <Link className="btn btn-quiet" href="/docs">Read the docs</Link>
                </div>
              </div>
              <div className="spec" aria-label="What it is built on">
                <span>x402</span><span>USDC on Solana</span><span>CLI</span><span>MCP server</span>
                <span>10 model families</span><span>budgets</span><span>on-chain ledger</span><span>open source</span>
              </div>
            </div>
            <div className="hero-mark">
              <HeroTurbine seats={heroSeats} />
            </div>
          </div>
        </section>

        <section className="sec run" id="run">
          <div className="wrap run-grid">
            <div>
              <span className="label">01 · A run</span>
              <h2 className="h2" style={{ marginTop: 18 }}>Ask once. Ten answer.</h2>
              <p className="sec-sub">One question goes to every seat at the same moment. Each blade that lights is a seat that answered and was paid for. The judge reads them all and writes one answer, then names the point they split on.</p>
              <ol className="run-notes">
                <li><span className="num">01</span>Priced at its worst case before the first call.</li>
                <li><span className="num">02</span>Seats answer in parallel, none sees another.</li>
                <li><span className="num">03</span>The judge decides on the merits, not by vote.</li>
                <li><span className="num">04</span>The receipt: what it cost, against what you allowed.</li>
              </ol>
            </div>
            <div className="run-panel">
              {seats.length >= 2 ? (
                <Chamber
                  question="Should an agent prepay credit or pay per call?"
                  seats={seats}
                  judge={judge}
                  answer="Prepay where you call often and want privacy: one top-up, then each request draws on a balance and nothing per call touches the chain. Pay per call where use is rare or the price must be exact: x402 settles each request on its own, so no idle balance sits anywhere. Most agents want both, with a hard ceiling on every payment."
                  split="Split: whether a prepaid balance is a custody risk worth taking for speed."
                  budget={0.5}
                  worstCase={worst}
                />
              ) : (
                <div className="chamber"><div className="ch-answer"><p>The model catalogs are unreachable right now. The kit keeps working; this panel returns when they answer.</p></div></div>
              )}
              <p className="ch-note">Example run. Seats and prices are today&apos;s live catalog; the answer is illustrative.</p>
            </div>
          </div>
        </section>

        <section className="sec" id="start">
          <div className="wrap">
            <div className="sec-head">
              <span className="label">02 · Start</span>
              <div>
                <h2 className="h2">One wallet. Three commands.</h2>
                <p className="sec-sub">Node 20 or newer. Nothing to sign up for, no API key, no account. The wallet is the login and the payment.</p>
              </div>
            </div>
            <ol className="steps">
              <li>
                <span className="k num">1</span>
                <div>
                  <h3>Create the wallet</h3>
                  <p>A Solana keypair lands in <code>~/.council</code>, readable only by you. Send it USDC from any exchange or wallet.</p>
                </div>
                <pre className="term"><span className="c">$</span> council init{"\n"}<span className="d">  address    </span>7xKX…9fQm{"\n"}<span className="d">  key file   ~/.council/wallet.json</span></pre>
              </li>
              <li>
                <span className="k num">2</span>
                <div>
                  <h3>Fund Venice from USDC</h3>
                  <p>Venice credit comes straight from Solana USDC through Venice&apos;s own x402 top-up. No bridge, no SOL fee. Seats on other providers pay per call from the same wallet.</p>
                </div>
                <pre className="term"><span className="c">$</span> council fund 5{"\n"}<span className="d">  paid       </span>$5.00 USDC{"\n"}<span className="d">  credit     </span><span className="g">$5.0000</span></pre>
              </li>
              <li>
                <span className="k num">3</span>
                <div>
                  <h3>Convene</h3>
                  <p>Seats answer in parallel, the judge merges them and names where they split. The run is priced at its worst case before a cent moves.</p>
                </div>
                <pre className="term"><span className="c">$</span> council convene &quot;…&quot; --ten --budget 0.50{"\n"}<span className="d">  10 seats, judge claude, budget $0.50</span>{"\n"}<span className="d">  spent   </span>$0.0213<span className="d"> of $0.50</span></pre>
              </li>
            </ol>
          </div>
        </section>

        <section className="sec" id="models">
          <div className="wrap">
            <div className="sec-head">
              <span className="label">03 · The table</span>
              <div>
                <h2 className="h2">Ten seats. Every one live.</h2>
                <p className="sec-sub">Each alias resolves to the newest model in its family, read from the Venice and BlockRun catalogs every ten minutes. The CLI resolves them the same way.</p>
              </div>
            </div>
            {cat.ok ? (
              <>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>seat</th><th>family</th><th>model</th><th>via</th>
                        <th className="r">in · $/M</th><th className="r">out · $/M</th><th className="r">context</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cat.seats.map((s) => (
                        <tr key={s.alias}>
                          <td className="a">{s.alias}</td>
                          <td className="fam">{s.label}</td>
                          <td>{s.model?.id ?? <span className="muted">unavailable</span>}</td>
                          <td>{s.model && <span className="via" data-p={s.model.provider}>{s.model.provider}</span>}</td>
                          <td className="r num">{s.model ? s.model.input.toFixed(2) : "—"}</td>
                          <td className="r num">{s.model ? s.model.output.toFixed(2) : "—"}</td>
                          <td className="r num">{ctx(s.model?.context)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="tbl-meta">
                  <span className="num">{cat.total} models live · Venice {cat.venice} · BlockRun {cat.blockrun} · read {cat.updatedAt.slice(11, 16)} UTC</span>
                  <a href="/api/models">GET /api/models</a>
                </div>
              </>
            ) : (
              <div className="empty"><h2>The catalogs are not answering</h2><p>Venice and BlockRun publish their models openly; neither responded just now. The table fills in on the next read.</p></div>
            )}
          </div>
        </section>

        <section className="sec" id="price">
          <div className="wrap">
            <div className="sec-head">
              <span className="label">04 · Price it</span>
              <div>
                <h2 className="h2">Know the bill before the question.</h2>
                <p className="sec-sub">Set the table and the limits. This is the CLI&apos;s own estimate, run in your browser on today&apos;s prices: if the worst case is over budget, the kit refuses before it signs anything.</p>
              </div>
            </div>
            {priceSeats.length ? <div className="indent"><Pricer seats={priceSeats} /></div> : null}
          </div>
        </section>

        <section className="sec" id="how">
          <div className="wrap">
            <div className="sec-head">
              <span className="label">05 · How it decides</span>
              <div>
                <h2 className="h2">Priced first. Then paid.</h2>
              </div>
            </div>
            <div className="flow-grid">
              <div className="flow-scroll"><Flow /></div>
              <ul className="prose-list">
                <li><b>Worst case first.</b> Every seat at its full output, plus the judge. Above the budget nothing runs and nothing is paid.</li>
                <li><b>Venice seats draw on credit.</b> One top-up, then private inference with no transaction per call.</li>
                <li><b>Other seats pay per call over x402.</b> The 402 names the price, the kit signs a USDC transfer under your ceiling, the facilitator lands it.</li>
                <li><b>The judge decides on the merits,</b> not by majority, and writes one answer plus the one point the seats split on.</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="sec" id="mcp">
          <div className="wrap">
            <div className="sec-head">
              <span className="label">06 · For agents</span>
              <div>
                <h2 className="h2">Tools your agent gets.</h2>
                <p className="sec-sub">The local MCP server gives Claude Code, Cursor, Codex or any MCP client the same tools as the CLI. Reads need nothing. Spending stays inside your budgets.</p>
              </div>
            </div>
            <div className="tools">
              {TOOLS.map(([name, desc, k]) => (
                <div className="tool" key={name}>
                  <code>{name}</code>
                  <span>{desc}</span>
                  <em className="tag" data-k={k}>{TAG[k]}</em>
                </div>
              ))}
            </div>
            <div className="mcp-add">
              <Command text={cmd.mcp} />
            </div>
          </div>
        </section>

        <section className="sec" id="limits">
          <div className="wrap">
            <div className="sec-head">
              <span className="label">07 · Guardrails</span>
              <div>
                <h2 className="h2">Hard limits, enforced before signing.</h2>
              </div>
            </div>
            <div className="guards">
              <div className="guard">
                <div className="v num">$1.00</div>
                <p>The most any single payment can be. Checked before the transaction is built, and again by the x402 client. <code>maxPaymentUsd</code></p>
              </div>
              <div className="guard">
                <div className="v num">$0.25</div>
                <p>Default budget for one ask or one council, priced at its worst case. <code>runBudgetUsd</code></p>
              </div>
              <div className="guard">
                <div className="v num">0 <small>hosts</small></div>
                <p>Allowlisted by default. <code>council pay</code> asks every time; over MCP it pays none until you add one.</p>
              </div>
              <div className="guard">
                <div className="v num">600</div>
                <p>File mode of the keypair. The private key never leaves your machine; every payment is signed locally.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="sec" id="token">
          <div className="wrap">
            <div className="token">
              <Mark className="bg-mark" />
              <div>
                <span className="label">The Council token</span>
                <h2 className="h2" style={{ marginTop: 14 }}>Council moves on chain.</h2>
                <p className="sec-sub">A new mint on Solana, launched by us. The contract address is published here and on X the moment it goes live, nowhere else first.</p>
                <div className="ca-box">
                  <span className="label">Token CA · Solana</span>
                  {env.mint ? <code>{env.mint}</code> : <code>Drops at launch. Only trust the one published here.</code>}
                </div>
                <p className="sec-sub" style={{ fontSize: 16 }}>
                  Supply, holders and burns are read from Solana on the <Link href="/ledger">ledger</Link>, nothing typed by hand. The kit reads them too: <code>council token</code>, <code>holders</code>, <code>burns</code>.
                </p>
              </div>
              <ol className="road">
                <li><span className="w" data-live="">Live</span><div><h4>Kit 0.1.0</h4><p>CLI, MCP server, councils of up to ten, x402 payments in USDC, budgets, ledger.</p></div></li>
                <li><span className="w">Next</span><div><h4>Hosted councils</h4><p>Convene from the browser and from X, no install, paid from a connected wallet.</p></div></li>
                <li><span className="w">Next</span><div><h4>Pay in any token</h4><p>Swap to USDC inside the payment, so SOL, Council or any SPL token can pay a seat.</p></div></li>
                <li><span className="w">Later</span><div><h4>Holder seats</h4><p>Holding Council lowers the fee on hosted councils and opens larger tables.</p></div></li>
                <li><span className="w">Later</span><div><h4>Fee buyback</h4><p>A share of hosted-council fees buys Council on the market and burns it, listed on the ledger with signatures.</p></div></li>
                <li><span className="w">Later</span><div><h4>Swarms</h4><p>Budgeted agents that convene councils on a schedule and pay their own way.</p></div></li>
              </ol>
            </div>
          </div>
        </section>

        <section className="sec" id="faq">
          <div className="wrap">
            <div className="sec-head">
              <span className="label">08 · Questions</span>
              <div><h2 className="h2">Asked before you ask.</h2></div>
            </div>
            <div className="faq">
              {FAQ.map(([q, a]) => (
                <details key={q}>
                  <summary>{q}</summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="sec" id="changes">
          <div className="wrap">
            <div className="sec-head">
              <span className="label">09 · What changed</span>
              <div><h2 className="h2">Changelog.</h2></div>
            </div>
            <ul className="log">
              <li>
                <time dateTime="2026-11-05">Nov 5, 2026</time>
                <div>
                  Hosted councils at <Link href="/ask">/ask</Link>. Connect a Solana wallet, see one fixed price, approve one USDC payment, and up to ten models answer with a judge&apos;s verdict. The council&apos;s wallet pays every model over x402; each payment is verified on chain and runs exactly one council, and if no seat answers the payment is refunded automatically.
                </div>
              </li>
              <li>
                <time dateTime="2026-11-04">Nov 4, 2026</time>
                <div>
                  Kit 0.1.0. <code>init</code>, <code>status</code>, <code>fund</code>, <code>models</code>, <code>ask</code>, <code>convene</code>, <code>pay</code>, <code>ledger</code>, <code>token</code>, <code>holders</code>, <code>burns</code>, <code>send</code>, <code>burn</code>, <code>mcp</code>. Venice top-ups from Solana USDC through Venice&apos;s x402 top-up; per-call x402 on BlockRun with facilitator-paid fees; aliases resolved live across ten families; worst-case pricing before every run.
                </div>
              </li>
            </ul>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
