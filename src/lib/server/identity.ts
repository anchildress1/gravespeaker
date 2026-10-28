import type { Candidate, Confidence, Inscription, SourceRecord } from '#lib/types.ts';

const GATED =
	/(^|\.)(ancestry|myheritage|findmypast)\.[a-z.]+$|(^|\.)(newspapers|genealogybank|newspaperarchive|fold3)\.com$/;

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
const YEAR = '(1[5-9]\\d\\d|20\\d\\d)';
const MAX_SOURCES = 5;
const MAX_CANDIDATES = 3;
// Words that make a page likely to be a record of a death, used to rank name-only results.
const RECORD_CUES =
	/obituar|cemeter|grave|memorial|funeral|\bdied\b|passed away|\bborn\b|interment/;
// How far around the name to look for its dates, so another person's dates on the page are ignored.
const WINDOW_BEFORE = 60;
const WINDOW_AFTER = 220;

type KeyState = 'match' | 'conflict' | 'none';

/** What one search result says about the stone's person, key by key. */
interface Evidence {
	name: boolean;
	born: KeyState;
	died: KeyState;
	bornYear: string | null;
	diedYear: string | null;
	/** Years the result states for the person, whether or not the stone carries that date. */
	stated: { born: number | null; died: number | null; slack: number };
}

/**
 * Builds the single research query for a stone.
 * @param inscription The stone's person.
 * @returns A search query; unknown years are omitted.
 */
export function buildQuery(inscription: Inscription): string {
	const years = [inscription.born, inscription.died]
		.map((d) => (d ? d.slice(0, 4) : null))
		.filter((y): y is string => y !== null && !y.includes('?'));
	// A maiden-name OR variant pulled in unrelated hits and buried the real record in live searches.
	// A quoted nickname would break the exact-name quoting; the matcher still uses it.
	const name = inscription.name
		.replace(/["“”][^"“”]*["“”]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return [`"${name}"`, ...years, '(obituary OR grave OR cemetery)'].join(' ');
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
 * Lowercases text and folds accents so "Ødegård" and "odegard" compare equal.
 * @param text Text to fold.
 * @returns Folded text.
 */
function fold(text: string): string {
	const letters: Record<string, string> = { æ: 'ae', œ: 'oe', ø: 'o', ß: 'ss', đ: 'd', ł: 'l' };
	return text
		.normalize('NFD')
		.replace(/\p{M}+/gu, '')
		.toLowerCase()
		.replace(/[æœøßđł]/g, (c) => letters[c]);
}

/**
 * Splits a name into given names and a surname, ignoring generational suffixes.
 * @param name Full name.
 * @returns Folded given-name tokens and surname.
 */
function nameParts(name: string): { given: string[]; surname: string } {
	// A quoted nickname (Corwin "Cory" Chambers) is another given name a record may use.
	const parts = fold(name)
		.replace(/[.,"“”]/g, ' ')
		.split(/\s+/)
		.filter(Boolean);
	while (parts.length > 1 && NAME_SUFFIXES.has(parts.at(-1)!)) parts.pop();
	const surname = parts.pop() ?? '';
	return { given: parts.filter((p) => p.length >= 2), surname };
}

/**
 * Finds the first whole-word occurrence of a word.
 * @param text Folded text.
 * @param word Folded word.
 * @returns Index of the occurrence, or -1.
 */
function wordAt(text: string, word: string): number {
	if (!word) return -1;
	const found = new RegExp(
		`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`,
		'u'
	).exec(text);
	return found ? found.index : -1;
}

/**
 * Whether a year agrees with a stone year, where `?` matches any digit.
 * @param stone Stone year, possibly with `?` digits.
 * @param found Year the result states.
 * @param slack Years of tolerance, for years derived from an age.
 * @returns True when they can denote the same year.
 */
function yearAgrees(stone: string, found: number, slack = 0): boolean {
	for (let y = found - slack; y <= found + slack; y++) {
		if ([...stone].every((c, i) => c === '?' || c === String(y)[i])) return true;
	}
	return false;
}

/**
 * Finds the year that follows a cue word such as "born" or "died".
 * @param text Folded text.
 * @param cue Regular-expression source for the cue words.
 * @returns The year, or null.
 */
function labelledYear(text: string, cue: string): number | null {
	const found = new RegExp(`(?:${cue})[^.\\d]{0,40}?(?:\\d{1,2}[,\\s]+)?\\b${YEAR}\\b`).exec(text);
	return found ? +found[1] : null;
}

/**
 * Compares a year the result states with the stone's date for the same key.
 * @param stone The stone's date, or null when it carries none.
 * @param found The year the result states, or null.
 * @param slack Years of tolerance, for years derived from an age.
 * @returns "none" when either side is missing, else whether they agree.
 */
function compareYear(stone: string | null, found: number | null, slack: number): KeyState {
	if (!stone || found === null) return 'none';
	return yearAgrees(stone.slice(0, 4), found, slack) ? 'match' : 'conflict';
}

/**
 * Reads the birth and death years a text states, by label, range or age.
 * @param text Folded text around the name.
 * @returns Stated years; `bornSlack` is 1 when the birth year was derived from an age.
 */
function statedYears(text: string): {
	born: number | null;
	died: number | null;
	bornSlack: number;
} {
	let born: number | null = null;
	let died: number | null = null;
	let bornSlack = 0;
	const range = new RegExp(`\\b${YEAR}\\s*(?:-|–|—|to)\\s*${YEAR}\\b`).exec(text);
	if (range && +range[2] >= +range[1]) {
		born = +range[1];
		died = +range[2];
	}
	born ??= labelledYear(text, '\\bborn\\b|\\bb\\.');
	died ??= labelledYear(text, '\\bdied\\b|\\bd\\.|passed away|\\bdeceased\\b');
	const age = /\bage[d]?\s+(\d{1,3})\b/.exec(text);
	if (born === null && died !== null && age) {
		born = died - +age[1];
		bornSlack = 1;
	}
	return { born, died, bornSlack };
}

/**
 * Weighs one search result against the stone, key by key. A key the result does not state is
 * neutral; only a stated year that disagrees counts against it.
 * @param inscription The stone's person.
 * @param record One search result.
 * @returns The result's evidence for name, birth year and death year.
 */
function weigh(inscription: Inscription, record: SourceRecord): Evidence {
	const text = fold(`${record.title}. ${record.snippet}`);
	const { given, surname } = nameParts(inscription.name);
	const maiden = inscription.maidenName ? fold(inscription.maidenName) : null;
	const none: Evidence = {
		name: false,
		born: 'none',
		died: 'none',
		bornYear: null,
		diedYear: null,
		stated: { born: null, died: null, slack: 0 }
	};

	// The surname, or the maiden name, must stand beside one of the given names.
	const at = [surname, maiden].flatMap((s) => (s ? [wordAt(text, s)] : [])).filter((i) => i >= 0);
	const givenAt = given.map((g) => wordAt(text, g)).filter((i) => i >= 0);
	if (!at.length || (given.length > 0 && !givenAt.length)) return none;

	const center = Math.min(...at, ...givenAt);
	const around = text.slice(Math.max(0, center - WINDOW_BEFORE), center + WINDOW_AFTER);
	const stated = statedYears(around);

	const born = compareYear(inscription.born, stated.born, stated.bornSlack);
	const died = compareYear(inscription.died, stated.died, 0);
	return {
		name: true,
		born,
		died,
		bornYear: born === 'match' ? String(stated.born) : null,
		diedYear: died === 'match' ? String(stated.died) : null,
		stated: { born: stated.born, died: stated.died, slack: stated.bornSlack }
	};
}

/**
 * Rates the match from how many of the stone's keys the evidence confirms.
 * @param matched Keys confirmed, counting the name.
 * @param available Keys the stone offers: its name plus each date it carries.
 * @returns High when every available key matches, medium for two or more, else low.
 */
function rate(matched: number, available: number): Confidence {
	if (matched >= 2 && matched === available) return 'high';
	return matched >= 2 ? 'medium' : 'low';
}

/**
 * Whether two stated years contradict each other.
 * @param x First year, or null when not stated.
 * @param y Second year, or null when not stated.
 * @param slack Years of tolerance.
 * @returns True only when both are stated and further apart than the slack.
 */
function yearsDiffer(x: number | null, y: number | null, slack: number): boolean {
	return x !== null && y !== null && Math.abs(x - y) > slack;
}

/**
 * Whether two results can describe one person: no stated year of one contradicts the other.
 * @param a Evidence of one result.
 * @param b Evidence of another result.
 * @returns False when both state a birth or death year and the years differ.
 */
function sameDates(a: Evidence, b: Evidence): boolean {
	return (
		!yearsDiffer(a.stated.born, b.stated.born, a.stated.slack + b.stated.slack) &&
		!yearsDiffer(a.stated.died, b.stated.died, 0)
	);
}

/** A result with its evidence and how many of the stone's keys it confirms. */
interface Scored {
	record: SourceRecord;
	e: Evidence;
	score: number;
	recordLike: boolean;
}

/**
 * Builds a candidate from results that agree with each other.
 * @param inscription The stone's person.
 * @param group Results about one person, best first.
 * @returns The candidate.
 */
function candidateOf(inscription: Inscription, group: Scored[]): Candidate {
	const kept = group.slice(0, MAX_SOURCES);
	const available = 1 + Number(!!inscription.born) + Number(!!inscription.died);
	return {
		name: inscription.name,
		born: kept.find((s) => s.e.bornYear)?.e.bornYear ?? null,
		died: kept.find((s) => s.e.diedYear)?.e.diedYear ?? null,
		confidence: rate(Math.max(...kept.map((s) => s.score)), available),
		sources: kept.map((s) => s.record)
	};
}

/**
 * Finds the search results that are about the stone's person.
 *
 * Name, birth year and death year are the keys. A result with the name and at least one matching
 * date is returned even when its other date is missing. A stated year that disagrees with the
 * stone excludes the result. When nothing confirms a date, name-only results are returned as
 * unverified. Results whose stated dates contradict each other are different people, so they
 * become separate candidates rather than being merged.
 * @param inscription The stone's person.
 * @param records Deduplicated search results.
 * @returns Up to three candidates, best first; none when nothing matches.
 */
export function resolveMatches(inscription: Inscription, records: SourceRecord[]): Candidate[] {
	const scored: Scored[] = records
		.map((record) => ({ record, e: weigh(inscription, record) }))
		.filter(({ e }) => e.name && e.born !== 'conflict' && e.died !== 'conflict')
		.map(({ record, e }) => ({
			record,
			e,
			score: 1 + Number(e.born === 'match') + Number(e.died === 'match'),
			recordLike: RECORD_CUES.test(fold(`${record.title} ${record.snippet} ${record.site}`))
		}));
	const best = Math.max(0, ...scored.map((s) => s.score));
	if (!best) return [];
	const ranked = scored
		.filter((s) => (best >= 2 ? s.score >= 2 : s.score === 1))
		.sort((a, b) => b.score - a.score || Number(b.recordLike) - Number(a.recordLike));
	const groups: Scored[][] = [];
	for (const s of ranked) {
		const home = groups.find((g) => g.every((m) => sameDates(m.e, s.e)));
		if (home) home.push(s);
		else groups.push([s]);
	}
	return groups.slice(0, MAX_CANDIDATES).map((g) => candidateOf(inscription, g));
}
