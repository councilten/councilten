import { homedir } from "node:os";
import { join } from "node:path";

export const VERSION = "0.1.0";

/** Every path the kit touches lives under one folder. Override with COUNCIL_HOME. */
export const HOME = process.env.COUNCIL_HOME || join(homedir(), ".council");
export const KEY_FILE = join(HOME, "wallet.json");
export const CONFIG_FILE = join(HOME, "config.json");
export const LEDGER_FILE = join(HOME, "ledger.jsonl");

export const VENICE_API = process.env.COUNCIL_VENICE_API || "https://api.venice.ai/api/v1";
export const BLOCKRUN_API = process.env.COUNCIL_BLOCKRUN_API || "https://sol.blockrun.ai/api";
export const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

export const USER_AGENT = `council-kit/${VERSION}`;
