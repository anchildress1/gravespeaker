import type { Candidate, Confidence, Inscription, SourceRecord } from '#lib/types.ts';

// Generational suffixes, each folded to one form: a Jr. is often recorded as II, a Sr. as I.
const SUFFIXES: Record<string, string> = {
	jr: 'jr',
	junior: 'jr',
	ii: 'jr',
	'2nd': 'jr',
	sr: 'sr',
	senior: 'sr',
	i: 'sr',
	iii: 'iii',
	'3rd': 'iii',
	iv: 'iv',
	'4th': 'iv',
	v: 'v',
	'5th': 'v'
};
// A suffix right after the surname: "Reynolds Jr.", "Hildebrand, Jr.,". "I" and "V" count only before
// punctuation or the end, so "Hawks I remember" is not a suffix.
const SUFFIX_AFTER = /^\s*(?:,\s*)?(junior|senior|jr|sr|iii|ii|iv|2nd|3rd|4th|5th|i|v)\b\.?/;
const YEAR = String.raw`(1[5-9]\d\d|20\d\d)`;
const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b`;
const WEEKDAY = String.raw`(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b`;
const DAY = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
// Optional date lead before a year: "10 March ", "Wed. June 19, ", "September 21st, ", "03/10/".
const DATE_LEAD = String.raw`(?:${WEEKDAY}\.?,?\s+)?(?:${MONTH}\.?\s+)?(?:${DAY}(?:[/.-]\d{1,2})?[/.,\s-]+(?:[a-z]{3,9}\.?[,\s]+)?)?`;
// Same, for both ends of a range, where no cue word bridges the gap: "Jun 8, 1981 - 01-Sep-2012".
const FULL_DATE_LEAD = String.raw`(?:[a-z]{3,9}\.?\s+)?(?:${DAY}(?:[/.-]\d{1,2})?[/.,\s-]+)?(?:[a-z]{3,9}\.?[,\s-]+)?`;
const DIED_CUE = String.raw`\bdied\b|\bd\.|passed away|\bpassing\b|\bdeceased\b`;
// A cue-to-year gap must not run across another life-event cue: "born in London, died in 2017".
const LIFE_CUE = String.raw`\bborn\b|\bb\.|${DIED_CUE}`;
// An initial ("b.", "d.", "C."), a title, a suffix or a short day or month ends no sentence:
// "Dec. 25", "Wed. June 19" and "St. Matthews" split a death from the name it belongs to.
const NOT_SENTENCE_END =
	'mr mrs ms dr st jr sr jan feb mar apr jun jul aug sep sept oct nov dec mon tue tues wed thu thur thurs fri sat sun';
const SENTENCE_END = new RegExp(
	String.raw`(?<!\b(?:[a-z]|${NOT_SENTENCE_END.replaceAll(' ', '|')}))\.\s`,
	'g'
);
// Descriptive words that can precede a name in a title: "Obituary for Hawks, Gaynor".
const PREFIX_WORDS = new Set(
	'obituary obituaries memorial grave cemetery funeral tribute notice remembering for of the in at and by a an'.split(
		' '
	)
);
// A sentence that opens with a life cue or a life range has no subject of its own: it continues the
// previous one, as in "Louella Marie White. 22 Aug 1935 – 24 May 2017."
const CONTINUES = new RegExp(
	String.raw`^\s*(?:(?:born|died|passed away|deceased|b\.|d\.)(?!\p{L})|(?:\d{1,2}\s+)?(?:${MONTH}\.?\s+)?(?:\d{1,2},?\s+)?${YEAR}\s*[-–—])`,
	'u'
);
const NAME_WORD = /^\p{L}[\p{L}'’-]*$/u;
const NAME_WORDS_MAX = 4;
const NAME_REACH = 60;
const MAX_SOURCES = 5;
const MAX_CANDIDATES = 3;

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
	/** Whether a year stated anywhere in the result, beside the name or not, disagrees with the stone. */
	statesOther: boolean;
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

/** The parts of the stone's name a mention is checked against. */
interface NameParts {
	given: string[];
	surname: string;
	/** Folded generational suffix, such as "jr", or null when the stone carries none. */
	suffix: string | null;
}

/**
 * Splits a name into given names, a surname and a generational suffix.
 * @param name Full name.
 * @returns Folded given-name tokens, surname and suffix.
 */
function nameParts(name: string): NameParts {
	// A quoted nickname (Corwin "Cory" Chambers) is another given name a record may use.
	const parts = fold(name)
		.replace(/[.,"“”]/g, ' ')
		.split(/\s+/)
		.filter(Boolean);
	let suffix: string | null = null;
	while (parts.length > 1 && Object.hasOwn(SUFFIXES, parts.at(-1)!)) {
		const last = SUFFIXES[parts.pop()!];
		suffix ??= last;
	}
	const surname = parts.pop() ?? '';
	return { given: parts, surname, suffix };
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
 * Splits text into words at whitespace, quotes and parentheses, so "Gaynor (Staples) Hawks" reads as one name.
 * @param chunk Text to split.
 * @param offset Index of the chunk within the full text.
 * @returns Words with their index in the full text.
 */
function wordsOf(chunk: string, offset: number): { word: string; index: number }[] {
	return [...chunk.matchAll(/[^\s"“”()]+/gu)].map((m) => ({ word: m[0], index: offset + m.index }));
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
 * Tells whether a word from a record can be one of the stone's given names.
 * @param given Folded given names of the stone; an initial stands for any name that starts with it
 *   when the stone spells out no given name.
 * @param word Folded word from the record.
 * @returns True for an exact match, or a name that fits a stone carrying initials only.
 */
function isGiven(given: string[], word: string): boolean {
	// Once the stone spells out a name, an initial alone is too weak: "Thai DelRay Hiatt" for Georgia D.
	const full = given.filter((g) => g.length > 1);
	return full.length ? full.includes(word) : given.some((g) => g === word || word.startsWith(g));
}

/** One mention of the stone's name in a text. */
interface Mention {
	start: number;
	/**
	 * "own" when the mention carries the stone's own middle initial or suffix, "other" when it
	 * carries one the stone rules out, null when it carries neither.
	 */
	mark: 'own' | 'other' | null;
}

/**
 * Reads the generational suffix right after a surname.
 * @param text Folded text.
 * @param end Index just past the surname.
 * @returns The folded suffix, or null.
 */
function suffixAfter(text: string, end: number): string | null {
	const m = SUFFIX_AFTER.exec(text.slice(end));
	if (!m) return null;
	const next = text[end + m[0].length];
	if ((m[1] === 'i' || m[1] === 'v') && next !== undefined && !/[,.)\n]/.test(next)) return null;
	return SUFFIXES[m[1]];
}

/**
 * Compares a mention's middle initials, middle names and suffix with the stone's. Each is checked
 * only when the stone carries one: a stone without a middle name rules out no middle initial.
 * @param stone The stone's name parts.
 * @param initials Single-letter initials in the mention.
 * @param words Other given-name words in the mention.
 * @param suffix The mention's folded suffix, or null.
 * @returns The mention's mark.
 */
function markOf(
	stone: NameParts,
	initials: string[],
	words: string[],
	suffix: string | null
): Mention['mark'] {
	const middles = stone.given.slice(1);
	const otherInitial =
		middles.length > 0 && initials.some((i) => !stone.given.some((g) => g.startsWith(i)));
	if (otherInitial || (stone.suffix && suffix && suffix !== stone.suffix)) return 'other';
	const ownMiddle =
		initials.some((i) => middles.some((g) => g.startsWith(i))) ||
		words.some((w) => middles.some((g) => g === w || (g.length === 1 && w.startsWith(g))));
	return ownMiddle || (stone.suffix && suffix === stone.suffix) ? 'own' : null;
}

/**
 * Finds the name phrase around a surname, if a given name is in that phrase.
 * @param text Folded text.
 * @param stone The stone's name parts.
 * @param at Index of the surname occurrence.
 * @param length Length of the surname.
 * @returns The mention, or null when no given name sits in the same phrase.
 */
function mentionAt(text: string, stone: NameParts, at: number, length: number): Mention | null {
	const { given } = stone;
	const suffix = suffixAfter(text, at + length);
	if (!given.length) return { start: at, mark: markOf(stone, [], [], suffix) };
	const from = Math.max(0, at - NAME_REACH);
	let first = at;
	let hit = false;
	const initials: string[] = [];
	const words: string[] = [];
	for (const w of wordsOf(text.slice(from, at), from).reverse().slice(0, NAME_WORDS_MAX)) {
		const part = namePart(w.word);
		// Checked before the prefix words, which hold "a": "Daisy A. Morgan" is not Daisy M. Morgan.
		if (part?.name.length === 1 && w.word.endsWith('.')) initials.push(part.name);
		else if (!part || part.closes || PREFIX_WORDS.has(part.name)) break;
		else words.push(part.name);
		first = w.index;
		hit ||= isGiven(given, part.name);
	}
	if (hit) return { start: first, mark: markOf(stone, initials, words, suffix) };
	// "Surname, Given" counts only when the surname opens its phrase; otherwise
	// "Charles Hawks, Gaynor Jones" would pair Hawks with Gaynor.
	if (first !== at || text[at + length] !== ',') return null;
	const next = at + length + 1;
	let tail = suffix;
	for (const w of wordsOf(text.slice(next, next + NAME_REACH), next).slice(0, NAME_WORDS_MAX - 1)) {
		const part = namePart(w.word);
		if (!part) break;
		// After the given name, "Jr." or "III" is a suffix; a lone I or V is read as an initial.
		const after = hit && part.name.length > 1 ? suffixAfter(text, w.index) : null;
		if (after) {
			tail = after;
			break;
		}
		if (part.name.length === 1 && w.word.endsWith('.')) initials.push(part.name);
		else if (PREFIX_WORDS.has(part.name)) break;
		else words.push(part.name);
		hit ||= isGiven(given, part.name);
		if (part.closes) break;
	}
	return hit ? { start: at, mark: markOf(stone, initials, words, tail) } : null;
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
	const found = new RegExp(
		String.raw`(?:${cue})(?:(?!${LIFE_CUE})[^.\d]){0,60}?${DATE_LEAD}\b${YEAR}\b`
	).exec(text);
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
 * @param own The part of that text that belongs to the matched name, where a range is read from.
 * @returns Stated years; `bornSlack` is 1 when the birth year was derived from an age, which
 *   puts the true year in [born - 1, born].
 */
function statedYears(
	text: string,
	own: string
): {
	born: number | null;
	died: number | null;
	bornSlack: number;
} {
	let born: number | null = null;
	let died: number | null = null;
	let bornSlack = 0;
	const range = new RegExp(
		String.raw`${FULL_DATE_LEAD}\b${YEAR}\s*(?:-|–|—|to)\s*${FULL_DATE_LEAD}\b${YEAR}\b`
	).exec(own);
	if (range && +range[2] >= +range[1]) {
		born = +range[1];
		died = +range[2];
	}
	born ??= labelledYear(text, String.raw`\bborn\b|\bb\.`);
	died ??= labelledYear(text, DIED_CUE);
	// "age 85", or right after the name as in "Troy Juntunen, 45, of Richland"; a comma-number
	// elsewhere ("son John, 12,") is someone else's age.
	const age =
		/\baged?\s+(\d{1,3})\b/.exec(text) ??
		/^[\p{L} \t\u00a0.'’-]*(?:,\s*(?:jr|sr|ii|iii|iv)\.?)?,\s*(\d{1,3}),/mu.exec(own);
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
 * Finds the sentence that holds a position, so dates that belong to another person in a later
 * sentence ("Her husband John Smith died 2010.") are not read as the matched name's.
 * @param text Folded text.
 * @param at Index of the matched name.
 * @returns The whole sentence, and the part of it from the name onward.
 */
function sentenceAt(text: string, at: number): { whole: string; fromName: string } {
	const spans: [number, number][] = [];
	let from = 0;
	for (const m of text.matchAll(SENTENCE_END)) {
		spans.push([from, m.index]);
		from = m.index + m[0].length;
	}
	spans.push([from, text.length]);
	const first = Math.max(
		0,
		spans.findIndex(([, end]) => at <= end)
	);
	let last = first;
	// "Born 1932. Died in 2010." carries on about the same person; "Her husband John died 2010." does not.
	while (last + 1 < spans.length && CONTINUES.test(text.slice(...spans[last + 1]))) last++;
	const end = spans[last][1];
	return { whole: text.slice(spans[first][0], end), fromName: text.slice(at, end) };
}

/**
 * Weighs one search result against the stone, key by key. A key the result does not state is
 * neutral; only a stated year that disagrees counts against it.
 * @param inscription The stone's person.
 * @param record One search result.
 * @returns The result's evidence for name, birth year and death year.
 */
function weigh(inscription: Inscription, record: SourceRecord): Evidence {
	const text = fold(`${record.title}\n${record.snippet}`);
	const stone = nameParts(inscription.name);
	const maiden = inscription.maidenName ? fold(inscription.maidenName) : null;
	const none: Evidence = {
		name: false,
		born: 'none',
		died: 'none',
		bornYear: null,
		diedYear: null,
		stated: { born: null, died: null, slack: 0 },
		statesOther: false
	};

	// A page titled with other life dates is someone else's, even when it lists the stone's person
	// among their kin.
	const title = fold(record.title);
	const titled = statedYears(title, title);
	if (
		compareYear(inscription.born, titled.born, titled.bornSlack) === 'conflict' ||
		compareYear(inscription.died, titled.died, 0) === 'conflict'
	)
		return none;

	// The surname, or the maiden name, must share one name phrase with a given name.
	const mentions = [stone.surname, maiden]
		.flatMap((n) => (n ? wordIndexes(text, n).map((i) => mentionAt(text, stone, i, n.length)) : []))
		.filter((m) => m !== null);
	// A mention marked as someone else is set aside. Beside one, a bare mention is as likely that
	// person too, so only a mention marked as the stone's own still counts.
	const starts = (
		mentions.some((m) => m.mark === 'other') ? mentions.filter((m) => m.mark === 'own') : mentions
	).map((m) => m.start);
	if (!starts.length) return none;

	const sentences = starts.map((i) => sentenceAt(text, i));
	// A range is read from the name onward; a labelled year or an age from the whole sentence.
	const stated = statedYears(
		sentences.map((x) => x.whole).join('\n'),
		sentences.map((x) => x.fromName).join('\n')
	);

	const born = compareYear(inscription.born, stated.born, stated.bornSlack);
	const died = compareYear(inscription.died, stated.died, 0);
	const all = statedYears(text, text);
	return {
		name: true,
		born,
		died,
		bornYear: reportedYear(inscription.born, stated.born, stated.bornSlack),
		diedYear: reportedYear(inscription.died, stated.died, 0),
		stated: { born: stated.born, died: stated.died, slack: stated.bornSlack },
		statesOther:
			compareYear(inscription.born, all.born, all.bornSlack) === 'conflict' ||
			compareYear(inscription.died, all.died, 0) === 'conflict'
	};
}

/**
 * Weighs a fetched page as evidence for the stone's person, on the same keys as a search result.
 * @param inscription The stone's person.
 * @param text The page's text.
 * @returns The page's grade, null when it lacks the name or dates it against the stone; and
 *   whether a year stated beside the name disagrees with the stone.
 */
export function pageEvidence(
	inscription: Inscription,
	text: string
): { grade: Confidence | null; conflicts: boolean } {
	const e = weigh(inscription, { id: '', url: '', title: '', site: '', snippet: text });
	const conflicts = e.born === 'conflict' || e.died === 'conflict';
	return {
		grade:
			e.name && !conflicts
				? rate(1 + Number(e.born === 'match') + Number(e.died === 'match'), keysOf(inscription))
				: null,
		conflicts
	};
}

/**
 * Counts the keys a stone offers for matching.
 * @param inscription The stone's person.
 * @returns Its name plus each date it carries.
 */
function keysOf(inscription: Inscription): number {
	return 1 + Number(!!inscription.born) + Number(!!inscription.died);
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
}

/**
 * Builds a candidate from results that agree with each other.
 * @param inscription The stone's person.
 * @param group Results about one person, best first.
 * @returns The candidate.
 */
function candidateOf(inscription: Inscription, group: Scored[]): Candidate {
	const kept = group.slice(0, MAX_SOURCES);
	return {
		name: inscription.name,
		born: kept.find((s) => s.e.bornYear)?.e.bornYear ?? null,
		died: kept.find((s) => s.e.diedYear)?.e.diedYear ?? null,
		confidence: rate(Math.max(...kept.map((s) => s.score)), keysOf(inscription)),
		sources: kept.map((s) => s.record)
	};
}

/**
 * Finds the search results about the stone's person, keyed on name, birth year and death year.
 * @param inscription The stone's person.
 * @param records Deduplicated search results.
 * @returns Up to three candidates, best first: most keys matched, then most agreeing results,
 *   then the order the records arrive in. None when nothing matches.
 */
export function resolveMatches(inscription: Inscription, records: SourceRecord[]): Candidate[] {
	const scored: Scored[] = records
		.map((record) => ({ record, e: weigh(inscription, record) }))
		.filter(({ e }) => e.name && e.born !== 'conflict' && e.died !== 'conflict')
		.map(({ record, e }) => ({
			record,
			e,
			score: 1 + Number(e.born === 'match') + Number(e.died === 'match')
		}))
		// Nothing else ties a name-only result to the stone, so any date it gives against the stone
		// marks a namesake.
		.filter((s) => s.score >= 2 || !s.e.statesOther);
	const best = Math.max(0, ...scored.map((s) => s.score));
	if (!best) return [];
	const ranked = scored
		.filter((s) => (best >= 2 ? s.score >= 2 : s.score === 1))
		.sort((a, b) => b.score - a.score);
	// Results whose stated dates contradict each other are different people, never merged.
	const groups: Scored[][] = [];
	for (const s of ranked) {
		const home = groups.find((g) => g.every((m) => sameDates(m.e, s.e)));
		if (home) home.push(s);
		else groups.push([s]);
	}
	// The app tells the first candidate without asking, so a tie goes to the person more results
	// agree on; a stable sort keeps the records' order after that.
	groups.sort((a, b) => b[0].score - a[0].score || b.length - a.length);
	return groups.slice(0, MAX_CANDIDATES).map((g) => candidateOf(inscription, g));
}
