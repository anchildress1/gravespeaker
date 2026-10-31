import type { Inscription } from '../../src/lib/types.ts';

/**
 * Reads the whole year out of a stone date.
 * @param date Partial date as normalized, e.g. `1943-07-11`, `1943` or `19?3`.
 * @returns The year, or null when absent or not fully legible.
 */
function year(date: string | null): number | null {
	const y = date?.slice(0, 4) ?? '';
	return /^\d{4}$/.test(y) ? Number(y) : null;
}

/**
 * Finds years in a story that fall outside the life the stone records.
 * @param paragraph The story as told.
 * @param inscription The stone's person.
 * @param today Current date; a number past this year is a house number, not a year.
 * @returns Offending years, in order of appearance.
 */
export function yearsOutsideLife(
	paragraph: string,
	inscription: Inscription,
	today = new Date()
): number[] {
	// The stone is the one source known to be about this person: a year outside its life means the
	// records describe someone else.
	const born = year(inscription.born) ?? -Infinity;
	const died = year(inscription.died) ?? Infinity;
	return [...paragraph.matchAll(/\b\d{4}\b/g)]
		.map((m) => Number(m[0]))
		.filter((y) => y <= today.getUTCFullYear() && (y < born || y > died));
}

/**
 * States the age at death the stone's dates prove, so a story may call the life long or short.
 * @param inscription The stone's person.
 * @returns A sentence, or null when either year is missing or not fully legible.
 */
export function ageAtDeath(inscription: Inscription): string | null {
	const born = year(inscription.born);
	const died = year(inscription.died);
	if (born === null || died === null) return null;
	// Without both full, legible dates the birthday may not have come yet in the year of death.
	const exact = [inscription.born, inscription.died].every((d) => /^\d{4}-\d\d-\d\d$/.test(d!));
	const age =
		died - born - Number(exact && inscription.died!.slice(5) < inscription.born!.slice(5));
	return exact ? `I died at ${age} years old.` : `I died at about ${age} years old.`;
}
