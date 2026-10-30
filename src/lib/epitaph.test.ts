import { describe, expect, it } from 'vitest';
import { epitaph } from './epitaph';
import type { Inscription } from './types';

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
const today = new Date('2026-10-31');

describe('epitaph', () => {
	it('gives the name, birth, death and years for full dates', () => {
		const lines = epitaph(stone(), today);
		expect(lines).toHaveLength(4);
		expect(lines[0]).toContain('Gaynor Claire Hawks');
		expect(lines[1]).toMatch(/1932/);
		expect(lines[2]).toMatch(/2017/);
		expect(lines[3]).toMatch(/\b8\b/);
	});

	it('gives only the year for a year-only birth', () => {
		const lines = epitaph(stone({ born: '1932' }), today);
		expect(lines[1]).toMatch(/1932/);
		expect(lines[1]).not.toMatch(/\b10\b/);
	});

	it('omits the death and years lines when a died digit is unreadable', () => {
		expect(epitaph(stone({ died: '18?8' }), today)).toHaveLength(2);
	});

	it('omits the birth line when born is unknown', () => {
		expect(epitaph(stone({ born: null }), today)).toHaveLength(3);
	});

	it('gives no number of years for a death under a year ago', () => {
		const lines = epitaph(stone({ died: '2026-06-01' }), today);
		expect(lines.at(-1)).not.toMatch(/\d/);
	});

	it('uses the singular at exactly one year', () => {
		const tenure = epitaph(stone({ died: '2025-10-31' }), today).at(-1)!;
		expect(tenure).toMatch(/\b1\b/);
		expect(tenure).not.toMatch(/years/);
	});

	it('counts a year-only death by calendar year', () => {
		expect(epitaph(stone({ died: '2011' }), today).at(-1)).toMatch(/\b15\b/);
	});
});
