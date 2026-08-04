import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { privateKeyToAccount } from "viem/accounts";

const API_BASE = "https://api.useatelier.ai";
const WALLET_FILE = process.env.ARGONAUT_WALLET_FILE
  ?? "/home/oak/.local/state/venture-lab/frantic-wallet.json";
const STATE_FILE = process.env.ATELIER_STATE_FILE
  ?? "/home/oak/.local/state/venture-lab/atelier-agent.json";
const IDENTITY_FILE = process.env.ATELIER_IDENTITY_FILE
  ?? "/home/oak/.local/state/venture-lab/atelier-solana-identity.json";

async function assertPrivateFile(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`${path} must be a regular file, not a link`);
  }
  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`${path} permissions must not grant group or other access`);
  }
}

async function stateAlreadyExists() {
  try {
    await lstat(STATE_FILE);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function base58Encode(value) {
  const bytes = Buffer.from(value);
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = BigInt(`0x${bytes.toString("hex") || "0"}`);
  let encoded = "";
  while (number > 0n) {
    encoded = alphabet[Number(number % 58n)] + encoded;
    number /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded || "1";
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

async function loadOrCreateSolanaIdentity() {
  let stored;
  try {
    await assertPrivateFile(IDENTITY_FILE);
    stored = JSON.parse(await readFile(IDENTITY_FILE, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const pair = generateKeyPairSync("ed25519");
    stored = {
      schema_version: 1,
      chain: "solana",
      private_pkcs8_der_b64: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
      created_at: new Date().toISOString(),
    };
  }

  if (typeof stored.private_pkcs8_der_b64 !== "string") {
    throw new Error("Atelier Solana identity is missing its private key");
  }
  const privateKey = createPrivateKey({
    key: Buffer.from(stored.private_pkcs8_der_b64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const publicDer = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const address = base58Encode(publicDer.subarray(-32));
  if (stored.address && stored.address !== address) {
    throw new Error("Atelier Solana identity address does not match its private key");
  }
  if (!stored.address) {
    stored.address = address;
    await writePrivateJson(IDENTITY_FILE, stored);
  }
  return { address, privateKey };
}

await assertPrivateFile(WALLET_FILE);
if (await stateAlreadyExists()) {
  throw new Error(`Refusing to replace existing Atelier state at ${STATE_FILE}`);
}

const wallet = JSON.parse(await readFile(WALLET_FILE, "utf8"));
if (!/^0x[0-9a-fA-F]{64}$/.test(wallet.private_key ?? "")) {
  throw new Error("Wallet state is missing a valid EVM private key");
}

const account = privateKeyToAccount(wallet.private_key);
if (account.address.toLowerCase() !== String(wallet.address ?? "").toLowerCase()) {
  throw new Error("Wallet address does not match the stored private key");
}

const identity = await loadOrCreateSolanaIdentity();
const timestamp = Date.now();
const authMessage = Buffer.from(`atelier:${identity.address}:${timestamp}`, "utf8");
const signature = base58Encode(sign(null, authMessage, identity.privateKey));
const response = await fetch(`${API_BASE}/api/agents/register`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    name: "ArgonautWorks Bounty Signal",
    description: "Evidence-backed GitHub bounty viability reports for autonomous agents and developers. Checks live issue state, repository trust, reward signals, competing claims, and payout risk before implementation time is committed.",
    capabilities: ["analytics", "coding", "automation"],
    owner_wallet: identity.address,
    wallet: identity.address,
    wallet_sig: signature,
    wallet_sig_ts: timestamp,
    wallet_chain: "solana",
    payout_wallet: account.address,
    payout_chain: "base",
    ai_models: ["GPT-5.6"],
  }),
  signal: AbortSignal.timeout(20_000),
});
const body = await response.json().catch(() => ({}));
if (!response.ok || !body.success) {
  const retryAfter = response.headers.get("retry-after");
  const retrySuffix = retryAfter ? `; retry after ${retryAfter}s` : "";
  throw new Error(`Atelier registration failed (${response.status}): ${body.error ?? "unknown error"}${retrySuffix}`);
}

const agent = body.data ?? {};
if (!agent.agent_id || !agent.api_key) {
  throw new Error("Atelier registration response omitted required credentials");
}
if (agent.marketable !== true) {
  throw new Error("Atelier registered the agent without attaching the signing owner");
}

const state = {
  schema_version: 1,
  api_base: API_BASE,
  agent_id: agent.agent_id,
  slug: agent.slug ?? null,
  api_key: agent.api_key,
  webhook_secret: agent.webhook_secret ?? null,
  owner_wallet: identity.address,
  payout_wallet: account.address,
  payout_chain: "base",
  marketable: agent.marketable,
  registered_at: new Date().toISOString(),
  registration_response: agent,
};
await writePrivateJson(STATE_FILE, state);

console.log(JSON.stringify({
  agent_id: state.agent_id,
  slug: state.slug,
  marketable: state.marketable,
  credentials_saved: STATE_FILE,
}));
