import { describe, expect, it } from 'vitest';
import { buildQuery, searchQueries } from './query';
import type { Inscription } from '#lib/types.ts';

/**
 * Test helper.
 * @param over Test input.
 * @returns The fixture.
 */
const stone = (over: Partial<Inscription> = {}): Inscription => ({
	carvedName: 'Gaynor Claire Hawks',
	name: 'Gaynor Claire Hawks',
	maidenName: null,
	place: null,
	born: '1932-03-10',
	died: '2017-12-27',
	voice: 'female',
	...over
});
describe('buildQuery', () => {
	it('uses the name and both years, without death keywords', () => {
		expect(buildQuery(stone())).toBe('"Gaynor Claire Hawks" 1932 2017');
	});

	it('writes a year once for a stone born and dead in the same year', () => {
		expect(buildQuery(stone({ born: '2019-11-29', died: '2019-12-02' }))).toBe(
			'"Gaynor Claire Hawks" 2019'
		);
	});

	it('omits a year with an unreadable digit', () => {
		expect(buildQuery(stone({ born: '18?8' }))).toBe('"Gaynor Claire Hawks" 2017');
	});

	it('leaves a quoted nickname out of the exact-name query', () => {
		const nick = stone({ name: 'Corwin "Cory" Garner Chambers' });
		expect(buildQuery(nick)).toContain('"Corwin Garner Chambers"');
	});

	it('adds the place without punctuation or quotes', () => {
		expect(buildQuery(stone({ place: 'Alsea, Oregon' }))).toBe(
			'"Gaynor Claire Hawks" 1932 2017 alsea oregon'
		);
	});

	it('keeps a place from closing the quoted name or adding operators', () => {
		expect(buildQuery(stone({ place: '"Westfield" (Mass.) OR site:x' }))).toBe(
			'"Gaynor Claire Hawks" 1932 2017 westfield mass or site x'
		);
	});

	it('ignores the maiden name', () => {
		expect(buildQuery(stone({ maidenName: 'Staples' }))).toBe(buildQuery(stone()));
	});
});

describe('searchQueries', () => {
	const town = 'Eugene, Oregon';
	const records = '(obituary OR grave OR cemetery)';

	it('tries each query without death keywords, then with them', () => {
		expect(searchQueries(stone({ place: town }))).toEqual([
			'"Gaynor Claire Hawks" 1932 2017',
			`"Gaynor Claire Hawks" 1932 2017 ${records}`,
			'"Gaynor Claire Hawks" 1932 2017 eugene oregon',
			`"Gaynor Claire Hawks" 1932 2017 eugene oregon ${records}`,
			'"Gaynor Claire Hawks" eugene oregon',
			`"Gaynor Claire Hawks" eugene oregon ${records}`
		]);
	});

	it('searches name and dates alone when no town is known', () => {
		expect(searchQueries(stone())).toEqual([
			'"Gaynor Claire Hawks" 1932 2017',
			`"Gaynor Claire Hawks" 1932 2017 ${records}`
		]);
	});

	it('skips a query that repeats an earlier one', () => {
		expect(searchQueries(stone({ born: null, died: null, place: town }))).toEqual([
			'"Gaynor Claire Hawks"',
			`"Gaynor Claire Hawks" ${records}`,
			'"Gaynor Claire Hawks" eugene oregon',
			`"Gaynor Claire Hawks" eugene oregon ${records}`
		]);
	});
});
