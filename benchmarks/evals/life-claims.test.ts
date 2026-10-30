import { describe, expect, it } from 'vitest';
import { auditClaims, claimsScore, type Claim } from './life-claims';

const context = [
	'Gaynor Hawks taught piano at Lincoln Elementary for forty years.',
	'My name was Gaynor Claire Hawks. I died September 3, 2017.'
];

/**
 * Builds a life claim.
 * @param evidence Quoted record text, or null.
 * @returns The claim.
 */
const life = (evidence: string | null): Claim => ({
	claim: 'taught piano',
	kind: 'life',
	evidence
});

describe('auditClaims', () => {
	it('accepts a life claim whose evidence appears in the records', () => {
		expect(auditClaims([life('taught piano at Lincoln Elementary')], context).unsupported).toEqual(
			[]
		);
	});

	it('ignores case, punctuation and quote style in the evidence', () => {
		expect(auditClaims([life('“TAUGHT piano,  at Lincoln”')], context).unsupported).toEqual([]);
	});

	it('matches evidence across a replacement character left by a bad page decode', () => {
		expect(
			auditClaims([life('moved to Downey in the 60s')], ['moved to Downey in the 60\uFFFDs.'])
				.unsupported
		).toEqual([]);
	});

	it('rejects a life claim with no evidence', () => {
		const claim = life(null);
		expect(auditClaims([claim], context).unsupported).toEqual([claim]);
	});

	it('rejects evidence the records do not contain, even when it sounds right', () => {
		const claim = life('taught piano for fifty years');
		expect(auditClaims([claim], context).unsupported).toEqual([claim]);
	});

	it('rejects evidence that matches only part of a word', () => {
		const claim = life('ears');
		expect(auditClaims([claim], context).unsupported).toEqual([claim]);
	});

	it('rejects evidence stitched across two records', () => {
		const claim = life('forty years My name was');
		expect(auditClaims([claim], context).unsupported).toEqual([claim]);
	});

	it('fails a claim the judge was unsure of, even with evidence', () => {
		const claim: Claim = { claim: 'taught piano', kind: 'unsure', evidence: 'taught piano' };
		expect(auditClaims([claim], context).unsupported).toEqual([claim]);
	});

	it('leaves atmosphere out of the audit', () => {
		const result = auditClaims(
			[{ claim: 'the night is cold', kind: 'atmosphere', evidence: null }],
			context
		);
		expect(result).toEqual({ checked: [], unsupported: [] });
	});
});

describe('claimsScore', () => {
	it('scores the share of checked claims the records back', () => {
		expect(
			claimsScore([life('taught piano at Lincoln Elementary'), life('sang opera')], context)
		).toBe(0.5);
	});

	it('passes a story that makes no life claims', () => {
		expect(
			claimsScore([{ claim: 'the night is cold', kind: 'atmosphere', evidence: null }], context)
		).toBe(1);
		expect(claimsScore([], context)).toBe(1);
	});
});
