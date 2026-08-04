export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const TRANSFER_WITH_AUTHORIZATION_SELECTOR = "0xe3ee160e";
export const TRANSFER_SELECTOR = "0xa9059cbb";
export const ATELIER_TREASURY = "0xa8cc4011eb545ee5d436a599c9a8bd03dd1e1df3";
export const CHECK_PRICE_ATOMIC = 10_000n;
export const DIRECT_REPORT_PRICE_ATOMIC = 1_990_000n;
export const ATELIER_REPORT_PAYOUT_ATOMIC = 450_000n;
export const ATELIER_X402_REPORT_PAYOUT_ATOMIC = 500_000n;

function topicAddress(topic) {
  const value = String(topic ?? "").toLowerCase();
  return value.length === 66 ? `0x${value.slice(-40)}` : null;
}

export function classifyBountySignalTransfer(log, transaction, receivingWallet) {
  const wallet = String(receivingWallet).toLowerCase();
  if (String(log?.address).toLowerCase() !== BASE_USDC.toLowerCase()) return null;
  if (String(log?.topics?.[0]).toLowerCase() !== TRANSFER_TOPIC) return null;
  const from = topicAddress(log?.topics?.[1]);
  const to = topicAddress(log?.topics?.[2]);
  if (!from || !to || to !== wallet || from === wallet) return null;
  let amount;
  try {
    amount = BigInt(log.data);
  } catch {
    return null;
  }
  const sale = amount === CHECK_PRICE_ATOMIC
    ? { experiment_id: "E014", kind: "api_revenue", revenue_usd: 0.01, product: "bounty_check" }
    : amount === DIRECT_REPORT_PRICE_ATOMIC
      ? { experiment_id: "E022", kind: "download_revenue", revenue_usd: 1.99, product: "direct_report" }
      : [ATELIER_REPORT_PAYOUT_ATOMIC, ATELIER_X402_REPORT_PAYOUT_ATOMIC].includes(amount) && from === ATELIER_TREASURY
        ? { experiment_id: "E038", kind: "marketplace_revenue", revenue_usd: Number(amount) / 1_000_000, product: "atelier_bounty_report" }
      : null;
  if (!sale) return null;
  if (String(transaction?.to).toLowerCase() !== BASE_USDC.toLowerCase()) return null;
  const expectedSelector = sale.product === "atelier_bounty_report"
    ? TRANSFER_SELECTOR
    : TRANSFER_WITH_AUTHORIZATION_SELECTOR;
  if (!String(transaction?.input ?? "").toLowerCase().startsWith(expectedSelector)) {
    return null;
  }

  return {
    ...sale,
    transaction: String(log.transactionHash),
    payer: from,
    amount_usdc_atomic: amount.toString(),
    block_number: Number.parseInt(log.blockNumber, 16),
  };
}

export function ledgerDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function revenueLedgerRow(receipt, date = new Date()) {
  const note = receipt.product === "direct_report"
    ? `Settled external x402 Agent Bounty Reality Check download; Base transaction ${receipt.transaction}; payer ${receipt.payer}`
    : receipt.product === "atelier_bounty_report"
      ? `Settled Atelier GitHub Bounty Reality Check payout after platform fee; Base transaction ${receipt.transaction}; treasury ${receipt.payer}`
      : `Settled external x402 bounty check; Base transaction ${receipt.transaction}; payer ${receipt.payer}`;
  const revenue = Number(receipt.revenue_usd).toFixed(2);
  return [ledgerDate(date), receipt.experiment_id, receipt.kind, "0.00", revenue, revenue, note]
    .map(csvCell)
    .join(",");
}
