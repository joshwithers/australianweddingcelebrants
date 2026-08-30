import { TIER_CREDENTIAL_ISSUER } from "../tierStandards.ts";

export type TierCredentialInput = {
  tier_evidence_source?: string;
  tier_evidence_url?: string;
  tier_evidence_last_checked?: string;
  tier_evidence_note?: string;
};

export type SupportingEvidenceStatus = "current" | "stale" | "incomplete";

const MAX_EVIDENCE_AGE_DAYS = 366;
const DAY_MS = 86_400_000;

function parseDateOnly(value?: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

export function getTierCredential(data: TierCredentialInput, now = new Date()) {
  const source = data.tier_evidence_source?.trim() || "";
  const sourceUrl = data.tier_evidence_url?.trim() || "";
  const checked = parseDateOnly(data.tier_evidence_last_checked);
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const ageDays = checked
    ? Math.floor((today.valueOf() - checked.valueOf()) / DAY_MS)
    : null;
  const hasSupportingEvidence = Boolean(
    source ||
    sourceUrl ||
    data.tier_evidence_last_checked ||
    data.tier_evidence_note,
  );
  const completeSupportingEvidence = Boolean(source && checked);
  const supportingEvidenceStatus: SupportingEvidenceStatus | null =
    !hasSupportingEvidence
      ? null
      : !completeSupportingEvidence
        ? "incomplete"
        : ageDays !== null && ageDays >= 0 && ageDays <= MAX_EVIDENCE_AGE_DAYS
          ? "current"
          : "stale";

  return {
    status: "issued" as const,
    issuer: TIER_CREDENTIAL_ISSUER.name,
    issuerUrl: TIER_CREDENTIAL_ISSUER.url,
    verificationMethod: TIER_CREDENTIAL_ISSUER.verificationMethod,
    supportingEvidence: hasSupportingEvidence
      ? {
          status: supportingEvidenceStatus as SupportingEvidenceStatus,
          source: source || "Source not published",
          sourceUrl,
          lastChecked: data.tier_evidence_last_checked || undefined,
          lastCheckedLabel: data.tier_evidence_last_checked || "Not published",
          note: data.tier_evidence_note,
        }
      : null,
  };
}
