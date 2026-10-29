/**
 * Shows a date, or says plainly that it is unknown.
 * @param date Partial ISO date, or null when nothing states it.
 * @returns The date, or "unknown".
 */
export function shownDate(date: string | null): string {
	return date ?? 'unknown';
}

/**
 * Shows a birth-to-death range.
 * @param person Anything with birth and death dates.
 * @param person.born Birth date, or null.
 * @param person.died Death date, or null.
 * @returns "born to died", with unknown ends spelled out.
 */
export function lifespan({ born, died }: { born: string | null; died: string | null }): string {
	return `${shownDate(born)} to ${shownDate(died)}`;
}
