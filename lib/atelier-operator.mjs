import { lstat, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { parseGitHubIssueUrl } from "./evaluate-github-bounty.mjs";

export const DEFAULT_ATELIER_STATE = "/home/oak/.local/state/venture-lab/atelier-agent.json";
export const DEFAULT_WALLET_STATE = "/home/oak/.local/state/venture-lab/frantic-wallet.json";

async function assertPrivateFile(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new Error(`${path} must be a private regular file`);
  }
}

export async function loadPrivateJson(path) {
  await assertPrivateFile(path);
  return JSON.parse(await readFile(path, "utf8"));
}

export async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}

export async function atelierRequest(state, path, options = {}) {
  const response = await fetch(`${state.api_base}${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${state.api_key}`,
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
    signal: options.signal ?? AbortSignal.timeout(20_000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.success) {
    const error = new Error(`Atelier API ${response.status}: ${body.error ?? "unknown error"}`);
    error.status = response.status;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }
  return body.data;
}

function stringsIn(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsIn(item, output));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => stringsIn(item, output));
  return output;
}

export function extractGitHubIssueUrl(order) {
  const candidates = stringsIn({
    requirements: order.requirements,
    requirement_values: order.requirement_values,
    brief: order.brief,
  });
  for (const candidate of candidates) {
    const urls = candidate.match(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/\d+(?:[^\s"'<>]*)?/g) ?? [];
    for (const url of urls) {
      try {
        return parseGitHubIssueUrl(url).canonicalUrl;
      } catch {
        // Keep scanning the structured brief for the next URL.
      }
    }
  }
  return null;
}

export function orderMatchesService(order, serviceId) {
  return typeof serviceId === "string"
    && serviceId.length > 0
    && order?.service_id === serviceId;
}
