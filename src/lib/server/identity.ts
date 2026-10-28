import type { Candidate, Confidence, Inscription, SourceRecord } from '#lib/types.ts';

const GATED =
	/(^|\.)(ancestry|myheritage|findmypast)\.[a-z.]+$|(^|\.)(newspapers|genealogybank|newspaperarchive|fold3)\.com$/;

const NAME_SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);
const YEAR = String.raw`(1[5-9]\d\d|20\d\d)`;
// Optional day or numeric date lead before a year: "10 March ", "March 10, ", "03/10/".
const DATE_LEAD = String.raw`(?:\d{1,2}(?:[/.-]\d{1,2})?[/.,\s-]+(?:[a-z]{3,9}\.?[,\s]+)?)?`;
const NAME_WORD = /^\p{L}[\p{L}'’-]*$/u;
const NAME_WORDS_MAX = 4;
const NAME_REACH = 60;
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
 * Finds every whole-word occurrence of a word.
 * @param text Folded text.
 * @param word Folded word.
 * @returns Indexes of the occurrences.
 */
function wordIndexes(text: string, word: string): number[] {
	if (!word) return [];
	const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
	const found = text.matchAll(
		new RegExp(String.raw`(?<![\p{L}\p{N}])${escaped}(?![\p{L}\p{N}])`, 'gu')
	);
	return [...found].map((m) => m.index);
}

/**
 * Splits text into words at whitespace and quotes.
 * @param chunk Text to split.
 * @param offset Index of the chunk within the full text.
 * @returns Words with their index in the full text.
 */
function wordsOf(chunk: string, offset: number): { word: string; index: number }[] {
	return [...chunk.matchAll(/[^\s"“”]+/gu)].map((m) => ({ word: m[0], index: offset + m.index }));
}

/**
 * Classifies a word as part of a personal name.
 * @param word A word from the text.
 * @returns The bare name, and whether trailing punctuation ends the name; null for other words.
 */
function namePart(word: string): { name: string; closes: boolean } | null {
	const name = word.replace(/[.,]$/, '');
	if (!NAME_WORD.test(name)) return null;
	return { name, closes: name !== word && !(word.endsWith('.') && name.length === 1) };
}

/**
 * Finds where the name phrase containing a surname starts, if a given name is in that phrase.
 * @param text Folded text.
 * @param given Folded given names of the stone.
 * @param at Index of the surname occurrence.
 * @param length Length of the surname.
 * @returns Index where the phrase starts, or -1 when no given name sits in the same phrase.
 */
function phraseStart(text: string, given: string[], at: number, length: number): number {
	if (!given.length) return at;
	const from = Math.max(0, at - NAME_REACH);
	let first = at;
	let hit = false;
	for (const w of wordsOf(text.slice(from, at), from).reverse().slice(0, NAME_WORDS_MAX)) {
		const part = namePart(w.word);
		if (!part || part.closes) break;
		first = w.index;
		hit ||= given.includes(part.name);
	}
	if (hit) return first;
	// "Surname, Given" counts only when the surname opens its phrase; otherwise
	// "Charles Hawks, Gaynor Jones" would pair Hawks with Gaynor.
	if (first !== at || text[at + length] !== ',') return -1;
	const next = at + length + 1;
	for (const w of wordsOf(text.slice(next, next + NAME_REACH), next).slice(0, NAME_WORDS_MAX - 1)) {
		const part = namePart(w.word);
		if (!part) break;
		if (given.includes(part.name)) return at;
		if (part.closes) break;
	}
	return -1;
}

/**
 * Lists the years a result allows that agree with a stone year, where `?` matches any digit.
 * @param stone Stone year, possibly with `?` digits.
 * @param found Latest year the result allows.
 * @param slack Years the true year may lie before `found`, for years derived from an age.
 * @returns Agreeing years; empty when none can denote the same year.
 */
function agreeingYears(stone: string, found: number, slack = 0): number[] {
	const years: number[] = [];
	for (let y = found - slack; y <= found; y++) {
		if ([...stone].every((c, i) => c === '?' || c === String(y)[i])) years.push(y);
	}
	return years;
}

/**
 * Finds the year that follows a cue word such as "born" or "died".
 * @param text Folded text.
 * @param cue Regular-expression source for the cue words.
 * @returns The year, or null.
 */
function labelledYear(text: string, cue: string): number | null {
	const found = new RegExp(String.raw`(?:${cue})[^.\d]{0,40}?${DATE_LEAD}\b${YEAR}\b`).exec(text);
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
	return agreeingYears(stone.slice(0, 4), found, slack).length ? 'match' : 'conflict';
}

/**
 * Reads the birth and death years a text states, by label, range or age.
 * @param text Folded text around the name.
 * @returns Stated years; `bornSlack` is 1 when the birth year was derived from an age, which
 *   puts the true year in [born - 1, born].
 */
function statedYears(text: string): {
	born: number | null;
	died: number | null;
	bornSlack: number;
} {
	let born: number | null = null;
	let died: number | null = null;
	let bornSlack = 0;
	const range = new RegExp(String.raw`\b${YEAR}\s*(?:-|–|—|to)\s*${YEAR}\b`).exec(text);
	if (range && +range[2] >= +range[1]) {
		born = +range[1];
		died = +range[2];
	}
	born ??= labelledYear(text, String.raw`\bborn\b|\bb\.`);
	died ??= labelledYear(text, String.raw`\bdied\b|\bd\.|passed away|\bdeceased\b`);
	const age = /\baged?\s+(\d{1,3})\b/.exec(text);
	if (born === null && died !== null && age) {
		born = died - +age[1];
		bornSlack = 1;
	}
	return { born, died, bornSlack };
}

/**
 * Picks the year to report for a year a result states.
 * @param stone The stone's date for the same key, or null.
 * @param found The year the result states, or null.
 * @param slack Years the true year may lie before `found`, for years derived from an age.
 * @returns The stated year; a derived year only when the stone singles out one year of it.
 */
function reportedYear(stone: string | null, found: number | null, slack: number): string | null {
	if (found === null) return null;
	if (slack === 0) return String(found);
	const agreeing = stone ? agreeingYears(stone.slice(0, 4), found, slack) : [];
	return agreeing.length === 1 ? String(agreeing[0]) : null;
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

	// The surname, or the maiden name, must share one name phrase with a given name.
	const starts = [surname, maiden]
		.flatMap((n) =>
			n ? wordIndexes(text, n).map((i) => phraseStart(text, given, i, n.length)) : []
		)
		.filter((i) => i >= 0);
	if (!starts.length) return none;

	const center = Math.min(...starts);
	const around = text.slice(Math.max(0, center - WINDOW_BEFORE), center + WINDOW_AFTER);
	const stated = statedYears(around);

	const born = compareYear(inscription.born, stated.born, stated.bornSlack);
	const died = compareYear(inscription.died, stated.died, 0);
	return {
		name: true,
		born,
		died,
		bornYear: reportedYear(inscription.born, stated.born, stated.bornSlack),
		diedYear: reportedYear(inscription.died, stated.died, 0),
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
 * @param slackX Years the true first year may lie before `x`.
 * @param slackY Years the true second year may lie before `y`.
 * @returns True only when both are stated and their intervals do not overlap.
 */
function yearsDiffer(x: number | null, y: number | null, slackX: number, slackY: number): boolean {
	return x !== null && y !== null && (x - y > slackX || y - x > slackY);
}

/**
 * Whether two results can describe one person: no stated year of one contradicts the other.
 * @param a Evidence of one result.
 * @param b Evidence of another result.
 * @returns False when both state a birth or death year and the years differ.
 */
function sameDates(a: Evidence, b: Evidence): boolean {
	return (
		!yearsDiffer(a.stated.born, b.stated.born, a.stated.slack, b.stated.slack) &&
		!yearsDiffer(a.stated.died, b.stated.died, 0, 0)
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
