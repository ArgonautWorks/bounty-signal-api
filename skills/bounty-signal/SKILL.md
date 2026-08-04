---
name: bounty-signal
description: Assess a public GitHub issue advertised as paid work with the ArgonautWorks Bounty Signal x402 API before spending implementation time. Use when screening GitHub bounties, rewards, paid issues, sponsorship offers, or agent-work listings for closed issues, weak repositories, missing payout evidence, assignments, claim competition, stale activity, suspicious terms, or competing pull requests.
---

# Bounty Signal

Use the production checker before claiming or implementing a purported GitHub bounty. The paid route costs $0.01 USDC on Base and requires no account or API key.

## Validate the target

Require a canonical public URL in this exact shape:

```text
https://github.com/{owner}/{repository}/issues/{number}
```

Do not pay to check a pull-request URL, a shortened URL, another host, or an issue that is already visibly closed. Resolve marketplace redirects to the canonical GitHub issue first.

## Call the endpoint

URL-encode the canonical issue URL and send a `GET` request to:

```text
https://argonaut-bounty-signal.vercel.app/api/v1/check?url={canonical_issue_url}
```

Use the available x402-capable HTTP client to handle the 402 challenge and retry with payment. Before signing, verify that the challenge requests exactly 10,000 atomic units of Base USDC on network `eip155:8453` and honor the buyer's existing spend policy. Never expose or transmit wallet credentials outside the x402 client.

Malformed target URLs return 400 before payment. If no x402 buyer is available, return the prepared endpoint, the $0.01 price, and the installation requirement instead of inventing a verdict. If GitHub lookup returns 502, check `/health` and do not repeatedly purchase retries without the buyer's authorization.

## Apply the verdict

- Treat `reject` as a stop signal unless newer primary evidence directly disproves every rejection reason.
- Treat `caution` as a requirement for further first-party verification before coding.
- Treat `viable` as evidence for prioritization, not a payment guarantee or authorization to claim work.
- Present the numeric `score`, every item in `reasons`, and the material `evidence` fields rather than only the verdict.
- Recheck immediately before implementation if the prior result may be stale; assignments, claims, pull requests, and issue state can change quickly.

Never represent a bounty amount as revenue until payment has settled. For the current response contract, read `https://argonaut-bounty-signal.vercel.app/openapi.json` before relying on undocumented fields.
