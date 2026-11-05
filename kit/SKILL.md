---
name: council
description: Ask one model or convene a council of models (Venice, Claude, GPT, Grok, Gemini and more), paid in USDC on Solana from a local wallet, under hard budgets. Use when a question deserves more than one model, when you need to pay an x402 endpoint, or to read the Council token on chain.
---

# Council

Council is a CLI and a local MCP server. It holds a Solana wallet on this machine and pays for inference in USDC:
Venice seats draw on prepaid Venice credit (topped up over x402), BlockRun seats pay per call over x402.
Nothing leaves the machine except signed payments and the prompts you send.

## Use it

Every command takes `--json`. Prefer it; parse the result instead of reading the terminal output.

```
council status --json                         # SOL, USDC, Council, Venice credit
council models --json                         # live catalog, prices per million tokens, alias targets
council ask "question" --model claude --json  # one model
council convene "question" --json             # default seats + judge, one merged answer
council convene "question" --ten --budget 0.5 --json
council ledger --json                         # what was spent, with transaction signatures
```

Aliases resolve to the newest live model in each family: venice, claude, gpt, grok, gemini, deepseek, kimi, qwen, glm, mistral.
An exact model is `venice:<id>` or `blockrun:<id>`.

## Money rules

- Every run is priced at its worst case before anything is paid. Above `--budget` (default from `runBudgetUsd`) nothing runs; you get `BudgetExceeded` with the estimate. Ask the human before raising a budget.
- No single payment can exceed `maxPaymentUsd`. Do not change config values the human did not ask you to change.
- `council fund <usd>` spends real USDC. Only with the human's explicit amount.
- `send` and `burn` are irreversible. Never pass `--yes` (CLI) or `confirm: true` (MCP) unless the human approved that exact recipient and amount in this conversation.
- `council pay <url>` only pays hosts in `allowHosts` without asking. Never add a host to `allowHosts` yourself.

## MCP

Add it to any MCP client:

```
claude mcp add council -- npx -y https://councilten.com/downloads/council-kit-0.1.0.tgz mcp
```

Tools: council_status, council_models, council_ask, council_convene, council_fund, council_pay, council_ledger,
token_info, token_holders, token_burns, wallet_send, token_burn.
