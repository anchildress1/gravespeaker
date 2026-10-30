import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';

export const RESULTS = 'benchmarks/results';
export const SAVED = 'fixtures/serp';

/**
 * Finds the highest run number saved under a result prefix.
 * @param prefix File prefix such as "research".
 * @returns The number, or 0 when none is saved.
 */
export function newestRun(prefix: string): number {
	const pattern = new RegExp(`^${prefix}-(\\d+)\\.json$`);
	return Math.max(
		0,
		...readdirSync(RESULTS)
			.map((f) => pattern.exec(f)?.[1])
			.filter(Boolean)
			.map(Number)
	);
}

/**
 * Names the saved file for one Google redirect hop.
 * @param href The redirect URL.
 * @returns Its path under fixtures/serp.
 */
export function hopFile(href: string): string {
	return `${SAVED}/goto-${createHash('sha256').update(href).digest('hex').slice(0, 16)}.json`;
}
