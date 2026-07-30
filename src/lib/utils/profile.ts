export const normalizeTelephone = (phone?: string): string | undefined => {
  if (!phone) return undefined;

  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("04") && digits.length === 10) {
    return `+61${digits.slice(1)}`;
  }
  if (digits.startsWith("614") && digits.length === 11) {
    return `+${digits}`;
  }
  if (phone.trim().startsWith("+")) {
    return `+${digits}`;
  }

  return digits || undefined;
};

export const formatTelephone = (phone?: string): string | undefined => {
  const normalized = normalizeTelephone(phone);
  const match = normalized?.match(/^\+61(4\d{2})(\d{3})(\d{3})$/);

  return match ? `+61 ${match[1]} ${match[2]} ${match[3]}` : phone;
};

export const absoluteUrl = (
  value: string | undefined,
  siteUrl: string,
): string | undefined => (value ? new URL(value, siteUrl).href : undefined);

export const australianPostalAddress = (label?: string) => {
  if (!label) return undefined;

  const parts = label
    .replace(/<br\s*\/?>/gi, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return undefined;

  return {
    "@type": "PostalAddress",
    addressLocality:
      parts.length > 1 ? parts.slice(0, -1).join(", ") : parts[0],
    addressRegion: parts.length > 1 ? parts.at(-1) : undefined,
    addressCountry: "AU",
  };
};
