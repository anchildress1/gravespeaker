import type { Inscription } from './types.ts';

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];

/**
 * Formats a fully known date as a sentence fragment.
 * @param date `YYYY` or `YYYY-MM-DD` without `?`.
 * @returns `in YYYY` or `on Month D, YYYY`.
 */
function phrase(date: string): string {
	if (date.length === 4) return `in ${date}`;
	const [y, m, d] = date.split('-').map(Number);
	return `on ${MONTHS[m - 1]} ${d}, ${y}`;
}

/**
 * Phrases how long the person has been buried.
 * @param years Whole years since death.
 * @returns A first-person sentence.
 */
function tenure(years: number): string {
	if (years < 1) return "I've been here less than a year.";
	return `I've been here ${years} ${years === 1 ? 'year' : 'years'}.`;
}

/**
 * Builds the stone-only epitaph. No model involved.
 * @param inscription The person on the stone.
 * @param today Current date, injected for determinism.
 * @returns Sentences in reading order.
 */
export function epitaph(inscription: Inscription, today: Date): string[] {
	const sentences = [`My name was ${inscription.name}.`];
	const { born, died } = inscription;
	if (born && !born.includes('?')) sentences.push(`I was born ${phrase(born)}.`);
	if (died && !died.includes('?')) {
		sentences.push(`I died ${phrase(died)}.`);
		const diedAt = died.length === 4 ? new Date(Date.UTC(+died, 11, 31)) : new Date(died);
		let years = today.getUTCFullYear() - diedAt.getUTCFullYear();
		if (
			died.length > 4 &&
			today.getTime() < Date.UTC(today.getUTCFullYear(), diedAt.getUTCMonth(), diedAt.getUTCDate())
		) {
			years -= 1;
		}
		sentences.push(tenure(years));
	}
	return sentences;
}
