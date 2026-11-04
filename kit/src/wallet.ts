import { existsSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createKeyPairSignerFromBytes, createKeyPairSignerFromPrivateKeyBytes, getAddressEncoder, type KeyPairSigner } from "@solana/kit";
import { KEY_FILE } from "./env.js";
import { ensureHome } from "./config.js";

/**
 * The agent wallet is a plain Solana CLI keypair file (64-byte JSON array) at ~/.council/wallet.json,
 * readable only by you. It never leaves this machine; every payment is signed locally.
 */
export async function createWallet(force = false): Promise<{ signer: KeyPairSigner; created: boolean }> {
  ensureHome();
  if (existsSync(KEY_FILE) && !force) return { signer: await loadWallet(), created: false };
  const seed = new Uint8Array(randomBytes(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed, true);
  const pub = getAddressEncoder().encode(signer.address);
  const bytes = new Uint8Array(64);
  bytes.set(seed, 0);
  bytes.set(pub, 32);
  writeFileSync(KEY_FILE, JSON.stringify(Array.from(bytes)), { mode: 0o600 });
  chmodSync(KEY_FILE, 0o600);
  seed.fill(0);
  return { signer, created: true };
}

export async function loadWallet(): Promise<KeyPairSigner> {
  if (process.env.COUNCIL_WALLET_KEY) return fromSecret(process.env.COUNCIL_WALLET_KEY);
  if (!existsSync(KEY_FILE)) throw new Error("No wallet yet. Run: council init");
  const arr = JSON.parse(readFileSync(KEY_FILE, "utf8"));
  if (!Array.isArray(arr) || arr.length !== 64) throw new Error(`${KEY_FILE} is not a 64-byte Solana keypair`);
  return createKeyPairSignerFromBytes(new Uint8Array(arr));
}

export function hasWallet() {
  return Boolean(process.env.COUNCIL_WALLET_KEY) || existsSync(KEY_FILE);
}

/** Accepts a Solana CLI JSON array or a base58 64-byte secret. */
async function fromSecret(secret: string): Promise<KeyPairSigner> {
  const s = secret.trim();
  if (s.startsWith("[")) return createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(s)));
  const { getBase58Encoder } = await import("@solana/kit");
  const bytes = getBase58Encoder().encode(s);
  if (bytes.length !== 64) throw new Error("COUNCIL_WALLET_KEY must be a 64-byte secret key");
  return createKeyPairSignerFromBytes(new Uint8Array(bytes));
}
