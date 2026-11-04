# council-kit

The multi-agent kit for Solana. One wallet, one USDC balance, ten model families.

- **Pay in USDC.** Venice credit is topped up from Solana USDC through Venice's own x402 top-up. BlockRun seats pay per call over x402. The facilitator pays the network fee, so payments need no SOL.
- **Think with every model.** Venice, Claude, GPT, Grok, Gemini, DeepSeek, Kimi, Qwen, GLM and Mistral, resolved live from the Venice and BlockRun catalogs.
- **Convene a council.** Seats answer in parallel, a judge merges them into one answer and names where they split.
- **Budgets first.** Every run is priced at its worst case before a cent moves. Above the budget, nothing runs.
- **CLI and MCP.** The same tools for you and for Claude Code, Cursor, Codex or any MCP client.
- **On-chain ledger.** Every payment is a Solana transaction, recorded with its signature.

## Install

Node 20 or newer.

```
npx https://usecouncil.app/downloads/council-kit-0.1.0.tgz init
```

Or install it once and use `council` everywhere:

```
npm install -g https://usecouncil.app/downloads/council-kit-0.1.0.tgz
```

This writes a keypair to `~/.council/wallet.json` (mode 600) and prints the address. Send it USDC on Solana.

```
council fund 5
council convene "What breaks first when a Solana validator falls behind?"
```

## Commands

| Command | What it does |
|---|---|
| `init` | create the agent wallet |
| `status [address]` | SOL, USDC, Council token and Venice credit |
| `fund <usd>` | top up Venice credit from USDC (x402) |
| `models [filter]` | live catalog with prices and alias targets |
| `ask "<q>"` | one model answers (`--model`, `--budget`, `--max-tokens`, `--system`) |
| `convene "<q>"` | the council answers (`--seats`, `--ten`, `--judge`, `--budget`, `--full`) |
| `pay <url>` | pay any x402 endpoint in USDC on Solana (`--max`, `--method`, `--data`) |
| `ledger` | every payment and charge |
| `token`, `holders`, `burns` | the Council mint, read from chain |
| `send <to> <amount>` | SOL, USDC or Council (`--asset`, `--yes`) |
| `burn <amount>` | burn Council from the agent wallet (`--yes`) |
| `mcp` | MCP server on stdio |
| `config [key] [value]` | settings |

Every command takes `--json`.

## Configuration

`~/.council/config.json`, or `council config <key> <value>`.

| Key | Default | Meaning |
|---|---|---|
| `rpc` | `https://api.mainnet-beta.solana.com` | Solana RPC. Holder scans need one that allows `getProgramAccounts`. |
| `mint` | not set | the Council token mint |
| `maxPaymentUsd` | `1` | hard cap on any single payment |
| `runBudgetUsd` | `0.25` | default budget for one ask or council |
| `allowHosts` | none | hosts `pay` may pay without asking; MCP pays only these |
| `seats` | `venice,claude,gpt,grok,gemini` | default council |
| `judge` | `claude` | the model that merges answers |
| `maxTokens` | `700` | output tokens per seat |

Environment: `COUNCIL_HOME`, `COUNCIL_RPC`, `COUNCIL_MINT`, `COUNCIL_WALLET_KEY` (JSON array or base58 secret).

## Security

- The private key never leaves your machine. Every payment is signed locally.
- Keep small balances in the agent wallet. This software is not audited.
- Council is independent. It is not affiliated with Venice AI, BlockRun, Anthropic, OpenAI, xAI, Google or the Solana Foundation, and uses their public APIs like any developer.

## License

MIT
