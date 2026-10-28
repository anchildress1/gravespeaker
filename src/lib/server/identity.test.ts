import { describe, expect, it } from 'vitest';
import { buildQuery, dropGated, resolveCandidates } from './identity';
import type { Inscription, SourceRecord } from '#lib/types.ts';
import type { RawCandidate } from './inference/index';

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
 * Test helper.
 * @param over Test input.
 * @returns The fixture.
 */
const cand = (over: Partial<RawCandidate>): RawCandidate => ({
	name: 'Gaynor Claire Hawks',
	born: '1932',
	died: '2017',
	place: null,
	resultIds: ['s1'],
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

describe('resolveCandidates', () => {
	const records = [rec('s1'), rec('s2'), rec('s3')];

	it('drops unknown result ids and candidates left empty', () => {
		const out = resolveCandidates(stone(), records, [cand({ resultIds: ['zz'] })]);
		expect(out).toEqual([]);
	});

	it('removes a result claimed by two candidates from both', () => {
		const out = resolveCandidates(stone(), records, [
			cand({ resultIds: ['s1', 's2'] }),
			cand({ name: 'G Hawks', resultIds: ['s2', 's3'] })
		]);
		expect(out.map((c) => c.sources.map((s) => s.id))).toEqual([['s1'], ['s3']]);
	});

	it('drops hits that never mention the surname, even if the model attached them', () => {
		const unrelated = { ...rec('s9'), title: 'Cemetery index', snippet: 'Smith, Jones' };
		const out = resolveCandidates(stone(), [...records, unrelated], [cand({ resultIds: ['s9'] })]);
		expect(out).toEqual([]);
	});

	it('drops a candidate whose death year conflicts', () => {
		expect(resolveCandidates(stone(), records, [cand({ died: '2016' })])).toEqual([]);
	});

	it('treats ? in the inscription as a wildcard', () => {
		const s = stone({ born: '18?8', died: null });
		for (const born of ['1818', '1848']) {
			expect(resolveCandidates(s, records, [cand({ born, died: null })])).toHaveLength(1);
		}
		expect(resolveCandidates(s, records, [cand({ born: '1749', died: null })])).toEqual([]);
	});

	it('never conflicts on null years', () => {
		expect(resolveCandidates(stone(), records, [cand({ born: null, died: null })])).toHaveLength(1);
	});

	it('nulls a date no source states, even when it matches the stone', () => {
		const bare = { ...rec('s1'), snippet: 'Gaynor Hawks, Alsea Cemetery' };
		const [c] = resolveCandidates(stone(), [bare], [cand({})]);
		expect(c).toMatchObject({ born: null, died: null });
	});

	it('nulls malformed dates instead of trusting them', () => {
		const [c] = resolveCandidates(stone(), records, [cand({ born: 'March 1932', died: null })]);
		expect(c.born).toBeNull();
	});

	it('caps at 5, best match first', () => {
		const many = Array.from({ length: 7 }, (_, i) => rec(`s${i + 1}`));
		const raw = many.map((r, i) =>
			cand({ name: `Person ${i}`, born: i === 6 ? '1932' : null, died: null, resultIds: [r.id] })
		);
		const out = resolveCandidates(stone(), many, raw);
		expect(out).toHaveLength(5);
		expect(out[0].name).toBe('Person 6');
	});
});
