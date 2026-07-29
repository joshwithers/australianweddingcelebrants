const DOMAIN = "australianweddingcelebrants.com.au";
const OWNER = `_index._agents.${DOMAIN}`;
const EXPECTED_SERVICE = `1 ${DOMAIN}. mandatory=alpn,port alpn=h2,http/1.1 port=443`;
const EXPECTED_DS =
  "2371 13 2 35511ACD0816A786BEBA2DC81D5A2F577D0DB99BF5311910C799A869AFA2CF18";

async function resolve(name, type) {
  const url = new URL("https://dns.google/resolve");
  url.searchParams.set("name", name);
  url.searchParams.set("type", type);
  url.searchParams.set("do", "1");

  const response = await fetch(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(
      `DNS-over-HTTPS request for ${name} ${type} returned ${response.status}`,
    );
  }

  return response.json();
}

function normalise(value) {
  return value.trim().replaceAll('"', "").replace(/\s+/g, " ").toLowerCase();
}

function requireAuthenticatedAnswer(result, name, type) {
  if (result.Status !== 0) {
    throw new Error(`${name} ${type} returned DNS status ${result.Status}`);
  }

  if (result.AD !== true) {
    throw new Error(
      `${name} ${type} is not DNSSEC-authenticated (AD flag is false)`,
    );
  }

  if (!Array.isArray(result.Answer)) {
    throw new Error(`${name} ${type} returned no answers`);
  }
}

const [serviceResult, dsResult] = await Promise.all([
  resolve(OWNER, "HTTPS"),
  resolve(DOMAIN, "DS"),
]);

requireAuthenticatedAnswer(serviceResult, OWNER, "HTTPS");
requireAuthenticatedAnswer(dsResult, DOMAIN, "DS");

const serviceAnswer = serviceResult.Answer.find((answer) => answer.type === 65);
if (!serviceAnswer) {
  throw new Error(`${OWNER} returned no HTTPS (TYPE65) service record`);
}

if (normalise(serviceAnswer.data) !== normalise(EXPECTED_SERVICE)) {
  throw new Error(
    `${OWNER} HTTPS record does not match the expected DNS-AID service record:\n${serviceAnswer.data}`,
  );
}

const dsAnswer = dsResult.Answer.find((answer) => answer.type === 43);
if (!dsAnswer) {
  throw new Error(`${DOMAIN} returned no DS record`);
}

if (normalise(dsAnswer.data) !== normalise(EXPECTED_DS)) {
  throw new Error(
    `${DOMAIN} DS record does not match the expected Cloudflare key:\n${dsAnswer.data}`,
  );
}

console.log(`DNS-AID and DNSSEC checks passed for ${OWNER}`);
