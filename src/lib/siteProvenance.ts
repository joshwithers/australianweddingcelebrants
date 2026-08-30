export const SITE_URL = "https://australianweddingcelebrants.com.au";

export const PUBLISHER = {
  name: "Withers XYZ Pty Ltd as trustee for the Snow Withers Trust",
  abn: "37 709 073 991",
  url: `${SITE_URL}/about/`,
  id: `${SITE_URL}/about/#publisher`,
} as const;

export const CORRECTIONS_PATH = "/contact/#profile-corrections";
export const CORRECTIONS_URL = `${SITE_URL}${CORRECTIONS_PATH}`;

export const PROFILE_STATEMENT_NOTICE =
  "Profile statements, locations, and travel details were supplied by the celebrant or carried from prior directory records. They have not been independently verified as current.";
