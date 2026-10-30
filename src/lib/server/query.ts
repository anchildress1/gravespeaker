import type { Inscription } from '#lib/types.ts';

/**
 * Reads the years a stone carries in full.
 * @param inscription The stone's person.
 * @returns Birth and death years, once each, leaving out a year with an unreadable digit.
 */
function yearsOf(inscription: Inscription): string[] {
	const years = [inscription.born, inscription.died]
		.map((d) => (d ? d.slice(0, 4) : null))
		.filter((y): y is string => y !== null && !y.includes('?'));
	return [...new Set(years)];
}

/**
 * Writes the stone's name as a search term, without a quoted nickname.
 * @param inscription The stone's person.
 * @returns The name as one exact phrase.
 */
function exactName(inscription: Inscription): string {
	// A quoted nickname would break the exact-name quoting; the matcher still uses it.
	const name = inscription.name
		.replace(/["“”][^"“”]*["“”]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return `"${name}"`;
}

/**
 * Builds one research query for a stone.
 * @param inscription The stone's person.
 * @returns A search query; unknown years and place are omitted.
 */
export function buildQuery(inscription: Inscription): string {
	// The maiden name stays out: as an OR variant it buried the real record under unrelated hits.
	// Unquoted, so an obituary naming the town in other words still ranks. Lowercase, so a carved
	// "OR" can't act as a search operator.
	const place = inscription.place
		?.toLowerCase()
		.replace(/[^\p{L}\p{N}' -]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return [exactName(inscription), ...yearsOf(inscription), place].filter(Boolean).join(' ');
}

/**
 * Lists the research queries for a stone in the order to try them: name and dates, then with the
 * town, then name and town without the dates; each plain, then with death keywords.
 * @param inscription The stone's person.
 * @returns Distinct queries in the order to try them.
 */
export function searchQueries(inscription: Inscription): string[] {
	// Dates lead: adding the town first hid dates from records the bare search already matched.
	const queries = [
		buildQuery({ ...inscription, place: null }),
		buildQuery(inscription),
		// Name and town alone returns namesakes the story would reject, so it runs only after the dated
		// queries; a stone with no readable year has nothing better to ask.
		inscription.place ? buildQuery({ ...inscription, born: null, died: null }) : null
	];
	// Each query asks without death keywords first, which finds pages about the life and some
	// memorials, then with them, which finds obituaries the plain query ranks lower.
	return [
		...new Set(
			queries.filter((q) => q !== null).flatMap((q) => [q, `${q} (obituary OR grave OR cemetery)`])
		)
	];
}
