import assert from "node:assert/strict";
import test from "node:test";
import { evaluateGitHubBounty, parseGitHubIssueUrl } from "../lib/evaluate-github-bounty.mjs";

const NOW = new Date("2026-08-04T12:00:00.000Z");

function response(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() { return value; },
  };
}

function fixtureFetch({ issue, repository, comments = [], pulls = 0 }) {
  return async (url) => {
    if (url.includes("/search/issues")) return response({ total_count: pulls, items: [] });
    if (url.includes("/comments")) return response(comments);
    if (/\/issues\/\d+$/.test(url)) return response(issue);
    if (/\/repos\/[^/]+\/[^/?]+$/.test(url)) return response(repository);
    throw new Error(`Unexpected URL ${url}`);
  };
}

test("parseGitHubIssueUrl canonicalizes a public issue URL", () => {
  assert.deepEqual(parseGitHubIssueUrl("https://github.com/acme/widget/issues/42?tab=activity"), {
    owner: "acme",
    repo: "widget",
    issueNumber: 42,
    canonicalUrl: "https://github.com/acme/widget/issues/42",
  });
});

test("parseGitHubIssueUrl rejects non-issue and non-GitHub URLs", () => {
  assert.throws(() => parseGitHubIssueUrl("https://example.com/acme/widget/issues/42"), /github\.com/);
  assert.throws(() => parseGitHubIssueUrl("https://github.com/acme/widget/pull/42"), /must match/);
});

test("rejects a closed crowded marketplace listing even when the repository is trusted", async () => {
  const result = await evaluateGitHubBounty("https://github.com/electron/electron/issues/48191", {
    now: NOW,
    fetchImpl: fixtureFetch({
      issue: {
        state: "closed",
        title: "[$100] Fix dialog filter",
        body: "Funded on https://opire.dev/bounties/abc",
        updated_at: "2026-06-15T17:20:40Z",
        labels: [{ name: "bounty" }],
        assignees: [{ login: "maintainer" }],
      },
      repository: {
        archived: false,
        disabled: false,
        stargazers_count: 120000,
        pushed_at: "2026-08-04T09:00:00Z",
        owner: { type: "Organization" },
      },
      pulls: 12,
    }),
  });

  assert.equal(result.verdict, "reject");
  assert.ok(result.reasons.includes("canonical_issue_closed"));
  assert.ok(result.reasons.includes("existing_competition"));
  assert.equal(result.evidence.competing_pull_requests, 12);
});

test("rejects joke and offline payout terms", async () => {
  const result = await evaluateGitHubBounty("https://github.com/acme/widget/issues/4", {
    now: NOW,
    fetchImpl: fixtureFetch({
      issue: {
        state: "open",
        title: "[BOUNTY][$640] Port it",
        body: "640 Bohemian Dollars will be handed over in a parking lot. I reserve the right to refuse payout.",
        updated_at: "2026-08-03T18:41:06Z",
        labels: [{ name: "bounty" }],
        assignees: [],
      },
      repository: {
        archived: false,
        disabled: false,
        stargazers_count: 0,
        pushed_at: "2026-08-03T12:00:00Z",
        owner: { type: "User" },
      },
    }),
  });

  assert.equal(result.verdict, "reject");
  assert.ok(result.reasons.includes("suspicious_or_offline_payment_terms"));
  assert.ok(result.reasons.includes("verifiable_online_payout_rail_not_found"));
});

test("marks a recent, funded, uncontested issue in an established org as viable", async () => {
  const result = await evaluateGitHubBounty("https://github.com/acme/widget/issues/19", {
    now: NOW,
    fetchImpl: fixtureFetch({
      issue: {
        state: "open",
        title: "[$250] Add CSV export",
        body: "The $250 reward is escrowed in USDC on https://opire.dev/bounties/19.",
        updated_at: "2026-08-03T10:00:00Z",
        labels: [{ name: "bounty" }],
        assignees: [],
      },
      repository: {
        archived: false,
        disabled: false,
        stargazers_count: 5200,
        pushed_at: "2026-08-04T10:00:00Z",
        owner: { type: "Organization" },
      },
    }),
  });

  assert.equal(result.verdict, "viable");
  assert.equal(result.reward_usd, 250);
  assert.equal(result.reasons.length, 0);
});
