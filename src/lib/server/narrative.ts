import type { Candidate, Inscription, Story } from '#lib/types.ts';
import type { PageText, RawFact } from './inference/index.ts';

const MONTHS = new Set(
	(
		'january february march april may june july august september october november december ' +
		'jan feb mar apr jun jul aug sep sept oct nov dec'
	).split(' ')
);

// Spelled-out numbers compare equal to their digits, so "forty" and "40" support each other.
// "one" is left out: "no one" and "one more time" are ordinary prose, not a count.
// A Map, not an object: a prose word such as "constructor" must not hit an inherited property.
const NUMBER_VALUES = new Map<string, string>([
	...'two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'
		.split(' ')
		.map((w, i): [string, string] => [w, String(i + 2)]),
	['thirty', '30'],
	['forty', '40'],
	['fifty', '50'],
	['sixty', '60'],
	['seventy', '70'],
	['eighty', '80'],
	['ninety', '90'],
	['hundred', '100'],
	['thousand', '1000']
]);

// "twenty-four" is one number, so it must equal "24" as a whole; token by token it would not.
const TENS = 'twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
const ONES = 'one two three four five six seven eight nine'.split(' ');
const COMPOUND_NUMBER = new RegExp(
	String.raw`\b(${TENS.join('|')})[\s-](${ONES.join('|')})\b`,
	'giu'
);

// Negations flip a claim, so one that touches a fact must come from that fact.
const NEGATIONS = new Set('not never no none nobody neither nor without cannot'.split(' '));

// Words this short are filler; only longer words identify what a sentence is about.
const MIN_TOPIC_LENGTH = 5;
// Compare word stems so "preceded"/"preceding" match without a stemmer dependency.
const STEM_LENGTH = 5;
// A fact counts as used when at least this share of its topic words appear in the story.
const MIN_FACT_USE = 0.5;

// Short function words say nothing about a fact, so a fact with no long words is matched on the rest.
const FUNCTION_WORDS = new Set(
	'a an and are as at be but by for from had has have he her his in is it its of on or she that the their they this to was were who with'.split(
		' '
	)
);

// Life-date words restate the stone's dates, so a quote made of them adds nothing (FR-013).
const LIFE_MARKERS = new Set(
	'born birth died death passed away deceased aged age year years old'.split(' ')
);
const ORDINAL = /^\d+(?:st|nd|rd|th)$/;

// A quote that names survivors would put living people's names into the story (FR-017).
const SURVIVORS =
	/\b(survived by|survivors?|leaves behind|leaving behind|left to mourn|she leaves|he leaves)\b/i;

// A relative named in a quote is usually a survivor, so the quote is dropped unless it says the
// relative died first. Matched on the original text: a name is a capitalized word.
const RELATIVE_WORDS =
	'husband wife spouse partner son sons daughter daughters brother brothers sister sisters mother father grandson granddaughter grandchildren nephew niece stepson stepdaughter'.split(
		' '
	);
// Each letter-case spelling is listed, because a case-insensitive flag would also let \p{Lu} match lowercase.
const RELATIVE = RELATIVE_WORDS.map((w) => `[${w[0].toUpperCase()}${w[0]}]${w.slice(1)}`).join('|');
const NAMED_RELATIVE = new RegExp(
	String.raw`\b(?:${RELATIVE})\b[^.,;]{0,12}?\p{Lu}\p{Ll}+|\p{Lu}\p{Ll}+,?\s+(?:[Hh]er|[Hh]is|[Tt]heir)\s+(?:${RELATIVE})\b`,
	'u'
);
const NAMED_RELATIVE_CASE = /\p{Lu}\p{Ll}/u;
const PREDECEASED = /\b(predeceased|preceded (?:her |him |them )?in death)\b/i;

/** A fact whose quote was found verbatim in a cited source. */
export type VerifiedFact = RawFact;

/**
 * Lowercases and collapses everything except letters and digits to single spaces.
 * @param s Text to normalize.
 * @returns Normalized text.
 */
function norm(s: string): string {
	return joinCompounds(s)
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/**
 * Tells whether a quote names a relative who may still be alive.
 * @param quote Quote as written in the source.
 * @returns True for "her husband John" style quotes, unless the quote says the relative died first.
 */
function namesSurvivor(quote: string): boolean {
	return NAMED_RELATIVE_CASE.test(quote) && NAMED_RELATIVE.test(quote) && !PREDECEASED.test(quote);
}

/**
 * Rewrites spelled-out compound numbers as digits: "twenty-four" becomes "24".
 * @param text Any text.
 * @returns The text with each tens-and-ones number written as one numeral.
 */
function joinCompounds(text: string): string {
	return text.replace(COMPOUND_NUMBER, (_, tens: string, ones: string) =>
		String((TENS.indexOf(tens.toLowerCase()) + 2) * 10 + ONES.indexOf(ones.toLowerCase()) + 1)
	);
}

/**
 * Maps a spelled-out number to its digits; any other word is returned unchanged.
 * @param word Lowercase word.
 * @returns Digits for a number word, else the word.
 */
function canon(word: string): string {
	return NUMBER_VALUES.get(word) ?? word;
}

/**
 * Lists the stems of a text's topic words, which say what the text is about.
 * @param text Normalized text.
 * @returns Stems of words long enough to carry meaning.
 */
function topicStems(text: string): string[] {
	return text
		.split(' ')
		.filter((w) => w.length >= MIN_TOPIC_LENGTH)
		.map((w) => canon(w).slice(0, STEM_LENGTH));
}

/**
 * Lists the words a fact is matched on: its topic stems, or its content words when it has no long ones.
 * @param text Normalized fact quote.
 * @returns Stems to look for in the story.
 */
function factTerms(text: string): string[] {
	const stems = topicStems(text);
	if (stems.length > 0) return stems;
	return text
		.split(' ')
		.filter((w) => w && !FUNCTION_WORDS.has(w))
		.map(canon);
}

/**
 * Keeps only facts whose quote appears verbatim in the source they cite and names no survivors.
 * @param candidate The confirmed candidate.
 * @param pages Text of each source as the model saw it.
 * @param raw Facts as the model returned them.
 * @returns Verified facts, without repeats.
 */
export function verifyFacts(
	candidate: Candidate,
	pages: PageText[],
	raw: RawFact[]
): VerifiedFact[] {
	const known = new Set(candidate.sources.map((s) => s.id));
	const text = new Map(pages.map((p) => [p.sourceId, norm(p.text)]));
	const seen = new Set<string>();
	return raw.filter((f) => {
		const quote = norm(f.quote ?? '');
		if (!quote || !known.has(f.sourceId) || !text.get(f.sourceId)?.includes(quote)) return false;
		if (SURVIVORS.test(f.quote) || namesSurvivor(f.quote)) return false;
		if (seen.has(quote)) return false;
		seen.add(quote);
		return true;
	});
}

/**
 * Tokens of the person's own name, which a story may use without a quote.
 * @param inscription The stone's person.
 * @param candidate The confirmed candidate.
 * @returns Normalized name tokens.
 */
function nameTokens(inscription: Inscription, candidate: Candidate): Set<string> {
	return new Set(
		[inscription.name, candidate.name, inscription.maidenName ?? '']
			.flatMap((n) => norm(n).split(' '))
			.filter(Boolean)
	);
}

/**
 * Whether the facts say something beyond the person's name, dates and the words that introduce them (FR-013).
 * @param inscription The stone's person.
 * @param candidate The confirmed candidate.
 * @param facts Verified facts.
 * @returns True when at least one fact carries real content.
 */
export function hasEvidence(
	inscription: Inscription,
	candidate: Candidate,
	facts: VerifiedFact[]
): boolean {
	const names = nameTokens(inscription, candidate);
	return facts.some((f) =>
		norm(f.quote)
			.split(' ')
			.some(
				(t) =>
					!names.has(t) &&
					!MONTHS.has(t) &&
					!/^\d+$/.test(t) &&
					!FUNCTION_WORDS.has(t) &&
					!LIFE_MARKERS.has(t) &&
					!ORDINAL.test(t)
			)
	);
}

/**
 * Checks one sentence for claims the facts do not support: new numbers, new names, or a negation
 * attached to a fact. Atmosphere passes untouched.
 * @param sentence One sentence of the story.
 * @param quoteWords Normalized words of every fact quote.
 * @param quoteStems Per-fact topic stems, to tell which fact a sentence is about.
 * @param allowed Name and month tokens that need no quote.
 * @returns True when the sentence adds nothing the facts lack.
 */
function sentenceHolds(
	sentence: string,
	quoteWords: Set<string>,
	quoteStems: { stems: Set<string>; words: Set<string> }[],
	allowed: Set<string>
): boolean {
	const words = joinCompounds(sentence).match(/[\p{L}\p{N}]+/gu) ?? [];
	const lower = words.map((w) => w.toLowerCase());
	// Short content words count too, so a fact made of short words is still found by a negation check.
	const topics = new Set([
		...topicStems(lower.join(' ')),
		...lower.filter((w) => !FUNCTION_WORDS.has(w))
	]);
	const about = quoteStems.filter((q) => [...topics].some((t) => q.stems.has(t)));
	for (const [i, word] of words.entries()) {
		const w = lower[i];
		const known = quoteWords.has(canon(w)) || allowed.has(w);
		const number = /^\d+$/.test(w) || NUMBER_VALUES.has(w);
		const properNoun = i > 0 && /^\p{Lu}/u.test(word) && w !== 'i';
		if ((number || properNoun) && !known) return false;
		if (NEGATIONS.has(w) && about.length > 0 && !about.some((q) => q.words.has(w))) return false;
	}
	return true;
}

/**
 * Splits a paragraph into sentences.
 * @param paragraph Prose as the model wrote it.
 * @returns Trimmed, non-empty sentences.
 */
function sentencesOf(paragraph: string): string[] {
	return paragraph
		.split(/(?<=[.!?…])\s+/u)
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Drops sentences that add claims the verified facts do not support, then checks the story still
 * uses the facts and lists the sources it draws on.
 * @param inscription The stone's person.
 * @param candidate The confirmed candidate.
 * @param facts Verified facts the paragraph was written from.
 * @param paragraph The paragraph as the model wrote it.
 * @returns A told story, or `insufficient` when no real fact survives in it.
 */
export function groundParagraph(
	inscription: Inscription,
	candidate: Candidate,
	facts: VerifiedFact[],
	paragraph: string
): Story {
	if (!hasEvidence(inscription, candidate, facts)) return { status: 'insufficient' };
	const normed = facts.map((f) => norm(f.quote));
	const quoteWords = new Set(normed.flatMap((q) => q.split(' ').map(canon)));
	const quoteStems = normed.map((q) => ({
		stems: new Set(factTerms(q)),
		terms: factTerms(q),
		words: new Set(q.split(' '))
	}));
	const allowed = new Set([...nameTokens(inscription, candidate), ...MONTHS]);

	const seen = new Set<string>();
	const kept = sentencesOf(paragraph).filter((s) => {
		const key = norm(s);
		if (seen.has(key)) return false;
		seen.add(key);
		return sentenceHolds(s, quoteWords, quoteStems, allowed);
	});
	const body = kept.join(' ');

	const present = new Set(
		norm(body)
			.split(' ')
			.map((w) => canon(w).slice(0, STEM_LENGTH))
	);
	const used = facts.filter((f, i) => {
		const { terms } = quoteStems[i];
		return (
			terms.length > 0 && terms.filter((t) => present.has(t)).length / terms.length >= MIN_FACT_USE
		);
	});
	if (!hasEvidence(inscription, candidate, used)) return { status: 'insufficient' };
	const cited = new Set(used.map((f) => f.sourceId));
	return {
		status: 'told',
		paragraph: body,
		sources: candidate.sources.filter((s) => cited.has(s.id))
	};
}
