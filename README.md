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

### Hosted councils (`/ask`)

Visitors connect a Solana wallet (Wallet Standard: Phantom, Solflare, Backpack), see a fixed price, and approve one USDC transfer to the council's wallet. The server verifies that transfer on chain (amount, destination, payer and the quote's memo), then the council's own wallet pays every model over x402 and the answers stream back. No API keys anywhere.

- Price: the CLI's worst case for the chosen seats and answer length, plus the table fee (`HOSTED_MARKUP_BPS`), rounded up to $0.001.
- Every payment runs one council only (memo-bound quote, claimed once in Redis). Forged or expired quotes, a different question, or a smaller payment are refused.
- If no seat answers, the visitor is refunded in full automatically (the wallet needs a little SOL for that).
- Venice credit is topped up from the wallet's USDC when it runs low (`HOSTED_VENICE_TOPUP_USD`).
- Limits: `HOSTED_MAX_USD` per question, `HOSTED_WALLET_HOURLY` councils per wallet per hour.

| Variable | Needed | Meaning |
|---|---|---|
| `HOSTED_ENABLED` | to open | `1` opens the table |
| `COUNCIL_WALLET_KEY` | to open | the council's hot wallet secret; keep only the float in it |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | to open | Upstash Redis (Vercel Storage integration), or `UPSTASH_REDIS_REST_*` |
| `SOLANA_RPC_URL` | to open | a Helius or Triton URL; also used by the ledger |
| `HOSTED_MARKUP_BPS` | optional | table fee, default 1500 (15%) |
| `HOSTED_MAX_USD` | optional | max price per question, default 0.5 |
| `HOSTED_WALLET_HOURLY` | optional | councils per wallet per hour, default 20 |
| `HOSTED_VENICE_TOPUP_USD` | optional | Venice refill size, default 5 |
| `HOSTED_HOLDER_DISCOUNT_BPS`, `HOSTED_HOLDER_MIN` | optional | holder discount on the fee (off by default) |

Tests: `node test/hosted.e2e.mjs` builds the site and runs 13 end-to-end checks against mocks of Solana, Venice and BlockRun; `python3 test/ask_ui.py` drives `/ask` with a test wallet (see the file header).

## Security

The private key never leaves the user's machine. The kit is not audited; keep small balances in the agent wallet.

Council is independent and uses public APIs like any developer. It is not affiliated with Venice AI, BlockRun, Anthropic, OpenAI, xAI, Google or the Solana Foundation.

## License

MIT
