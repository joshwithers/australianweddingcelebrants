const GLOBAL_TRACKING_PARAMS = new Set([
  "dclid",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "msclkid",
]);

const PLATFORM_TRACKING_PARAMS = [
  {
    domains: ["instagram.com"],
    params: new Set(["igsh", "igshid"]),
  },
  {
    domains: ["facebook.com", "fb.com", "fb.me"],
    params: new Set(["mibextid"]),
  },
  {
    domains: ["youtube.com", "youtu.be"],
    params: new Set(["feature", "si"]),
  },
  {
    domains: ["tiktok.com"],
    params: new Set([
      "_r",
      "_t",
      "is_from_webapp",
      "sender_device",
      "sender_web_id",
    ]),
  },
];

const hostnameMatches = (hostname: string, domain: string) =>
  hostname === domain || hostname.endsWith(`.${domain}`);

export const cleanSocialUrl = (value: string): string => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return value;
  }

  const hostname = url.hostname.toLowerCase();
  const platformParams = PLATFORM_TRACKING_PARAMS.filter(({ domains }) =>
    domains.some((domain) => hostnameMatches(hostname, domain)),
  ).flatMap(({ params }) => [...params]);

  for (const key of [...url.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.startsWith("utm_") ||
      GLOBAL_TRACKING_PARAMS.has(normalizedKey) ||
      platformParams.includes(normalizedKey)
    ) {
      url.searchParams.delete(key);
    }
  }

  return url.toString();
};
