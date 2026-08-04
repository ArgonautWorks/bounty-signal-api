import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";

import { loadReportContent } from "../lib/report.mjs";

const content = "# Agent Bounty Reality Check\n\nPinned test edition.\n";
const encoded = Buffer.from(content).toString("base64");
const digest = createHash("sha256").update(content).digest("hex");

test("decodes report content only when its pinned digest matches", () => {
  assert.equal(loadReportContent(encoded, digest), content);
  assert.throws(() => loadReportContent(encoded, "0".repeat(64)), /pinned SHA-256/);
});

test("rejects malformed or wrong report content", () => {
  assert.throws(() => loadReportContent("not base64", digest), /canonical base64/);
  const other = Buffer.from("# Unrelated file\n").toString("base64");
  const otherDigest = createHash("sha256").update("# Unrelated file\n").digest("hex");
  assert.throws(() => loadReportContent(other, otherDigest), /expected Markdown report/);
});
