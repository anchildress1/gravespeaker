import type { Candidate, Inscription, Story, StorySentence } from '#lib/types.ts';
import type { PageText, RawSentence } from './inference/index.ts';

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

	const sentences: StorySentence[] = [];
	let evidence = false;
	for (const s of raw) {
		if (s.kind === 'reconstruction') {
			sentences.push({ text: s.text, kind: 'reconstruction', sourceIds: [] });
			continue;
		}
		const quote = norm(s.quote ?? '');
		const grounded =
			s.sourceIds.length > 0 &&
			s.sourceIds.every((id) => known.has(id)) &&
			quote !== '' &&
			s.sourceIds.some((id) => text.get(id)?.includes(quote));
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
