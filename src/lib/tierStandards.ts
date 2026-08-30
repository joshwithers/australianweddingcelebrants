export const TIER_STANDARDS_LAST_CHECKED = "2026-08-30";

export const TIER_CREDENTIAL_ISSUER = {
  name: "Australian Wedding Celebrants",
  url: "https://australianweddingcelebrants.com.au/tiers/",
  verificationMethod: "Human verified by Australian Wedding Celebrants",
} as const;

export const TIER_STANDARDS_SOURCES = [
  {
    name: "Australian Government — Find a marriage celebrant",
    url: "https://www.ag.gov.au/families-and-marriage/marriage/find-marriage-celebrant",
  },
  {
    name: "Marriage (Celebrancy Qualifications or Skills) Determination 2018",
    url: "https://www.legislation.gov.au/F2018L00989/latest/text",
  },
  {
    name: "Attorney-General's Department — Professional development",
    url: "https://www.ag.gov.au/families-and-marriage/marriage/resources-marriage-celebrants/professional-development",
  },
] as const;

export const TIER_STANDARDS_CAVEAT =
  "Registered, Endorsed, and Luminary are credentials issued and human verified by Australian Wedding Celebrants against its published standards. They are not government, industry-body, review-platform, or vendor endorsements. A credential does not guarantee present availability or current commercial activity.";
