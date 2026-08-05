# ArgonautWorks Bounty Signal API

A pay-per-request x402 API that checks a canonical public GitHub issue before an autonomous agent spends time on a purported bounty.

The checker verifies current issue and repository state, payout-rail evidence, age, assignments, claim language, competing pull requests, repository trust, and suspicious/offline payment terms. It returns `viable`, `caution`, or `reject` with an auditable score and evidence.

## API

```text
GET /api/v1/check?url=https://github.com/{owner}/{repo}/issues/{number}

POST /api/v1/check
{"url":"https://github.com/{owner}/{repo}/issues/{number}"}

GET /api/v1/report?edition=2026-08-04

POST /api/v1/report
{"edition":"2026-08-04"}
```

The bounty checker costs `$0.01` USDC on Base through x402. The direct Markdown report costs `$1.99`; its distinct amount lets the on-chain monitor attribute settled report downloads without colliding with the `$2` PayanAgent edition. Requests without a payment signature receive HTTP `402` and machine-readable payment instructions. `/`, `/health`, `/openapi.json`, both A2A agent-card aliases, `/a2a`, `/.well-known/x402`, and `/llms.txt` are free.

The A2A agent card at `/.well-known/agent-card.json` advertises Bounty Signal, Schedule Fit, and the Agent Bounty Reality Check. Its legacy `/.well-known/agent.json` alias serves the same card, and `POST /a2a` implements the JSON-RPC `message/send` discovery flow without charging the caller.

Production: <https://argonaut-bounty-signal.vercel.app>

Browsers receive an indexed HTML landing page with an explicitly static sample verdict, while JSON and agent clients retain the machine-readable root response through content negotiation. `/robots.txt`, `/sitemap.xml`, and the root-hosted IndexNow key support accountless search discovery without changing or weakening the paid route. `/api/v1/sample` demonstrates the response contract but never presents itself as a current issue check.

The POST form is listed on PayanAgent at <https://payanagent.com/x402/kh71sbt41467k8dfjp3t204chx8bvf71>. PayanAgent relays the service's original x402 challenge, so the buyer makes one direct payment to the ArgonautWorks receiving wallet rather than paying two gates.

Install the buyer workflow in supported coding agents:

```bash
npx skills add ArgonautWorks/bounty-signal-api --skill bounty-signal
```

For a broader dated market screen, the [$2 Agent Bounty Reality Check](https://payanagent.com/x402/kh77jyatx8rsxpmcat6s3a3yf18btx0q) covers 1,291 records across twelve sources, five verified high-value false leads, marketplace delivery evidence, and a reusable triage policy.

## Local validation

```bash
npm install
npm test
npm run check
npm start
curl -i 'http://127.0.0.1:8791/api/v1/check?url=https://github.com/electron/electron/issues/48191'
```

The last command should return `402 Payment Required`; the GitHub checks run only after settlement succeeds.

## Configuration

- `PAY_TO`: receiving EVM address
- `X402_NETWORK`: defaults to Base mainnet (`eip155:8453`)
- `X402_FACILITATOR_URL`: defaults to the PayAI facilitator
- `X402_PRICE`: defaults to `$0.01`
- `REPORT_CONTENT_B64`: base64-encoded pinned Markdown report; production startup verifies its SHA-256 before serving

No receiving-wallet private key is required by the service.

## Autonomous discovery seed

PayAI catalogs Bazaar declarations during verification or settlement. `scripts/seed-bazaar.mjs` waits until the existing receiving wallet contains at least one cent of USDC, validates that the live challenge is a Base-USDC self-payment capped at one cent, then performs that self-payment to seed discovery with zero net principal spend. The systemd timer retries every 30 minutes and stops acting after a successful seed.

`scripts/monitor-revenue.mjs` independently scans confirmed Base USDC events. Direct x402 sales require an external `transferWithAuthorization` matching an exact product price. Atelier sales require an exact $0.45 or $0.50 ordinary transfer from the verified marketplace treasury. AgentPact sales require the exact $0.45 seller leg emitted by its verified escrow contract's `acceptMilestone` call. Self-seeds, unrelated transfers, other amounts, and duplicate transactions are excluded. Its state file is mode `0600`.

## Atelier marketplace seller

The same evaluator is packaged as the fixed-price **GitHub Bounty Reality Check** on Atelier. A required structured field collects one canonical public GitHub issue URL. The VPS worker polls only actionable paid orders, creates a 30-day EIP-191-signed report link, verifies it, delivers it, and messages the buyer without operator input. The public report route accepts only links signed by the payout wallet, so it does not expose a free bypass around the x402 API.

The same Atelier agent also lists a bounded **Everyday Product Concept Image** service for `$0.10`. Its [separate public worker](https://github.com/ArgonautWorks/atelier-image-worker) routes only the exact image-service ID, screens prompts to everyday non-regulated objects, generates a metadata-free 768x768 PNG locally, verifies the uploaded CDN bytes by SHA-256, and delivers without a browser session. This report worker now fails closed on every other service ID. The revenue monitor attributes image income only to an exact `$0.09` ordinary transfer from Atelier's verified treasury.

Atelier credentials and its Solana ownership identity live only in mode-`0600` state outside this repository. Marketplace proceeds are routed to the same Base wallet as direct x402 sales. The revenue monitor recognizes only exact $0.45 or $0.50 USDC payouts sent by Atelier's verified Base treasury, accounting for the UI and x402 fee paths without trusting marketplace status alone.

## AgentPact marketplace seller

The same fixed-scope report is also listed on AgentPact for `$0.50` USDC. Registration, listing, polling, acceptance, and delivery are entirely machine-operated. The worker accepts only the exact ArgonautWorks offer, exact price, one report-link milestone, a canonical public GitHub issue URL, and non-security scope. It never buys services or sends funds.

AgentPact database status is not enough to trigger delivery. Before creating a signed report link, the worker independently retrieves the Base transaction receipt and requires a successful native-USDC transfer of at least `$0.50` into AgentPact's verified escrow contract. Credentials and delivery memory are private mode-`0600` state outside the repository. The revenue monitor records only the later exact `$0.45` escrow release to the ArgonautWorks wallet.
