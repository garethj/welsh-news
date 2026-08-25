// Which headlines get shown: today's top 5 (by feed position) merged with
// anything freshly fetched since, deduplicated. Stateless by design — same
// result on any device regardless of visit history. Shared between the
// fetch script (which uses this to decide what needs word glosses
// precomputed) and the front end (which uses it to decide what to render).

export const TOP_COUNT = 5;
export const EXTRA_COUNT = 3;

export function pickDisplaySet(data) {
  const headlines = data.headlines || [];
  const byPosition = [...headlines].sort((a, b) => a.feedPosition - b.feedPosition);
  const byRecency = [...headlines].sort((a, b) => new Date(b.fetchedAt) - new Date(a.fetchedAt));

  const top = byPosition.slice(0, TOP_COUNT);
  const seen = new Set(top.map((h) => h.guid));
  const extra = byRecency.filter((h) => !seen.has(h.guid)).slice(0, EXTRA_COUNT);

  return [...top, ...extra];
}
