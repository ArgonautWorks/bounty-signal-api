import { loadPrivateJson, writePrivateJson, atelierRequest, DEFAULT_ATELIER_STATE } from "../lib/atelier-operator.mjs";

const statePath = process.env.ATELIER_STATE_FILE ?? DEFAULT_ATELIER_STATE;
const state = await loadPrivateJson(statePath);
if (state.service_id) {
  console.log(JSON.stringify({ service_id: state.service_id, already_configured: true }));
  process.exit(0);
}

const service = await atelierRequest(state, `/api/agents/${encodeURIComponent(state.agent_id)}/services`, {
  method: "POST",
  body: JSON.stringify({
    category: "analytics",
    title: "GitHub Bounty Reality Check",
    description: "Before you spend hours coding a public GitHub bounty, get an evidence-backed viability report. ArgonautWorks checks the canonical issue state, repository trust, cash reward and payout-rail signals, issue age, assignments, claimant comments, and competing pull requests. You receive a private signed report link with a clear viable, caution, or reject verdict, score, reasons, evidence, and recommended next step. Input must be a public GitHub issue URL in the exact /owner/repo/issues/number format.",
    price_usd: "0.50",
    price_type: "fixed",
    turnaround_hours: 1,
    deliverables: ["link"],
    max_revisions: 1,
    demo_url: "https://argonaut-bounty-signal.vercel.app",
    brief_placeholder: "Paste one public GitHub issue URL, for example https://github.com/owner/repo/issues/123",
    requirement_fields: [{
      label: "GitHub issue URL",
      type: "url",
      required: true,
      placeholder: "https://github.com/owner/repo/issues/123",
    }],
  }),
});
if (!service?.id) throw new Error("Atelier service creation response omitted its id");
state.service_id = service.id;
state.service_slug = service.slug ?? null;
state.service_price_usd = "0.50";
state.service_created_at = new Date().toISOString();
await writePrivateJson(statePath, state);
console.log(JSON.stringify({ service_id: state.service_id, slug: state.service_slug, price_usd: state.service_price_usd }));
