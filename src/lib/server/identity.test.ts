import { describe, expect, it } from 'vitest';
import { buildQuery, dropGated, resolveMatches } from './identity';
import type { Inscription, SourceRecord } from '#lib/types.ts';

/**
 * Test helper.
 * @param over Test input.
 * @returns The fixture.
 */
const stone = (over: Partial<Inscription> = {}): Inscription => ({
	carvedName: 'Gaynor Claire Hawks',
	name: 'Gaynor Claire Hawks',
	maidenName: null,
	born: '1932-03-10',
	died: '2017-12-27',
	...over
});
/**
 * Builds a search result.
 * @param snippet Result snippet text.
 * @param title Result title.
 * @param id Result id.
 * @returns The record.
 */
const rec = (snippet: string, title = 'Obituary', id = 'x'): SourceRecord => ({
	id,
	url: `https://legacy.com/${id}`,
	title,
	site: 'legacy.com',
	snippet
});

describe('buildQuery', () => {
	it('uses the name, both years and the record terms', () => {
		expect(buildQuery(stone())).toBe(
			'"Gaynor Claire Hawks" 1932 2017 (obituary OR grave OR cemetery)'
		);
	});

	it('omits a year with an unreadable digit', () => {
		expect(buildQuery(stone({ born: '18?8' }))).toBe(
			'"Gaynor Claire Hawks" 2017 (obituary OR grave OR cemetery)'
		);
	});

	it('leaves a quoted nickname out of the exact-name query', () => {
		const nick = stone({ name: 'Corwin "Cory" Garner Chambers' });
		expect(buildQuery(nick)).toContain('"Corwin Garner Chambers"');
	});

	it('ignores the maiden name', () => {
		expect(buildQuery(stone({ maidenName: 'Staples' }))).toBe(buildQuery(stone()));
	});
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
			].map((s) => ({ ...rec('', 'x', s), site: s }))
		);
		expect(kept.map((r) => r.site)).toEqual(['legacy.com', 'findagrave.com']);
	});
});

describe('resolveMatches', () => {
	/**
	 * Resolves records against the default stone.
	 * @param records Search results.
	 * @param over Stone fields to override.
	 * @returns The candidates.
	 */
	const resolve = (records: SourceRecord[], over: Partial<Inscription> = {}) =>
		resolveMatches(stone(over), records);

	it('returns nothing when no result names the person', () => {
		expect(resolve([rec('Cemetery index of the county, 1932 to 2017.')])).toEqual([]);
		expect(resolve([])).toEqual([]);
	});

	it('returns the right person when only the birth is stated and the death is missing', () => {
		const [c] = resolve([rec('Gaynor Hawks, born March 10, 1932, taught piano in Alsea.')]);
		expect(c.sources).toHaveLength(1);
		expect(c.confidence).toBe('medium');
		expect(c.born).toBe('1932');
		expect(c.died).toBeNull();
	});

	it('returns the right person when only the death is stated', () => {
		const [c] = resolve([rec('Gaynor Claire Hawks died December 27, 2017 at home.')]);
		expect(c.confidence).toBe('medium');
		expect(c.died).toBe('2017');
	});

	it('rates a name plus both years high', () => {
		const [c] = resolve([rec('Gaynor Claire Hawks (1932-2017) - Find a Grave memorial')]);
		expect(c.confidence).toBe('high');
		expect([c.born, c.died]).toEqual(['1932', '2017']);
	});

	it('derives the birth year from a stated age', () => {
		const [c] = resolve([rec('Gaynor Hawks, age 85, died December 27, 2017.')]);
		expect(c.confidence).toBe('high');
	});

	it('keeps a name-only result at low confidence instead of discarding it', () => {
		const [c] = resolve([rec('Gaynor Hawks was a beloved piano teacher in Alsea.')]);
		expect(c.confidence).toBe('low');
		expect(c.sources).toHaveLength(1);
		expect([c.born, c.died]).toEqual([null, null]);
	});

	it('drops name-only results once a stronger result exists', () => {
		const out = resolve([
			rec('Gaynor Hawks was a beloved piano teacher.', 'A', 'a'),
			rec('Gaynor Hawks, born 1932, of Alsea.', 'B', 'b')
		]);
		expect(out[0].sources.map((s) => s.id)).toEqual(['b']);
	});

	it('excludes a result whose stated death year conflicts', () => {
		expect(resolve([rec('Gaynor Hawks (1932-2016) obituary')])).toEqual([]);
		expect(resolve([rec('Gaynor Hawks, born 1950, died 2017')])).toEqual([]);
	});

	it('excludes a namesake with different dates but keeps the real match', () => {
		const out = resolve([
			rec('Gaynor Hawks (1901-1970) memorial', 'Other', 'o'),
			rec('Gaynor Hawks (1932-2017) memorial', 'Real', 'r')
		]);
		expect(out[0].sources.map((s) => s.id)).toEqual(['r']);
	});

	it('does not match a different given name with the same surname', () => {
		expect(resolve([rec('Charles Hawks (1932-2017) obituary')])).toEqual([]);
	});

	it('matches the surname as a whole word, not inside a longer name', () => {
		expect(resolve([rec('Gaynor Hawksworth (1932-2017)')])).toEqual([]);
	});

	it('accepts a middle name or initial in place of the full given names', () => {
		expect(resolve([rec('Claire Hawks (1932-2017)')])).toHaveLength(1);
		expect(resolve([rec('Gaynor C. Hawks (1932-2017)')])).toHaveLength(1);
	});

	it('uses the maiden name when the stone carries one', () => {
		const record = rec('Gaynor Staples (1932-2017), later Hawks');
		expect(resolve([record], { maidenName: 'Staples' })).toHaveLength(1);
	});

	it('ignores generational suffixes on the stone', () => {
		const junior = { name: 'Edward Hildebrand III', carvedName: 'Edward Hildebrand III' };
		expect(resolve([rec('Edward Hildebrand (1932-2017)')], junior)).toHaveLength(1);
	});

	it('folds accents when comparing names', () => {
		const norse = { name: 'Ødegård Sæther', carvedName: 'Ødegård Sæther' };
		expect(resolve([rec('Odegard Saether (1932-2017)')], norse)).toHaveLength(1);
	});

	it('treats ? in a stone year as a wildcard', () => {
		const worn = { name: 'Betsey Ellis', carvedName: 'Betsey Ellis', born: '18?8', died: null };
		const [c] = resolve([rec('Betsey Ellis (1818-1850) memorial')], worn);
		expect(c.confidence).toBe('high');
		expect(resolve([rec('Betsey Ellis (1749-1800)')], worn)).toEqual([]);
	});

	it('never conflicts on a date the stone does not carry', () => {
		const bornOnly = { born: '1932-03-10', died: null };
		expect(resolve([rec('Gaynor Hawks, born 1932, died 1999')], bornOnly)).toHaveLength(1);
	});

	it('rates name-only low when the stone carries no dates', () => {
		const bare = { born: null, died: null };
		expect(resolve([rec('Gaynor Hawks, piano teacher')], bare)[0].confidence).toBe('low');
	});

	it('ignores years that sit far from the name, where another person is likely meant', () => {
		const far = rec(
			`Gaynor Hawks taught piano. ${'Local history notes. '.repeat(30)} Howard Hawks (1896-1977).`
		);
		expect(resolve([far])[0].confidence).toBe('low');
	});

	it('keeps at most five sources, best first', () => {
		const many = Array.from({ length: 7 }, (_, i) =>
			rec(i === 6 ? 'Gaynor Hawks (1932-2017)' : 'Gaynor Hawks, piano teacher', 'R', `s${i}`)
		);
		const [c] = resolve(many);
		expect(c.sources).toHaveLength(1);
		const weak = Array.from({ length: 7 }, (_, i) =>
			rec('Gaynor Hawks, piano teacher', 'R', `w${i}`)
		);
		expect(resolve(weak)[0].sources).toHaveLength(5);
	});

	it('puts record-like pages ahead of other name-only results', () => {
		const out = resolve([
			rec('Gaynor Hawks plays tennis.', 'Profile', 'tennis'),
			rec('Gaynor Hawks obituary and funeral service.', 'Obituary', 'obit')
		]);
		expect(out[0].sources[0].id).toBe('obit');
	});

	it('keeps two people with different dates as separate candidates instead of merging them', () => {
		const worn = { name: 'John Smith', carvedName: 'John Smith', born: '19?8', died: null };
		const out = resolve(
			[
				rec('John Smith (1938-2011) obituary', 'A', 'a'),
				rec('John Smith (1948-2015) obituary', 'B', 'b')
			],
			worn
		);
		expect(out).toHaveLength(2);
		const ids = out.map((c) => c.sources.map((s) => s.id));
		expect(ids.flat().sort()).toEqual(['a', 'b']);
		expect(ids.every((i) => i.length === 1)).toBe(true);
	});

	it('merges results that agree with each other into one candidate', () => {
		const out = resolve([
			rec('Gaynor Hawks (1932-2017) memorial', 'A', 'a'),
			rec('Gaynor Hawks, born 1932, died December 2017', 'B', 'b')
		]);
		expect(out).toHaveLength(1);
		expect(out[0].sources).toHaveLength(2);
	});

	it('splits name-only results that state conflicting years for a stone with no dates', () => {
		const bare = { born: null, died: null };
		const out = resolve(
			[rec('Gaynor Hawks, died 1980', 'A', 'a'), rec('Gaynor Hawks, died 2005', 'B', 'b')],
			bare
		);
		expect(out).toHaveLength(2);
	});

	it('returns at most three candidates', () => {
		const worn = { name: 'John Smith', carvedName: 'John Smith', born: '19??', died: null };
		const many = ['1931', '1942', '1953', '1964', '1975'].map((y, i) =>
			rec(`John Smith (${y}-2020)`, 'R', `s${i}`)
		);
		expect(resolve(many, worn)).toHaveLength(3);
	});

	it('accepts a quoted nickname as a given name', () => {
		const nick = {
			name: 'Corwin "Cory" Garner Chambers',
			carvedName: 'Corwin "Cory" Garner Chambers'
		};
		expect(resolve([rec('Cory Chambers (1932-2017) obituary')], nick)).toHaveLength(1);
	});
});
