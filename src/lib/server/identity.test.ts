import { describe, expect, it } from 'vitest';
import { buildQuery, dropGated, resolveMatches } from './identity';
import type { Inscription, SourceRecord } from '#lib/types.ts';
import type { RawMatch } from './inference/index';

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
 * Test helper.
 * @param id Test input.
 * @param site Test input.
 * @returns The fixture.
 */
const rec = (id: string, site = 'legacy.com'): SourceRecord => ({
	id,
	url: `https://${site}/${id}`,
	title: id,
	site,
	snippet: 'Gaynor Hawks 1932 2017'
});
/**
 * Builds a picked match, defaulting to one that agrees with the stone.
 * @param over Fields to override.
 * @returns The match.
 */
const pick = (over: Partial<RawMatch> = {}): RawMatch => ({
	id: 's1',
	born: '1932',
	died: '2017',
	place: null,
	confidence: 'high',
	...over
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
			].map((s, i) => rec(`s${i}`, s))
		);
		expect(kept.map((r) => r.site)).toEqual(['legacy.com', 'findagrave.com']);
	});
});

describe('resolveMatches', () => {
	const records = [rec('s1'), rec('s2'), rec('s3')];

	it('returns no candidate when nothing was picked', () => {
		expect(resolveMatches(stone(), records, [])).toEqual([]);
	});

	it("returns one candidate for the stone's person, built from the picked results", () => {
		const out = resolveMatches(stone(), records, [pick({ id: 's1' }), pick({ id: 's3' })]);
		expect(out).toHaveLength(1);
		expect(out[0].name).toBe('Gaynor Claire Hawks');
		expect(out[0].sources.map((s) => s.id)).toEqual(['s1', 's3']);
	});

	it('ignores picks of results that do not exist and repeated picks', () => {
		const out = resolveMatches(stone(), records, [pick({ id: 'zz' }), pick(), pick()]);
		expect(out[0].sources.map((s) => s.id)).toEqual(['s1']);
		expect(resolveMatches(stone(), records, [pick({ id: 'zz' })])).toEqual([]);
	});

	it('drops hits that never mention the surname, even if the model picked them', () => {
		const unrelated = { ...rec('s9'), title: 'Cemetery index', snippet: 'Smith, Jones' };
		expect(resolveMatches(stone(), [...records, unrelated], [pick({ id: 's9' })])).toEqual([]);
	});

	it('uses the surname before a generational suffix when matching hits', () => {
		const junior = stone({ name: 'Edward Hildebrand III', carvedName: 'Edward Hildebrand III' });
		const hit = { ...rec('s1'), snippet: 'Edward Hildebrand obituary 1932 2017' };
		expect(resolveMatches(junior, [hit], [pick()])).toHaveLength(1);
	});

	it('drops a pick whose stated years conflict with the stone', () => {
		expect(resolveMatches(stone(), records, [pick({ died: '2016' })])).toEqual([]);
		expect(resolveMatches(stone(), records, [pick({ born: '1950' })])).toEqual([]);
	});

	it('keeps the agreeing pick when another pick conflicts', () => {
		const out = resolveMatches(stone(), records, [
			pick({ id: 's1' }),
			pick({ id: 's2', died: '1990' })
		]);
		expect(out[0].sources.map((s) => s.id)).toEqual(['s1']);
	});

	it('treats ? in the inscription as a wildcard', () => {
		const worn = stone({ born: '18?8', died: null });
		for (const born of ['1818', '1848']) {
			expect(resolveMatches(worn, records, [pick({ born, died: null })])).toHaveLength(1);
		}
		expect(resolveMatches(worn, records, [pick({ born: '1749', died: null })])).toEqual([]);
	});

	it('never conflicts on null years', () => {
		expect(resolveMatches(stone(), records, [pick({ born: null, died: null })])).toHaveLength(1);
	});

	it('keeps a date only when the picked result states it', () => {
		const bare = { ...rec('s1'), snippet: 'Gaynor Hawks, Alsea Cemetery' };
		const [c] = resolveMatches(stone(), [bare], [pick()]);
		expect(c.born).toBeNull();
		expect(c.died).toBeNull();
		const [stated] = resolveMatches(stone(), records, [pick()]);
		expect(stated.born).toBe('1932');
		expect(stated.died).toBe('2017');
	});

	it('nulls malformed dates instead of trusting them', () => {
		const [c] = resolveMatches(stone(), records, [pick({ born: 'March 1932', died: null })]);
		expect(c.born).toBeNull();
	});

	it('takes the place from the first pick that gives one', () => {
		const out = resolveMatches(stone(), records, [
			pick({ id: 's1' }),
			pick({ id: 's2', place: ' Alsea, Oregon ' })
		]);
		expect(out[0].place).toBe('Alsea, Oregon');
	});

	it('gives the best confidence among the picks', () => {
		const out = resolveMatches(stone(), records, [
			pick({ id: 's1', confidence: 'low' }),
			pick({ id: 's2', confidence: 'medium' })
		]);
		expect(out[0].confidence).toBe('medium');
	});

	it('caps high confidence at medium when no picked result states a year', () => {
		const bare = { ...rec('s1'), snippet: 'Gaynor Hawks, Alsea Cemetery' };
		const [c] = resolveMatches(stone(), [bare], [pick({ confidence: 'high' })]);
		expect(c.confidence).toBe('medium');
	});

	it('keeps high confidence when a picked result states a matching year', () => {
		const [c] = resolveMatches(stone(), records, [pick({ confidence: 'high' })]);
		expect(c.confidence).toBe('high');
	});
});
