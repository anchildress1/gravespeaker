import type { Candidate, Inscription, Story, StorySentence } from '#lib/types.ts';
import type { PageText, RawSentence } from './inference/index.ts';

/** Fewer words than this is label debris, not a theatrical line. */
const MIN_THEATRE_WORDS = 3;

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

const NUMBER_WORDS = new Set(
	(
		'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen ' +
		'sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety ' +
		'hundred thousand'
	).split(' ')
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
// Flair may replace some words, but at least this share of claim words must come from the quote.
const MIN_CONTENT_OVERLAP = 0.5;
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
 * Checks that a fact sentence adds no number, proper noun or mostly-new content beyond its quote.
 * @param sentence The sentence as the model wrote it.
 * @param quote The normalized quote cited for it.
 * @param allowed Normalized name and month tokens that may appear without being quoted.
 * @returns True when the quote supports the sentence.
 */
function supportsSentence(sentence: string, quote: string, allowed: Set<string>): boolean {
	const quoted = new Set(quote.split(' '));
	const stems = new Set([...quoted].map((w) => w.slice(0, STEM_LENGTH)));
	const words = sentence.match(/[\p{L}\p{N}]+/gu) ?? [];

	let content = 0;
	let matched = 0;
	for (const [i, word] of words.entries()) {
		const w = word.toLowerCase();
		const strict = /^\d+$/.test(w) || NUMBER_WORDS.has(w) || (i > 0 && /^\p{Lu}/u.test(word));
		if (strict && w !== 'i' && !quoted.has(w) && !allowed.has(w)) return false;
		if (w.length < MIN_CONTENT_LENGTH || STOPWORDS.has(w)) continue;
		content++;
		if (stems.has(w.slice(0, STEM_LENGTH))) matched++;
	}
	return content > 0 && matched / content >= MIN_CONTENT_OVERLAP;
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
			if (s.text.trim().split(/\s+/).length < MIN_THEATRE_WORDS) continue;
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
