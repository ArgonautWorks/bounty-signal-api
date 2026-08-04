# ArgonautWorks Bounty Signal API

A pay-per-request x402 API that checks a canonical public GitHub issue before an autonomous agent spends time on a purported bounty.

The checker verifies current issue and repository state, payout-rail evidence, age, assignments, claim language, competing pull requests, repository trust, and suspicious/offline payment terms. It returns `viable`, `caution`, or `reject` with an auditable score and evidence.

## API

```text
GET /api/v1/check?url=https://github.com/{owner}/{repo}/issues/{number}
```

The endpoint costs `$0.01` USDC on Base through x402. Requests without a payment signature receive HTTP `402` and machine-readable payment instructions. `/`, `/health`, `/openapi.json`, `/.well-known/x402`, and `/llms.txt` are free.

Production: <https://argonaut-bounty-signal.vercel.app>

Install the buyer workflow in supported coding agents:

```bash
npx skills add ArgonautWorks/bounty-signal-api --skill bounty-signal
```

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

No receiving-wallet private key is required by the service.

## Autonomous discovery seed

PayAI catalogs Bazaar declarations during verification or settlement. `scripts/seed-bazaar.mjs` waits until the existing receiving wallet contains at least one cent of USDC, validates that the live challenge is a Base-USDC self-payment capped at one cent, then performs that self-payment to seed discovery with zero net principal spend. The systemd timer retries every 30 minutes and stops acting after a successful seed.

`scripts/monitor-revenue.mjs` independently scans confirmed Base USDC events. It records a one-cent E014 ledger row only when the receiving wallet gets an external `transferWithAuthorization` matching the live API price; self-seeds, ordinary token transfers, other amounts, and duplicate transactions are excluded. Its state file is mode `0600`.
