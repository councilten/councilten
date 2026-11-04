import { commands, origin, KIT_VERSION } from "@/lib/site";

export async function GET() {
  const o = await origin();
  const c = await commands();
  const body = `# Council

> The multi-agent kit for Solana. Pay in USDC; ask Venice, Claude, GPT, Grok and Gemini from one wallet. CLI, MCP server, x402 payments, a council of models that merges into one answer, hard budgets, on-chain ledger. Open source (MIT).

Kit ${KIT_VERSION}. Node 20+.

- Install: \`${c.init}\`
- MCP: \`${c.mcp}\`
- Agent rules: ${o}/skill.md
- Docs: ${o}/docs
- Live seats and prices (JSON): ${o}/api/models
- Token data (JSON): ${o}/api/token
- Source: ${o}/downloads/council-kit-source.zip

## Commands
init, status, fund <usd>, models, ask "<q>", convene "<q>" (--seats, --ten, --judge, --budget), pay <url>, ledger, token, holders, burns, send, burn, mcp, config. Every command takes --json.
`;
  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
