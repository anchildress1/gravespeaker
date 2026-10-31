// Live eval: tells a story for every case on the real model and judges it. Page fetches replay the
// fixtures, so only the model calls are live. Run with `pnpm eval benchmarks/evals/story.eval.ts`.
// - stories-written.json: hand-written records that bait specific failures, always the right person.
// - stories-recorded.json: real search results; the story is told about the top match, as in the app.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { epitaph } from '../../src/lib/epitaph.ts';
import { runStoneStory, runStory } from '../../src/lib/server/story.ts';
import type { Candidate, Inscription, Voice } from '../../src/lib/types.ts';
import { lifeClaimsScorer } from './life-claims.ts';
import { ageAtDeath, yearsOutsideLife } from './stone-years.ts';

interface StoryCase {
	inscription: Inscription;
	candidates: Candidate[];
	pages: Record<string, string | null>;
	/** The narrator the person should get, whatever the name suggests. */
	voice: Voice;
	/** Hand-written stories that check the graders: `good` must pass, `bad` must fail. */
	good?: string;
	bad?: string;
}

// Hoisted above the imports, so node:fs is reached without one.
const { sets, env } = vi.hoisted(() => {
	const { readFileSync } = process.getBuiltinModule('node:fs');
	process.loadEnvFile('.env');
	/**
	 * Reads one fixture set.
	 * @param path Fixture file, relative to the repo root.
	 * @returns Its cases.
	 */
	const load = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as StoryCase[];
	return {
		sets: {
			written: load('fixtures/stories-written.json'),
			recorded: load('fixtures/stories-recorded.json')
		},
		env: { GEMINI_API_KEY: process.env.GEMINI_API_KEY }
	};
});
vi.mock('$app/env/private', () => env);
vi.mock('../../src/lib/server/pages.ts', () => ({
	fetchPage: async (url: string) =>
		[...sets.written, ...sets.recorded].find((c) => url in c.pages)?.pages[url] ?? null
}));

const scorer = lifeClaimsScorer(env.GEMINI_API_KEY ?? '');
const timings: number[] = [];
// Trial outcomes per set and person, for pass@1 (share of trials) and pass^3 (every trial).
const trials = new Map<string, Map<string, boolean[]>>();
// Narrator picks per set, kept apart from story trials so a wrong voice does not hide in them.
const voices = new Map<string, boolean[]>();
// The story model samples at temperature 1, so one passing draw proves little. A case passes only
// when every draw does.
const SAMPLES = 3;

/**
 * Runs both graders on one paragraph.
 * @param c The case.
 * @param paragraph The story to grade.
 * @param fromRecords Whether the story was told from the candidate's records or the stone alone.
 * @returns Years outside the stone's life, the judge's score, and its reasons.
 */
async function grade(
	c: StoryCase,
	paragraph: string,
	fromRecords: boolean
): Promise<{ years: number[]; score: number; reason: string }> {
	const age = ageAtDeath(c.inscription);
	const stone = [...epitaph(c.inscription, new Date()), ...(age ? [age] : [])];
	// Every source of the candidate counts, not just those cited: a true claim is never a failure.
	const records = fromRecords
		? c.candidates[0].sources.map((s) => c.pages[s.url] ?? s.snippet)
		: [];
	const result = await scorer.run({
		input: { subject: c.inscription.name, context: [...stone, ...records] },
		output: paragraph
	});
	return {
		years: yearsOutsideLife(paragraph, c.inscription),
		// A run the scorer could not score counts as a failure.
		score: result.score ?? 0,
		reason: result.reason ?? ''
	};
}

describe.each(Object.entries(sets))('%s stories', (set, cases) => {
	it.each(cases.filter((c) => c.good && c.bad).map((c) => [c.inscription.name, c] as const))(
		'%s: graders pass the good reference and fail the bad one',
		async (_, c) => {
			const good = await grade(c, c.good!, c.candidates.length > 0);
			expect.soft(good, `good reference\n${good.reason}`).toMatchObject({ years: [], score: 1 });
			const bad = await grade(c, c.bad!, c.candidates.length > 0);
			expect.soft(bad.score, `bad reference\n${bad.reason}`).toBeLessThan(1);
		},
		120_000
	);

	it.each(
		cases.flatMap((c) =>
			Array.from({ length: SAMPLES }, (_, i) => [c.inscription.name, i + 1, c] as const)
		)
	)(
		'%s #%i: every life claim is in the records and fits the stone',
		async (name, __, c) => {
			const candidate = c.candidates.at(0);
			const t0 = performance.now();
			const story = candidate
				? await runStory(c.inscription, candidate)
				: await runStoneStory(c.inscription);
			timings.push(performance.now() - t0);

			expect(story.paragraph, 'the story must always be told').toBeTruthy();
			const { years, score, reason } = await grade(
				c,
				story.paragraph ?? '',
				story.status === 'told'
			);
			const byName = trials.get(set) ?? new Map<string, boolean[]>();
			trials.set(
				set,
				byName.set(name, [...(byName.get(name) ?? []), !years.length && score === 1])
			);
			voices.set(set, [...(voices.get(set) ?? []), story.voice === c.voice]);
			expect.soft(story.voice, 'narrator voice').toBe(c.voice);
			expect.soft(years, `years outside the stone's life\n${story.paragraph}`).toEqual([]);
			expect.soft(score, `${story.paragraph}\n\n${reason}`).toBe(1);
		},
		180_000
	);
});

afterAll(() => {
	const s = [...timings].sort((a, b) => a - b);
	console.log(`story median ${Math.round(s[Math.floor(s.length / 2)] ?? 0)} ms over ${s.length}`);
	for (const [set, byName] of trials) {
		const all = [...byName.values()];
		const passed = all.flat().filter(Boolean).length;
		const picks = voices.get(set) ?? [];
		console.log(`${set}: voice ${picks.filter(Boolean).length}/${picks.length}`);
		console.log(
			`${set}: pass@1 ${passed}/${all.flat().length}, pass^${SAMPLES} ${all.filter((t) => t.every(Boolean)).length}/${all.length}`
		);
	}
});
