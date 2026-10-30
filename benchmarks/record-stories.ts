// Usage: node benchmarks/record-stories.ts [benchmarks/results/research-N.json]
// Freezes story inputs for the evals from a research benchmark run (the newest by default), so no
// search is sent: every candidate comes from SerpApi responses saved in fixtures/serp. Writes each
// person's candidates with the text of their sources to fixtures/stories-recorded.json. A page saved
// by an earlier recording is reused; only new pages are fetched, or every page with REFETCH=1.
// Labels start unreviewed: `match` is null until the user sets the index of the candidate who is
// the person on the stone, or -1 when none is. `match` survives only while its candidates are
// unchanged; `reviewed` always resets. A page that could not be fetched is tried again.
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchPage } from '../src/lib/server/pages.ts';
import type { Candidate, Inscription, Voice } from '../src/lib/types.ts';
import { newestRun, RESULTS } from './runs.ts';

interface Row {
	file: string;
	person: { voice: Voice };
	inscription: Inscription;
	candidates: Candidate[];
}

interface StoryCase {
	file: string;
	inscription: Inscription;
	candidates: Candidate[];
	pages: Record<string, string | null>;
	match: number | null;
	reviewed: false;
	voice: Voice;
}

const OUT = 'fixtures/stories-recorded.json';
const runFile = process.argv[2] ?? `${RESULTS}/research-${newestRun('research')}.json`;
const run = JSON.parse(readFileSync(runFile, 'utf8')) as {
	meta: { missing: string[]; failed?: number };
	rows: Row[];
};
if (run.meta.missing.length) throw new Error(`${runFile} ran without saved searches`);
if (run.meta.failed) throw new Error(`${runFile} lost ${run.meta.failed} people to errors`);

const earlier = JSON.parse(readFileSync(OUT, 'utf8')) as StoryCase[];
const saved = new Map(
	process.env.REFETCH === '1' ? [] : earlier.flatMap((c) => Object.entries(c.pages))
);
/**
 * Keys a case by its fixture and person.
 * @param c A recorded case or research row.
 * @param c.file Fixture file.
 * @param c.inscription The person.
 * @returns The key.
 */
const key = (c: { file: string; inscription: Inscription }) =>
	`${c.file}|${c.inscription.carvedName}`;
const labels = new Map(earlier.map((c) => [key(c), c]));

const cases: StoryCase[] = [];
for (const row of run.rows) {
	const urls = [...new Set(row.candidates.flatMap((c) => c.sources.map((s) => s.url)))];
	const pages = Object.fromEntries(
		await Promise.all(urls.map(async (u) => [u, saved.get(u) ?? (await fetchPage(u))] as const))
	);
	const before = labels.get(key(row));
	const same = JSON.stringify(before?.candidates) === JSON.stringify(row.candidates);
	cases.push({
		file: row.file,
		inscription: row.inscription,
		candidates: row.candidates,
		pages,
		match: same ? (before?.match ?? null) : null,
		reviewed: false,
		voice: row.person.voice
	});
	console.error(
		`${row.inscription.name.padEnd(32)} ${row.candidates.length} candidates, ${urls.length} pages`
	);
}
writeFileSync(OUT, `${JSON.stringify(cases, null, '\t')}\n`);
console.error(`${OUT}: ${cases.length} cases from ${runFile}`);
