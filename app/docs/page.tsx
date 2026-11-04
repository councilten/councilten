import type { Metadata } from "next";
import Link from "next/link";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { Command } from "@/components/Copy";
import { commands, KIT_VERSION } from "@/lib/site";

export const metadata: Metadata = { title: "Docs", description: "Install, fund, ask, convene, pay and wire Council into any MCP client." };

const TOC: [string, string][] = [
  ["install", "Install"], ["wallet", "Wallet"], ["fund", "Funding"], ["models", "Models and aliases"], ["ask", "Ask"],
  ["convene", "Convene"], ["budgets", "Budgets"], ["pay", "Pay any x402 endpoint"], ["ledger", "Ledger"], ["token", "Token"],
  ["mcp", "MCP server"], ["config", "Configuration"], ["security", "Security"],
];

export default async function Docs() {
  const cmd = await commands();
  return (
    <>
      <Header current="docs" />
      <main id="main" className="wrap docs">
        <nav className="toc" aria-label="On this page">
          <span className="label">Docs · kit {KIT_VERSION}</span>
          {TOC.map(([id, t]) => <a key={id} href={`#${id}`}>{t}</a>)}
        </nav>
        <article className="doc">
          <h1>Council docs</h1>
          <p className="intro">A CLI and a local MCP server that hold a Solana wallet and pay for inference in USDC. Everything below is what the kit actually does; every command takes <code>--json</code>.</p>

          <h2 id="install">Install</h2>
          <p>Node 20 or newer. Run it straight from the tarball, or install it once.</p>
          <div style={{ margin: "16px 0", display: "grid", gap: 10 }}>
            <Command text={cmd.init} />
            <Command text={cmd.global} />
          </div>
          <p>The package ships its source next to the build. Read it before you fund it: <a href="/downloads/council-kit-source.zip">council-kit-source.zip</a>.</p>

          <h2 id="wallet">Wallet</h2>
          <p><code>council init</code> writes a plain Solana CLI keypair (a 64-byte JSON array) to <code>~/.council/wallet.json</code> with file mode 600 and prints the address. It never overwrites an existing wallet unless you pass <code>--force</code>.</p>
          <pre className="term"><span className="c">$</span> council init{"\n"}<span className="d">  address    </span>7xKX…9fQm{"\n"}<span className="d">  key file   ~/.council/wallet.json</span>{"\n\n"}<span className="c">$</span> council status{"\n"}<span className="d">  SOL             </span>0.0000{"\n"}<span className="d">  USDC            </span>12.5000{"\n"}<span className="d">  Venice credit   </span>$0.0000</pre>
          <p>Send USDC (SPL, on Solana) to the address. Payments need no SOL: the x402 facilitator pays the network fee. Only <code>send</code> and <code>burn</code> need a little SOL.</p>
          <p>To use an existing key, set <code>COUNCIL_WALLET_KEY</code> to a JSON byte array or a base58 secret. To keep several wallets apart, set <code>COUNCIL_HOME</code>.</p>

          <h2 id="fund">Funding</h2>
          <p>Venice seats draw on Venice credit. <code>council fund &lt;usd&gt;</code> tops it up straight from Solana USDC through Venice&apos;s own x402 top-up: the kit asks Venice for the payment terms, signs a USDC transfer of exactly that amount and Venice credits the wallet that signed.</p>
          <pre className="term"><span className="c">$</span> council fund 5{"\n"}<span className="d">  paid     </span>$5.00 USDC{"\n"}<span className="d">  tx       </span>4ShZ…uY2p{"\n"}<span className="d">  credit   </span><span className="g">$5.0000</span></pre>
          <div className="callout">Sending USDC directly to a Venice address does not top up anything. Only payments settled through the top-up route are credited.</div>
          <p>Seats served by BlockRun (GPT and others) need no top-up. Each call answers 402 with its exact price and the kit pays it per call from the wallet&apos;s USDC.</p>

          <h2 id="models">Models and aliases</h2>
          <p><code>council models</code> reads both public catalogs and shows what each alias resolves to, with prices per million tokens. Within a family the newest version wins, so <code>claude</code> keeps pointing at the current Sonnet as the catalogs move. Venice is tried first where it serves the family.</p>
          <table>
            <thead><tr><th>Alias</th><th>Family</th><th>Tried in order</th></tr></thead>
            <tbody>
              <tr><td><code>venice</code></td><td>Venice Uncensored</td><td>Venice</td></tr>
              <tr><td><code>claude</code></td><td>Claude Sonnet</td><td>Venice, then BlockRun</td></tr>
              <tr><td><code>gpt</code></td><td>GPT</td><td>BlockRun, then Venice (gpt-oss)</td></tr>
              <tr><td><code>grok</code></td><td>Grok</td><td>Venice, then BlockRun</td></tr>
              <tr><td><code>gemini</code></td><td>Gemini Flash</td><td>Venice, then BlockRun</td></tr>
              <tr><td><code>deepseek</code></td><td>DeepSeek Pro</td><td>Venice, then BlockRun</td></tr>
              <tr><td><code>kimi</code></td><td>Kimi Pro</td><td>Venice, then BlockRun</td></tr>
              <tr><td><code>qwen</code></td><td>Qwen Max</td><td>Venice, then BlockRun</td></tr>
              <tr><td><code>glm</code></td><td>GLM</td><td>Venice, then BlockRun</td></tr>
              <tr><td><code>mistral</code></td><td>Mistral Large</td><td>BlockRun, then Venice</td></tr>
            </tbody>
          </table>
          <p>To pin an exact model, use <code>venice:&lt;id&gt;</code> or <code>blockrun:&lt;id&gt;</code>, for example <code>blockrun:openai/gpt-5.5</code>.</p>

          <h2 id="ask">Ask</h2>
          <p>One model, one answer.</p>
          <pre className="term"><span className="c">$</span> council ask &quot;Explain x402 in two sentences&quot; --model grok{"\n\n"}<span className="d">  seat   model      time      cost</span>{"\n"}  Grok   grok-4-7   1.9 s   $0.0013</pre>
          <p>Flags: <code>--model</code>, <code>--system</code>, <code>--budget</code>, <code>--max-tokens</code>.</p>

          <h2 id="convene">Convene</h2>
          <p>Every seat answers the question on its own, in parallel. The judge then reads all the answers, keeps what holds up, drops what does not, resolves disagreements on the merits, and writes one answer followed by a <code>Split:</code> line naming the main disagreement. A seat that fails is reported and skipped; the judge needs two answers.</p>
          <pre className="term"><span className="c">$</span> council convene &quot;Is a fee buyback better than a burn?&quot; --seats venice,claude,gpt,grok{"\n"}<span className="c">$</span> council convene &quot;…&quot; --ten --judge gpt --budget 0.50 --full</pre>
          <table>
            <thead><tr><th>Flag</th><th>Meaning</th></tr></thead>
            <tbody>
              <tr><td><code>--seats a,b,c</code></td><td>Aliases or exact models, up to ten. Default: <code>venice,claude,gpt,grok,gemini</code>.</td></tr>
              <tr><td><code>--ten</code></td><td>All ten families.</td></tr>
              <tr><td><code>--judge</code></td><td>The model that merges. Default <code>claude</code>.</td></tr>
              <tr><td><code>--budget</code></td><td>Most the whole run may cost, in USD.</td></tr>
              <tr><td><code>--max-tokens</code></td><td>Output tokens per seat (the judge gets 1.5x).</td></tr>
              <tr><td><code>--full</code></td><td>Print every seat&apos;s answer after the verdict.</td></tr>
            </tbody>
          </table>

          <h2 id="budgets">Budgets</h2>
          <p>Before anything is paid, the run is priced at its worst case: the full prompt in and every allowed output token out for every seat, plus the judge reading all of them, never below a provider&apos;s per-call floor. If that exceeds the budget, nothing runs and nothing is paid; you get the estimate and can raise the budget, drop seats or lower <code>--max-tokens</code>.</p>
          <p>Independently, no single payment can exceed <code>maxPaymentUsd</code> (default $1). The limit is applied twice: by the kit before it builds the transaction, and by the x402 client&apos;s own spend controls.</p>

          <h2 id="pay">Pay any x402 endpoint</h2>
          <p><code>council pay &lt;url&gt;</code> fetches the URL and, if it answers 402, pays it in USDC on Solana under a ceiling (<code>--max</code>, default $0.10, never above <code>maxPaymentUsd</code>). Both x402 versions are answered: CAIP-2 networks (<code>solana:5eyk…</code>) and the v1 name <code>solana</code>.</p>
          <pre className="term"><span className="c">$</span> council pay https://api.example.com/report --max 0.05{"\n"}<span className="d">200 · paid $0.0500 · 5Sel…rSig</span></pre>
          <p>Hosts in <code>allowHosts</code> are paid without a prompt; any other host asks first. Over MCP, only allowlisted hosts can be paid at all.</p>

          <h2 id="ledger">Ledger</h2>
          <p>Every top-up, charge and payment is appended to <code>~/.council/ledger.jsonl</code> with its time, model or URL, USD amount and transaction signature when the server returns one. <code>council ledger</code> prints it; <code>--json</code> returns it.</p>

          <h2 id="token">Token</h2>
          <p>Once the mint is live, set it: <code>council config mint &lt;address&gt;</code>. Then:</p>
          <ul>
            <li><code>council token</code>: supply, decimals, mint and freeze authority.</li>
            <li><code>council holders</code>: every holder by a full scan of the mint&apos;s token accounts. Needs an RPC that allows <code>getProgramAccounts</code>.</li>
            <li><code>council burns</code>: burn instructions found in the mint&apos;s recent transactions, with signatures.</li>
            <li><code>council burn &lt;amount&gt; --yes</code>: BurnChecked from the agent wallet. The supply shrinks on chain, for good.</li>
          </ul>
          <p>Classic SPL and Token-2022 mints both work. The <Link href="/ledger">ledger page</Link> shows the same numbers.</p>

          <h2 id="mcp">MCP server</h2>
          <p><code>council mcp</code> runs a local MCP server on stdio with the same wallet and config.</p>
          <div style={{ margin: "16px 0" }}><Command text={cmd.mcp} /></div>
          <p>For Cursor, Codex or any client that takes a command, use <code>npx -y {cmd.tgz} mcp</code>.</p>
          <table>
            <thead><tr><th>Tool</th><th>What it does</th></tr></thead>
            <tbody>
              <tr><td><code>council_status</code></td><td>Balances and Venice credit. Read only.</td></tr>
              <tr><td><code>council_models</code></td><td>Live catalog and alias targets. Read only.</td></tr>
              <tr><td><code>council_ask</code></td><td>One model, inside a budget.</td></tr>
              <tr><td><code>council_convene</code></td><td>The council, inside a budget.</td></tr>
              <tr><td><code>council_fund</code></td><td>Venice top-up; requires <code>confirm: true</code>.</td></tr>
              <tr><td><code>council_pay</code></td><td>x402 payment to an allowlisted host.</td></tr>
              <tr><td><code>council_ledger</code></td><td>Spend history.</td></tr>
              <tr><td><code>token_info</code>, <code>token_holders</code>, <code>token_burns</code></td><td>The mint, read from chain.</td></tr>
              <tr><td><code>wallet_send</code>, <code>token_burn</code></td><td>Irreversible; marked destructive and refused without <code>confirm: true</code>.</td></tr>
            </tbody>
          </table>
          <p>Agents can read the rules in <Link href="/skill.md">SKILL.md</Link> (also printed by <code>council skill</code>).</p>

          <h2 id="config">Configuration</h2>
          <p><code>~/.council/config.json</code>, or <code>council config &lt;key&gt; &lt;value&gt;</code>.</p>
          <table>
            <thead><tr><th>Key</th><th>Default</th><th>Meaning</th></tr></thead>
            <tbody>
              <tr><td><code>rpc</code></td><td>public mainnet</td><td>Solana RPC for payments and reads.</td></tr>
              <tr><td><code>mint</code></td><td>not set</td><td>The Council mint.</td></tr>
              <tr><td><code>maxPaymentUsd</code></td><td>1</td><td>Cap on any single payment.</td></tr>
              <tr><td><code>runBudgetUsd</code></td><td>0.25</td><td>Default budget per run.</td></tr>
              <tr><td><code>allowHosts</code></td><td>none</td><td>Hosts <code>pay</code> may pay without asking.</td></tr>
              <tr><td><code>seats</code></td><td>venice, claude, gpt, grok, gemini</td><td>Default council.</td></tr>
              <tr><td><code>judge</code></td><td>claude</td><td>The model that merges.</td></tr>
              <tr><td><code>maxTokens</code></td><td>700</td><td>Output tokens per seat.</td></tr>
            </tbody>
          </table>
          <p>Environment: <code>COUNCIL_HOME</code>, <code>COUNCIL_RPC</code>, <code>COUNCIL_MINT</code>, <code>COUNCIL_WALLET_KEY</code>.</p>

          <h2 id="security">Security</h2>
          <ul>
            <li>The private key never leaves your machine. Every payment is a transaction signed locally and landed by the seller&apos;s facilitator.</li>
            <li>Venice requests carry a fresh Sign-In-With-X signature each time: single use, five-minute lifetime, bound to the exact URL.</li>
            <li>Not audited. Keep small balances in the agent wallet.</li>
            <li>Council is independent and uses public APIs like any developer. It is not affiliated with Venice AI, BlockRun, Anthropic, OpenAI, xAI, Google or the Solana Foundation.</li>
          </ul>
        </article>
      </main>
      <Footer />
    </>
  );
}
