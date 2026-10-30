import { describe, expect, it } from 'vitest';
import { dropGated } from './sites';
import type { SourceRecord } from '#lib/types.ts';

/**
 * Builds a search hit on one site.
 * @param site Hostname.
 * @returns The record.
 */
const hit = (site: string): SourceRecord => ({
	id: site,
	url: `https://${site}/x`,
	title: 'x',
	site,
	snippet: ''
});

describe('dropGated', () => {
	it('removes paywalled genealogy hosts and keeps open ones', () => {
		const kept = dropGated(
			[
				'ancestry.com',
				'www.newspapers.com',
				'search.findmypast.co.uk',
				'legacy.com',
				'findagrave.com'
			].map(hit)
		);
		expect(kept.map((r) => r.site)).toEqual(['legacy.com', 'findagrave.com']);
	});

	it('removes people-search directories, which list the living and never prove a death', () => {
		const kept = dropGated(
			[
				'www.whitepages.com',
				'www.truepeoplesearch.com',
				'www.beenverified.com',
				'www.411.com',
				'www.192.com',
				'ufind.name',
				'www.spokeo.com',
				'www.fastpeoplesearch.com',
				'www.legacy.com'
			].map(hit)
		);
		expect(kept.map((r) => r.site)).toEqual(['www.legacy.com']);
	});

	it('keeps a host that only ends in a blocked name', () => {
		const kept = dropGated(['notwhitepages.com', 'myancestry.org'].map(hit));
		expect(kept.map((r) => r.site)).toEqual(['notwhitepages.com', 'myancestry.org']);
	});
});
