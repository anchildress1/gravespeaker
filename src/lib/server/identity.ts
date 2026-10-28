import { PARTIAL_DATE } from '#lib/types.ts';
import type { Candidate, Inscription, SourceRecord } from '#lib/types.ts';
import type { RawCandidate } from './inference/index.ts';

const MAX_CANDIDATES = 5;
const GATED =
	/(^|\.)(ancestry|myheritage|findmypast)\.[a-z.]+$|(^|\.)(newspapers|genealogybank|newspaperarchive|fold3)\.com$/;

/**
 * Returns the known 4-character year of a date.
 * @param date Partial date or null.
 * @returns The year (may contain `?`), or null.
 */
const year = (date: string | null): string | null => (date ? date.slice(0, 4) : null);

/**
 * Whether two partial years can denote the same year; `?` matches any digit.
 * @param a First year.
 * @param b Second year.
 * @returns True unless a known digit differs. Null never conflicts.
 */
function yearsAgree(a: string | null, b: string | null): boolean {
	if (!a || !b) return true;
	return [...a].every((c, i) => c === '?' || b[i] === '?' || c === b[i]);
}

/**
 * Keeps a candidate date only if its year appears in the candidate's own records.
 * @param date Date the model reported.
 * @param text Title and snippet text of the candidate's sources.
 * @returns The date, or null when no source states that year.
 */
function stated(date: string | null, text: string): string | null {
	return date && !date.slice(0, 4).includes('?') && text.includes(date.slice(0, 4)) ? date : null;
}

/**
 * Builds the single research query for a stone.
 * @param inscription The stone's person.
 * @returns A Google query; unknown years are omitted.
 */
export function buildQuery(inscription: Inscription): string {
	const years = [year(inscription.born), year(inscription.died)].filter(
		(y): y is string => y !== null && !y.includes('?')
	);
	// A maiden-name OR variant pulled in unrelated hits and buried the real record in live searches.
	return [`"${inscription.name}"`, ...years, '(obituary OR grave OR cemetery)'].join(' ');
}

/**
 * Removes records from paywalled or login-gated genealogy sites.
 * @param records Search hits.
 * @returns Hits on open sites.
 */
export function dropGated(records: SourceRecord[]): SourceRecord[] {
	return records.filter((r) => !GATED.test(r.site.toLowerCase()));
}

/**
 * Applies the deterministic identity rules to the model's candidate groups.
 * @param inscription The stone's person.
 * @param records Search hits the model saw.
 * @param raw Candidate groups the model returned.
 * @returns At most 5 candidates, ordered by matched inscription fields.
 */
export function resolveCandidates(
	inscription: Inscription,
	records: SourceRecord[],
	raw: RawCandidate[]
): Candidate[] {
	// The model sees the stone's details and can echo them onto unrelated hits, so a hit must name the surname.
	const surname = inscription.name.split(' ').at(-1)!.toLowerCase();
	const byId = new Map(
		records
			.filter((r) => `${r.title} ${r.snippet}`.toLowerCase().includes(surname))
			.map((r) => [r.id, r])
	);
	const grouped = raw.map((c) => ({
		c,
		ids: [...new Set(c.resultIds)].filter((id) => byId.has(id))
	}));
	const claims = new Map<string, number>();
	for (const { ids } of grouped) for (const id of ids) claims.set(id, (claims.get(id) ?? 0) + 1);

	const scored: { candidate: Candidate; score: number }[] = [];
	for (const { c, ids } of grouped) {
		const sources = ids.filter((id) => claims.get(id) === 1).map((id) => byId.get(id)!);
		const born = c.born && PARTIAL_DATE.test(c.born) ? c.born : null;
		const died = c.died && PARTIAL_DATE.test(c.died) ? c.died : null;
		const text = sources.map((r) => `${r.title} ${r.snippet}`).join(' ');
		if (!sources.length || !/\p{L}/u.test(c.name)) continue;
		if (!yearsAgree(year(born), year(inscription.born))) continue;
		if (!yearsAgree(year(died), year(inscription.died))) continue;
		scored.push({
			candidate: {
				name: c.name.trim(),
				born: stated(born, text),
				died: stated(died, text),
				place: c.place?.trim() || null,
				sources
			},
			score:
				Number(c.name.trim().toLowerCase() === inscription.name.toLowerCase()) +
				Number(!!year(born) && !!year(inscription.born)) +
				Number(!!year(died) && !!year(inscription.died))
		});
	}
	return scored
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_CANDIDATES)
		.map((s) => s.candidate);
}
