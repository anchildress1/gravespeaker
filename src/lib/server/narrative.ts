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
/**
 * Builds a regex alternation of each word in lower, capitalized and upper case.
 * @param words Lowercase words.
 * @returns The alternation source, without a group.
 */
const spellings = (words: string[]): string =>
	words.flatMap((w) => [w, w[0].toUpperCase() + w.slice(1), w.toUpperCase()]).join('|');
const RELATIVE = spellings(RELATIVE_WORDS);
const POSSESSIVE = spellings(['her', 'his', 'their']);
// A name is a capital followed by letters in any case, so JOHN and John both count.
const NAME = String.raw`\p{Lu}[\p{L}'’-]+`;
const NAMED_RELATIVE = new RegExp(
	String.raw`\b(?:${RELATIVE})\b[^.;]{0,12}?${NAME}|${NAME},?\s+(?:${POSSESSIVE})\s+(?:${RELATIVE})\b`,
	'u'
);
const NAMED_RELATIVE_CASE = /\p{Lu}/u;
const MONTH_WORD = new RegExp(String.raw`\b(?:${[...MONTHS].join('|')})\b`, 'giu');
const PREDECEASED = /\b(predeceased|preceded (?:her |him |them )?in death)\b/i;

/** A fact whose quote was found verbatim in a cited source. */
export type VerifiedFact = RawFact;

/** A records-based story, or `insufficient` when the records hold nothing beyond the stone. */
export type Grounded = Extract<Story, { status: 'told' }> | { status: 'insufficient' };

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
 * Tells whether normalized text holds a phrase as whole words, so "married" is not found in "unmarried".
 * @param text Normalized text.
 * @param phrase Normalized phrase.
 * @returns True when the phrase appears with a word boundary at both ends.
 */
function containsPhrase(text: string, phrase: string): boolean {
	return ` ${text} `.includes(` ${phrase} `);
}

/**
 * Tells whether a quote names a relative who may still be alive.
 * @param quote Quote as written in the source.
 * @returns True for "her husband John" style quotes, unless the quote says the relative died first.
 */
function namesSurvivor(quote: string): boolean {
	// "May" and "March" are capitalized words that are not names.
	const bare = quote.replace(MONTH_WORD, ' ');
	return NAMED_RELATIVE_CASE.test(bare) && NAMED_RELATIVE.test(bare) && !PREDECEASED.test(bare);
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
 * Tells whether a word carries no biography of its own: a month, a number, a function word, or
 * wording that introduces a life date.
 * @param word Normalized word.
 * @returns True for filler.
 */
function isFiller(word: string): boolean {
	return (
		MONTHS.has(word) ||
		/^\d+$/.test(word) ||
		FUNCTION_WORDS.has(word) ||
		LIFE_MARKERS.has(word) ||
		ORDINAL.test(word)
	);
}

/**
 * Lists the words a fact is matched on: the topic stems of its content words, or the content words
 * themselves when none is long. Filler is left out, so "born March 10, 1932 in Alsea" is matched on
 * Alsea alone.
 * @param text Normalized fact quote.
 * @returns Stems to look for in the story.
 */
function factTerms(text: string): string[] {
	const words = text.split(' ').filter((w) => w && !isFiller(w));
	const stems = topicStems(words.join(' '));
	return stems.length > 0 ? stems : words.map(canon);
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
		if (!quote || !known.has(f.sourceId) || !containsPhrase(text.get(f.sourceId) ?? '', quote))
			return false;
		if (SURVIVORS.test(f.quote) || namesSurvivor(f.quote)) return false;
		if (seen.has(quote)) return false;
		seen.add(quote);
		return true;
	});
}

/**
 * Tokens of the person's own name, which a story may use without a quote.
 * @param inscription The stone's person.
 * @param candidate The confirmed candidate, when there is one.
 * @returns Normalized name tokens.
 */
function nameTokens(inscription: Inscription, candidate?: Candidate): Set<string> {
	return new Set(
		[inscription.name, candidate?.name ?? '', inscription.maidenName ?? '']
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
			.some((t) => !names.has(t) && !isFiller(t))
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
 * Keeps the sentences that add nothing the quotes lack, dropping repeats.
 * @param paragraph Prose as the model wrote it.
 * @param quotes Normalized quotes the prose may draw on.
 * @param allowed Name and month tokens that need no quote.
 * @returns Kept sentences in order.
 */
function keptSentences(paragraph: string, quotes: string[], allowed: Set<string>): string[] {
	const quoteWords = new Set(quotes.flatMap((q) => q.split(' ').map(canon)));
	const quoteStems = quotes.map((q) => ({
		stems: new Set(factTerms(q)),
		words: new Set(q.split(' '))
	}));
	const seen = new Set<string>();
	return sentencesOf(paragraph).filter((s) => {
		const key = norm(s);
		if (seen.has(key)) return false;
		seen.add(key);
		return sentenceHolds(s, quoteWords, quoteStems, allowed);
	});
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
): Grounded {
	if (!hasEvidence(inscription, candidate, facts)) return { status: 'insufficient' };
	const normed = facts.map((f) => norm(f.quote));
	const allowed = new Set([...nameTokens(inscription, candidate), ...MONTHS]);
	const body = keptSentences(paragraph, normed, allowed).join(' ');

	const present = new Set(
		norm(body)
			.split(' ')
			.map((w) => canon(w).slice(0, STEM_LENGTH))
	);
	const used = facts.filter((f, i) => {
		const terms = factTerms(normed[i]);
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

/**
 * Drops sentences of a stone-only story that add claims the stone does not make.
 * @param inscription The stone's person.
 * @param facts Sentences stating what the stone says.
 * @param paragraph The paragraph as the model wrote it.
 * @returns The grounded paragraph, or null when no sentence survives.
 */
export function groundStone(
	inscription: Inscription,
	facts: string[],
	paragraph: string
): string | null {
	const allowed = new Set([...nameTokens(inscription), ...MONTHS]);
	const body = keptSentences(paragraph, facts.map(norm), allowed).join(' ');
	return body || null;
}
