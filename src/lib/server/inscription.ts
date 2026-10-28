import { partialDateOrNull } from '#lib/types.ts';
import type { Inscription } from '#lib/types.ts';
import type { RawPerson } from './inference/index.ts';

const HONORIFIC = /^(?:mr|mrs|miss|dr)\.?(?=\s)/i;
const MAIDEN = /\b(?:née|nee)\s+(\S+)/iu;

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
		people.push({
			carvedName,
			name,
			maidenName,
			born: partialDateOrNull(p.born),
			died: partialDateOrNull(p.died)
		});
	}
	return people;
}
