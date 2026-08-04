import { createHash } from "node:crypto";

export const REPORT_EDITION = "2026-08-04";
export const DIRECT_REPORT_PRICE = "$1.99";
export const DIRECT_REPORT_PRICE_ATOMIC = 1_990_000n;
export const REPORT_SHA256 = "8d9ab18e52f4594ce205c4dd5edf6fd1bb6c881c950a28b4bef1b2047c885cb5";

export function loadReportContent(encoded, expectedSha256 = REPORT_SHA256) {
  const value = String(encoded ?? "").trim();
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("REPORT_CONTENT_B64 must be canonical base64");
  }
  const bytes = Buffer.from(value, "base64");
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedSha256) throw new Error("REPORT_CONTENT_B64 failed the pinned SHA-256 check");
  const content = bytes.toString("utf8");
  if (!content.startsWith("# Agent Bounty Reality Check")) {
    throw new Error("REPORT_CONTENT_B64 is not the expected Markdown report");
  }
  return content;
}
