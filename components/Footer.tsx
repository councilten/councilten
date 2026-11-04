import Link from "next/link";
import { Mark, Wordmark } from "./Mark";
import { env, KIT_FILE, KIT_VERSION } from "@/lib/site";

export function Footer() {
  return (
    <footer className="ftr">
      <div className="wrap">
        <div className="ftr-grid">
          <div>
            <Link href="/" className="brand" aria-label="Council home">
              <Mark />
              <Wordmark />
            </Link>
            <p>The multi-agent kit for Solana. Not audited: keep small balances in the agent wallet. The private key never leaves your machine.</p>
          </div>
          <div>
            <h4>Kit</h4>
            <ul>
              <li><Link href="/docs">Docs</Link></li>
              <li><Link href="/docs#mcp">MCP server</Link></li>
              <li><Link href="/skill.md">SKILL.md</Link></li>
              <li><Link href="/llms.txt">llms.txt</Link></li>
            </ul>
          </div>
          <div>
            <h4>Downloads</h4>
            <ul>
              <li><a href={`/downloads/${KIT_FILE}`}>{KIT_FILE}</a></li>
              <li><a href="/downloads/council-kit-source.zip">source, zip</a></li>
              <li><a href="/api/models">/api/models</a></li>
            </ul>
          </div>
          <div>
            <h4>Elsewhere</h4>
            <ul>
              <li><Link href="/ledger">Ledger</Link></li>
              {env.githubUrl && <li><a href={env.githubUrl} rel="noopener">GitHub</a></li>}
              {env.xUrl && <li><a href={env.xUrl} rel="noopener">X</a></li>}
              <li><a href="https://www.x402.org/" rel="noopener">x402 protocol</a></li>
            </ul>
          </div>
        </div>
        <div className="fine">
          <span>Independent project. Not affiliated with Venice AI, BlockRun, Anthropic, OpenAI, xAI, Google or the Solana Foundation; Council uses their public APIs like any developer.</span>
          <span className="num">kit {KIT_VERSION} · MIT</span>
        </div>
      </div>
    </footer>
  );
}
