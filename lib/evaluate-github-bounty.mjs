const KNOWN_PAYOUT_RAILS = [
  /algora\.io/i,
  /bountyhub\.dev/i,
  /opire\.dev/i,
  /frantic\.ai/i,
  /polar\.sh/i,
  /usdc/i,
  /escrow/i,
];

const SUSPICIOUS_TERMS = [
  /bohemian dollars?/i,
  /parking lot/i,
  /accounts? (?:has|have) been frozen/i,
  /personal feeling/i,
  /reserve the right to refuse payout/i,
  /branding .{0,30} every file/i,
  /payment (?:will be )?handed/i,
];

const CLAIM_LANGUAGE = [
  /\b(?:i(?:'m| am)|we(?:'re| are)) (?:working|implementing|taking|claiming)/i,
  /\b(?:claim|claimed|assigned to me)\b/i,
  /\bi can (?:take|implement|fix|work on)\b/i,
];

const CASH_AMOUNT = /(?:\$\s*([0-9][0-9,]*(?:\.\d{1,2})?)|\b([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:usd|usdc)\b)/i;

function daysSince(value, now) {
  const timestamp = Date.parse(value ?? "");
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 86_400_000));
}

function parseCashAmount(text) {
  const match = String(text ?? "").match(CASH_AMOUNT);
  if (!match) return null;
  const value = Number.parseFloat((match[1] ?? match[2]).replaceAll(",", ""));
  return Number.isFinite(value) ? value : null;
}

export function parseGitHubIssueUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl ?? ""));
  } catch {
    throw new Error("url must be a valid GitHub issue URL");
  }

  if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") {
    throw new Error("url must use https://github.com");
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length !== 4 || parts[2] !== "issues" || !/^\d+$/.test(parts[3])) {
    throw new Error("url must match https://github.com/{owner}/{repo}/issues/{number}");
  }

  return {
    owner: parts[0],
    repo: parts[1],
    issueNumber: Number.parseInt(parts[3], 10),
    canonicalUrl: `https://github.com/${parts[0]}/${parts[1]}/issues/${parts[3]}`,
  };
}

async function githubJson(fetchImpl, path) {
  const response = await fetchImpl(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "ArgonautWorks-Bounty-Signal/0.1",
      "x-github-api-version": "2022-11-28",
    },
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    const remaining = response.headers?.get?.("x-ratelimit-remaining");
    const suffix = remaining === "0" ? " (GitHub rate limit exhausted; retry later)" : "";
    throw new Error(`GitHub returned ${response.status}${suffix}`);
  }

  return response.json();
}

export async function evaluateGitHubBounty(rawUrl, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const target = parseGitHubIssueUrl(rawUrl);
  const encodedRepo = `${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  const issuePath = `/repos/${encodedRepo}/issues/${target.issueNumber}`;
  const repoPath = `/repos/${encodedRepo}`;
  const commentsPath = `${issuePath}/comments?per_page=100`;
  const exactIssueUrl = encodeURIComponent(target.canonicalUrl);
  const searchPath = `/search/issues?q=${exactIssueUrl}+repo%3A${encodeURIComponent(`${target.owner}/${target.repo}`)}+is%3Apr+in%3Abody&per_page=20`;

  const [issue, repository, commentsResult, pullSearchResult] = await Promise.allSettled([
    githubJson(fetchImpl, issuePath),
    githubJson(fetchImpl, repoPath),
    githubJson(fetchImpl, commentsPath),
    githubJson(fetchImpl, searchPath),
  ]);

  if (issue.status === "rejected") throw issue.reason;
  if (repository.status === "rejected") throw repository.reason;

  const issueData = issue.value;
  const repoData = repository.value;
  const comments = commentsResult.status === "fulfilled" && Array.isArray(commentsResult.value)
    ? commentsResult.value
    : [];
  const competingPulls = pullSearchResult.status === "fulfilled"
    ? Number(pullSearchResult.value.total_count ?? 0)
    : null;
  const corpus = [issueData.title, issueData.body, ...comments.map((comment) => comment.body)]
    .filter(Boolean)
    .join("\n");
  const rewardUsd = parseCashAmount(`${issueData.title ?? ""}\n${issueData.body ?? ""}`);
  const payoutRails = KNOWN_PAYOUT_RAILS.filter((pattern) => pattern.test(corpus)).map((pattern) => pattern.source);
  const suspiciousTerms = SUSPICIOUS_TERMS.filter((pattern) => pattern.test(corpus)).map((pattern) => pattern.source);
  const claimantLogins = new Set();

  for (const comment of comments) {
    const body = String(comment.body ?? "");
    if (CLAIM_LANGUAGE.some((pattern) => pattern.test(body)) && comment.user?.login) {
      claimantLogins.add(comment.user.login);
    }
  }

  const ageDays = daysSince(issueData.updated_at, now);
  const pushedAgeDays = daysSince(repoData.pushed_at, now);
  const labels = Array.isArray(issueData.labels)
    ? issueData.labels.map((label) => typeof label === "string" ? label : label.name).filter(Boolean)
    : [];
  const assigneeCount = Array.isArray(issueData.assignees) ? issueData.assignees.length : 0;
  const claimSignals = Math.max(claimantLogins.size, assigneeCount, competingPulls ?? 0);
  let score = 50;
  const reasons = [];

  if (issueData.state !== "open") {
    score -= 60;
    reasons.push("canonical_issue_closed");
  }
  if (repoData.archived || repoData.disabled) {
    score -= 60;
    reasons.push(repoData.archived ? "repository_archived" : "repository_disabled");
  }
  if (repoData.owner?.type === "Organization") score += 5;
  if ((repoData.stargazers_count ?? 0) >= 1_000) score += 10;
  else if ((repoData.stargazers_count ?? 0) >= 50) score += 5;
  else if ((repoData.stargazers_count ?? 0) < 5) {
    score -= 20;
    reasons.push("low_trust_repository");
  }
  if (labels.some((label) => /bounty|reward|paid/i.test(label))) score += 5;
  if (rewardUsd !== null && rewardUsd >= 10 && rewardUsd <= 10_000) score += 8;
  else if (rewardUsd === null) {
    score -= 12;
    reasons.push("cash_reward_not_found");
  } else if (rewardUsd > 10_000) {
    score -= 20;
    reasons.push("implausible_reward_requires_verification");
  }
  if (payoutRails.length > 0) score += 18;
  else {
    score -= 20;
    reasons.push("verifiable_online_payout_rail_not_found");
  }
  if (suspiciousTerms.length > 0) {
    score -= 70;
    reasons.push("suspicious_or_offline_payment_terms");
  }
  if (ageDays !== null && ageDays > 180) {
    score -= 30;
    reasons.push("stale_issue");
  } else if (ageDays !== null && ageDays > 60) {
    score -= 15;
    reasons.push("aging_issue");
  }
  if (pushedAgeDays !== null && pushedAgeDays > 365) {
    score -= 15;
    reasons.push("inactive_repository");
  }
  if (claimSignals > 0) {
    score -= Math.min(35, claimSignals * 8);
    reasons.push("existing_competition");
  }

  score = Math.max(0, Math.min(100, score));
  const verdict = score >= 70 ? "viable" : score >= 40 ? "caution" : "reject";

  return {
    schema_version: 1,
    checked_at: now.toISOString(),
    target,
    verdict,
    score,
    reward_usd: rewardUsd,
    reasons: [...new Set(reasons)],
    evidence: {
      canonical_issue_state: issueData.state,
      repository_archived: Boolean(repoData.archived),
      repository_disabled: Boolean(repoData.disabled),
      repository_owner_type: repoData.owner?.type ?? null,
      repository_stars: repoData.stargazers_count ?? null,
      issue_updated_days_ago: ageDays,
      repository_pushed_days_ago: pushedAgeDays,
      labels,
      assignees: assigneeCount,
      claimant_accounts: claimantLogins.size,
      competing_pull_requests: competingPulls,
      payout_rail_signals: payoutRails,
      suspicious_term_signals: suspiciousTerms,
      partial_checks: {
        comments: commentsResult.status !== "fulfilled",
        pull_request_search: pullSearchResult.status !== "fulfilled",
      },
    },
    recommendation: verdict === "viable"
      ? "Verify sponsor ownership and exact payout/claim rules, then estimate implementation cost."
      : verdict === "caution"
        ? "Resolve the listed risks before claiming or coding."
        : "Do not spend implementation time unless the canonical funding facts materially change.",
  };
}
