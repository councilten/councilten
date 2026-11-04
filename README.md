# Council

The multi-agent kit for Solana. Pay in USDC; ask Venice, Claude, GPT, Grok and Gemini from one wallet. A council of models answers together, a judge merges them into one answer, and no run can spend past the budget you set.

- **x402 payments** in USDC on Solana. Venice credit is topped up through Venice's own x402 top-up; BlockRun seats pay per call. The facilitator pays the network fee.
- **CLI and MCP server.** The same tools for people and for Claude Code, Cursor, Codex or any MCP client.
- **Ten model families**, resolved live from the public Venice and BlockRun catalogs.
- **Budgets first.** Every run is priced at its worst case before anything is paid.
- **On-chain ledger.** Every payment is a Solana transaction, recorded with its signature.

## Repository

| Path | What it is |
|---|---|
| `kit/` | `council-kit`, the CLI and MCP server (TypeScript, Node 20+) |
| `kit/test/` | end-to-end tests against mainnet-shaped mocks of Venice, BlockRun and a Solana RPC |
| `app/`, `components/`, `lib/` | the website (Next.js) |
| `public/downloads/` | the packed kit, its source and SKILL.md, served by the site |

## The kit

```
cd kit
npm install
npm run build
npm test
```

The tests run the real CLI binary against local mocks that verify what a real server verifies: every Sign-In-With-X signature, and that every x402 payment is a partially signed Solana transaction carrying a TransferChecked of the exact amount, signed by the payer, with the facilitator as fee payer.

Release a new version: bump `kit/package.json`, `KIT_VERSION` in `lib/site.ts` and `VERSION` in `kit/src/env.ts`, then `npm run build && npm pack` in `kit/` and move the tarball to `public/downloads/`.

## The site

```
npm install
npm run build
```

| Variable | Needed | Meaning |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | optional | public URL used in install commands; defaults to the Vercel production URL |
| `NEXT_PUBLIC_X_URL` | optional | X profile link |
| `NEXT_PUBLIC_GITHUB_URL` | optional | repository link |
| `NEXT_PUBLIC_TOKEN_MINT` | at launch | the Council mint; empty shows "drops at launch" |
| `SOLANA_RPC_URL` | at launch | server-side RPC for the ledger page |

Public endpoints: `/api/models` (seats, models and live prices), `/api/token` (the mint, read from chain), `/llms.txt`, `/skill.md`.

## Security

The private key never leaves the user's machine. The kit is not audited; keep small balances in the agent wallet.

Council is independent and uses public APIs like any developer. It is not affiliated with Venice AI, BlockRun, Anthropic, OpenAI, xAI, Google or the Solana Foundation.

## License

MIT
