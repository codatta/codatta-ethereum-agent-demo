/**
 * Address risk scoring — sync MCP service.
 *
 * Sibling of `annotate`: one tools/call blocks and returns a decision-grade
 * result. Unlike a pure profile lookup, the output is a scored judgment the
 * client can act on (allow / warn / block).
 *
 * MVP: static lookup against a demo blacklist and a static proximity map.
 * A production implementation would derive both from live on-chain data
 * (eth_getLogs over ERC-20 Transfer events, plus third-party risk feeds).
 */

type RiskLabel = "sanctioned" | "known-scam" | "proximity-to-risky";

interface BlacklistEntry {
  label: Exclude<RiskLabel, "proximity-to-risky">;
  reason: string;
}

// Demo-only entries. Obviously-fake addresses so nothing is mistaken for
// actual OFAC / chain-analysis data.
const BLACKLIST = new Map<string, BlacklistEntry>([
  ["0x1111111111111111111111111111111111111111", { label: "sanctioned", reason: "Demo sanctions list entry #1" }],
  ["0x2222222222222222222222222222222222222222", { label: "sanctioned", reason: "Demo sanctions list entry #2" }],
  ["0x3333333333333333333333333333333333333333", { label: "known-scam", reason: "Demo phishing drainer" }],
  ["0x4444444444444444444444444444444444444444", { label: "known-scam", reason: "Demo mixer entry point" }],
  ["0x5555555555555555555555555555555555555555", { label: "known-scam", reason: "Demo rugpull operator" }],
]);

// Static proximity graph: address → risky counterparties it has transacted
// with. Stand-in for a real tx-history scan.
const PROXIMITY_MAP = new Map<string, string[]>([
  ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ["0x3333333333333333333333333333333333333333"]],
  ["0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", [
    "0x1111111111111111111111111111111111111111",
    "0x5555555555555555555555555555555555555555",
  ]],
]);

const SCORE_BY_LABEL: Record<RiskLabel, number> = {
  "sanctioned": 95,
  "known-scam": 85,
  "proximity-to-risky": 55,
};

export interface RiskScoreResult {
  address: string;
  riskScore: number;
  labels: RiskLabel[];
  reasoning: string;
  checkedAt: string;
}

export function scoreAddress(address: string): RiskScoreResult {
  const normalized = address.toLowerCase();
  const checkedAt = new Date().toISOString();

  const direct = BLACKLIST.get(normalized);
  if (direct) {
    return {
      address: normalized,
      riskScore: SCORE_BY_LABEL[direct.label],
      labels: [direct.label],
      reasoning: `Address directly listed as ${direct.label}: ${direct.reason}`,
      checkedAt,
    };
  }

  const contacts = PROXIMITY_MAP.get(normalized) ?? [];
  const riskyContacts = contacts.filter(c => BLACKLIST.has(c));
  if (riskyContacts.length > 0) {
    return {
      address: normalized,
      riskScore: SCORE_BY_LABEL["proximity-to-risky"],
      labels: ["proximity-to-risky"],
      reasoning: `Transacted with ${riskyContacts.length} blacklisted counterparty/counterparties: ${riskyContacts.join(", ")}`,
      checkedAt,
    };
  }

  return {
    address: normalized,
    riskScore: 0,
    labels: [],
    reasoning: "No direct blacklist match and no risky counterparty exposure detected",
    checkedAt,
  };
}
