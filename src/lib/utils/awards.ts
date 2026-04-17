export type Award = {
  title: string;
  emoji?: string;
  region?: string;
  year: number;
  note?: string;
};

type AwardSource = {
  awards?: Award[];
  year_started?: number;
};

// Merge explicit awards with a synthetic "Class of {year_started}" entry.
// Every celebrant with a start year gets at least one award on their shelf.
// Returned list is sorted newest year first; within a year, explicit awards
// rank above the synthetic Class entry.
export function deriveAwards(data: AwardSource): Award[] {
  const explicit: (Award & { __synthetic?: false })[] = Array.isArray(data.awards)
    ? data.awards.map((a) => ({ ...a }))
    : [];

  const synthetic: (Award & { __synthetic?: true })[] = [];
  if (typeof data.year_started === "number") {
    synthetic.push({
      title: `Class of ${data.year_started}`,
      emoji: "🎓",
      year: data.year_started,
      __synthetic: true,
    });
  }

  const all = [...explicit, ...synthetic];
  all.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    const aSyn = (a as any).__synthetic ? 1 : 0;
    const bSyn = (b as any).__synthetic ? 1 : 0;
    return aSyn - bSyn;
  });

  return all.map(({ __synthetic, ...rest }) => rest);
}
