import { PARTIAL_DATE } from '#lib/types.ts';
import type { Inscription } from '#lib/types.ts';
import type { RawPerson } from './inference/index.ts';

const HONORIFIC = /^(?:mr|mrs|miss|dr)\.?(?=\s)/i;
const MAIDEN = /\b(?:née|nee)\s+(\S+)/iu;

/**
 * Keeps a date only if it is `YYYY` or `YYYY-MM-DD` with `?` for unreadable digits.
 * @param value Date as the model returned it.
 * @returns The date, or null.
 */
function date(value: string | null | undefined): string | null {
	return value && PARTIAL_DATE.test(value) ? value : null;
}

/**
 * Turns model output into inscriptions: drops letterless names, strips honorifics, splits `née`, validates dates.
 * @param raw People as the model returned them.
 * @returns Normalized people; empty when no name is legible.
 */
export function normalizeInscriptions(raw: RawPerson[]): Inscription[] {
	const people: Inscription[] = [];
	for (const p of raw) {
		if (!/\p{L}/u.test(p.name ?? '')) continue;
		const carvedName = p.name.trim();
		const maidenName = MAIDEN.exec(carvedName)?.[1] ?? null;
		const name = carvedName.replace(MAIDEN, '').replace(HONORIFIC, '').replace(/\s+/g, ' ').trim();
		people.push({ carvedName, name, maidenName, born: date(p.born), died: date(p.died) });
	}
	return people;
}
