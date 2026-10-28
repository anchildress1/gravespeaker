import type { Candidate, Inscription, Story, StorySentence } from '#lib/types.ts';
import type { PageText, RawSentence } from './inference/index.ts';

/** A single word is label debris ("reconstruction:"), not a theatrical line. */
const MIN_THEATRE_WORDS = 2;

const MONTHS = new Set([
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december',
	'jan',
	'feb',
	'mar',
	'apr',
	'jun',
	'jul',
	'aug',
	'sep',
	'sept',
	'oct',
	'nov',
	'dec'
]);

// Spelled-out numbers compare equal to their digits, so "forty" and "40" support each other.
const NUMBER_VALUES: Record<string, string> = Object.fromEntries(
	(
		'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen ' +
		'sixteen seventeen eighteen nineteen twenty'
	)
		.split(' ')
		.map((w, i) => [w, String(i + 1)])
		.concat(
			Object.entries({
				thirty: '30',
				forty: '40',
				fifty: '50',
				sixty: '60',
				seventy: '70',
				eighty: '80',
				ninety: '90',
				hundred: '100',
				thousand: '1000'
			})
		)
);

// Pronouns, auxiliaries and connectives the ghost voice swaps freely; they carry no claim.
const STOPWORDS = new Set(
	(
		'that this with from have were been they them their there then than when what where which ' +
		'while your mine myself into over also very just once upon would could should about after ' +
		'before still shall will does done being those these such each both only own'
	).split(' ')
);

// Words shorter than this are filler ("the", "was", "my"); only longer words count as claims.
const MIN_CONTENT_LENGTH = 4;
// Negations flip a claim, so one the quote does not contain is never allowed.
const NEGATIONS = new Set('not never none nobody neither nor without cannot'.split(' '));
// Compare word stems so "preceded"/"preceding" match without a stemmer dependency.
const STEM_LENGTH = 4;

/**
 * Lowercases and collapses everything except letters and digits to single spaces.
 * @param s Text to normalize.
 * @returns Normalized text.
 */
function norm(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

/**
 * Maps a spelled-out number to its digits; any other word is returned unchanged.
 * @param word Lowercase word.
 * @returns Digits for a number word, else the word.
 */
function canon(word: string): string {
	return NUMBER_VALUES[word] ?? word;
}

/**
 * Whether a theatrical line is the model's own label rather than a line to perform.
 * @param text Reconstruction sentence.
 * @returns True for one-word lines, trailing-colon labels and "reconstruction ..." prefixes.
 */
function isLabelDebris(text: string): boolean {
	const t = text.trim();
	return (
		t.split(/\s+/).length < MIN_THEATRE_WORDS || t.endsWith(':') || /^\W*reconstruction\b/i.test(t)
	);
}

/**
 * Checks that a fact sentence only restates its quote: no new number, proper noun or negation, and
 * every claim word comes from the quote in the same order.
 * @param sentence The sentence as the model wrote it.
 * @param quote The normalized quote cited for it.
 * @param allowed Normalized name and month tokens that may appear without being quoted.
 * @returns True when the quote supports the sentence.
 */
function supportsSentence(sentence: string, quote: string, allowed: Set<string>): boolean {
	const quoteWords = quote.split(' ');
	const quoted = new Set(quoteWords.map(canon));
	const stems = quoteWords.map((w) => canon(w).slice(0, STEM_LENGTH));
	const words = sentence.match(/[\p{L}\p{N}]+/gu) ?? [];

	let content = 0;
	let next = 0;
	for (const [i, word] of words.entries()) {
		const w = word.toLowerCase();
		const properNoun =
			/^\p{Lu}/u.test(word) && (i > 0 || (w.length >= MIN_CONTENT_LENGTH && !STOPWORDS.has(w)));
		const strict = /^\d+$/.test(w) || w in NUMBER_VALUES || NEGATIONS.has(w) || properNoun;
		if (strict && w !== 'i' && !quoted.has(canon(w)) && !allowed.has(w)) return false;
		if (w.length < MIN_CONTENT_LENGTH || STOPWORDS.has(w)) continue;
		content++;
		// Reordering can reverse who did what to whom, so claim words must follow the quote's order.
		const at = stems.indexOf(canon(w).slice(0, STEM_LENGTH), next);
		if (at >= 0) next = at + 1;
		else if (!allowed.has(w)) return false;
	}
	return content > 0;
}

/**
 * Keeps only sentences that cite real sources with quotes found in them, then applies the evidence bar.
 * @param inscription The stone's person.
 * @param candidate The confirmed candidate.
 * @param pages Text of each source as the model saw it.
 * @param raw Sentences as the model returned them.
 * @returns A told story, or `insufficient` when no fact beyond name and dates survives.
 */
export function groundStory(
	inscription: Inscription,
	candidate: Candidate,
	pages: PageText[],
	raw: RawSentence[]
): Story {
	const known = new Set(candidate.sources.map((s) => s.id));
	const text = new Map(pages.map((p) => [p.sourceId, norm(p.text)]));
	const nameTokens = new Set(
		[inscription.name, candidate.name, inscription.maidenName ?? '']
			.flatMap((n) => norm(n).split(' '))
			.filter(Boolean)
	);

	const allowed = new Set([...nameTokens, ...MONTHS]);

	const sentences: StorySentence[] = [];
	let evidence = false;
	for (const s of raw) {
		if (s.kind === 'reconstruction') {
			// The model sometimes emits its own labels ("reconstruction:") as a sentence.
			if (isLabelDebris(s.text)) continue;
			sentences.push({ text: s.text, kind: 'reconstruction', sourceIds: [] });
			continue;
		}
		const quote = norm(s.quote ?? '');
		const grounded =
			s.sourceIds.length > 0 &&
			s.sourceIds.every((id) => known.has(id)) &&
			quote !== '' &&
			s.sourceIds.some((id) => text.get(id)?.includes(quote)) &&
			supportsSentence(s.text, quote, allowed);
		if (!grounded) continue;
		sentences.push({ text: s.text, kind: 'fact', sourceIds: s.sourceIds });
		if (
			s.claim === 'other' &&
			quote.split(' ').some((t) => !nameTokens.has(t) && !MONTHS.has(t) && !/^\d+$/.test(t))
		)
			evidence = true;
	}
	if (!evidence) return { status: 'insufficient' };
	const cited = new Set(sentences.flatMap((s) => s.sourceIds));
	return {
		status: 'told',
		sentences,
		sources: candidate.sources.filter((s) => cited.has(s.id))
	};
}
