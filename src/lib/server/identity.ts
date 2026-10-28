import { partialDateOrNull } from '#lib/types.ts';
import type { Candidate, Confidence, Inscription, SourceRecord } from '#lib/types.ts';
import type { RawMatch } from './inference/index.ts';

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

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Caps the model's confidence by what the result itself states: "high" needs a stated year.
 * @param claimed Confidence the model gave.
 * @param statesYear Whether the result states a birth or death year.
 * @returns The confidence to trust.
 */
function capConfidence(claimed: Confidence, statesYear: boolean): Confidence {
	return !statesYear && claimed === 'high' ? 'medium' : claimed;
}

/**
 * Finds the surname of a name, ignoring generational suffixes such as Jr. or III.
 * @param name Normalized full name.
 * @returns The lowercase surname.
 */
function surnameOf(name: string): string {
	const parts = name.toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean);
	while (parts.length > 1 && NAME_SUFFIXES.has(parts.at(-1)!)) parts.pop();
	return parts.at(-1) ?? '';
}

/**
 * Applies the deterministic identity rules to the results the model picked as matching the stone.
 * @param inscription The stone's person.
 * @param records Search hits the model saw.
 * @param picks Results the model picked, with the details each one states.
 * @returns No candidate, or the one candidate the stone's person resolves to.
 */
export function resolveMatches(
	inscription: Inscription,
	records: SourceRecord[],
	picks: RawMatch[]
): Candidate[] {
	// The model sees the stone's details and can echo them onto unrelated hits, so a hit must name the surname.
	const surname = surnameOf(inscription.name);
	const byId = new Map(
		records
			.filter((r) => `${r.title} ${r.snippet}`.toLowerCase().includes(surname))
			.map((r) => [r.id, r])
	);
	const matches = [...new Map(picks.map((p) => [p.id, p])).values()].flatMap((p) => {
		const source = byId.get(p.id);
		const born = partialDateOrNull(p.born);
		const died = partialDateOrNull(p.died);
		const agrees =
			yearsAgree(year(born), year(inscription.born)) &&
			yearsAgree(year(died), year(inscription.died));
		if (!source || !agrees) return [];
		// A date counts only when the picked result itself states it.
		const text = `${source.title} ${source.snippet}`;
		return [
			{
				source,
				born: stated(born, text),
				died: stated(died, text),
				place: p.place?.trim() || null,
				confidence: capConfidence(p.confidence, Boolean(stated(born, text) ?? stated(died, text)))
			}
		];
	});
	if (!matches.length) return [];
	return [
		{
			name: inscription.name,
			born: matches.find((m) => m.born)?.born ?? null,
			died: matches.find((m) => m.died)?.died ?? null,
			place: matches.find((m) => m.place)?.place ?? null,
			confidence: matches.reduce<Confidence>(
				(best, m) => (CONFIDENCE_RANK[m.confidence] > CONFIDENCE_RANK[best] ? m.confidence : best),
				'low'
			),
			sources: matches.map((m) => m.source)
		}
	];
}
