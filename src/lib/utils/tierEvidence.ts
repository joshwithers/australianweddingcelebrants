export type TierEvidenceInput = {
  tier_evidence_source?: string;
  tier_evidence_url?: string;
  tier_evidence_last_checked?: string;
  tier_evidence_note?: string;
};

export type TierEvidenceStatus = "current" | "stale" | "missing";

const MAX_EVIDENCE_AGE_DAYS = 366;
const DAY_MS = 86_400_000;

function parseDateOnly(value?: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

export function getTierEvidence(
  data: TierEvidenceInput,
  now = new Date(),
) {
  const source = data.tier_evidence_source?.trim() || "";
  const checked = parseDateOnly(data.tier_evidence_last_checked);
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const ageDays = checked ? Math.floor((today.valueOf() - checked.valueOf()) / DAY_MS) : null;
  const complete = Boolean(source && checked);
  const status: TierEvidenceStatus = !complete
    ? "missing"
    : ageDays !== null && ageDays >= 0 && ageDays <= MAX_EVIDENCE_AGE_DAYS
      ? "current"
      : "stale";

  return {
    status,
    source: source || "Not recorded in the public profile",
    sourceUrl: data.tier_evidence_url?.trim() || "",
    lastChecked: data.tier_evidence_last_checked || undefined,
    lastCheckedLabel: data.tier_evidence_last_checked || "Not recorded",
    note: data.tier_evidence_note,
    canPublishCredential: status === "current",
  };
}
