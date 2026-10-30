// Usage: node --env-file=.env benchmarks/search.ts <out.json> [--no-place] [fixture-file ...]
// Runs the real multi-engine search and the deterministic engine for each stone's answer key
// (no photo, no model call). The output file is rewritten after every stone, so a stopped run
// still leaves proof. Never overwrite an earlier run: pass a new file name.
import { execSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { buildQuery, dropGated, resolveMatches } from '../src/lib/server/identity.ts';
import { ENGINES } from '../src/lib/server/search/engines.ts';
import { canonicalUrl } from '../src/lib/server/search/url.ts';

interface Person {
	name: string;
	born: string | null;
	died: string | null;
}

interface Hit {
	link: string;
	title: string;
	snippet: string;
}

interface EngineRun {
	engine: string;
	ms: number;
	results: number;
	error?: string;
}

const [outFile, ...args] = process.argv.slice(2);
// --no-place runs the same stones without the town, as the baseline for the place signal.
const withPlace = !args.includes('--no-place');
const files = args.filter((a) => a !== '--no-place');
const key = process.env.SERPAPI_API_KEY ?? '';
// Spread across eras, name commonness and difficulty when no files are named.
const DEFAULT_FILES = [
	'chambers-2011.jpg',
	'hawks-2017.jpg',
	'mills-2015.jpg',
	'dixon-2018.jpg',
	'luxford-2015.jpg',
	'gonzalez-2021.jpg',
	'guo-2025.jpg',
	'bell-1994.jpg',
	'hayden-1993.jpg',
	'doran-2008.jpg'
];
const wanted = files.length ? files : DEFAULT_FILES;

/**
 * Reads SerpApi's account counters.
 * @returns Searches used this month and left.
 */
async function credits(): Promise<{ used: number; left: number }> {
	const body = (await (await fetch(`https://serpapi.com/account?api_key=${key}`)).json()) as {
		this_month_usage: number;
		total_searches_left: number;
	};
	return { used: body.this_month_usage, left: body.total_searches_left };
}

/**
 * Runs one engine and keeps its raw organic results.
 * @param e Engine settings.
 * @param query Search query.
 * @returns The engine run and its hits.
 */
async function runEngine(
	e: (typeof ENGINES)[number],
	query: string
): Promise<{ run: EngineRun; hits: Hit[] }> {
	const url = new URL('https://serpapi.com/search.json');
	url.search = new URLSearchParams({
		engine: e.engine,
		[e.queryParam]: query,
		...e.extra,
		api_key: key
	}).toString();
	const t0 = performance.now();
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
		const body = (await res.json()) as { organic_results?: Hit[]; error?: string };
		const empty = body.error?.includes("hasn't returned any results");
		if ((!res.ok || body.error) && !empty) throw new Error(body.error ?? `HTTP ${res.status}`);
		const hits = (body.organic_results ?? []).map((r) => ({
			link: r.link ?? '',
			title: r.title ?? '',
			snippet: r.snippet ?? ''
		}));
		return {
			run: { engine: e.engine, ms: Math.round(performance.now() - t0), results: hits.length },
			hits
		};
	} catch (err) {
		return {
			run: {
				engine: e.engine,
				ms: Math.round(performance.now() - t0),
				results: 0,
				error: (err as Error).message
			},
			hits: []
		};
	}
}

/**
 * Median of a list.
 * @param xs Numbers.
 * @returns The median, or 0 for an empty list.
 */
function median(xs: number[]): number {
	if (!xs.length) return 0;
	const s = [...xs].sort((a, b) => a - b);
	const m = Math.floor(s.length / 2);
	return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const manifest: { file: string; place: string | null; people: Person[] }[] = JSON.parse(
	await readFile(new URL('../fixtures/manifest.json', import.meta.url), 'utf8')
);
const before = await credits();
const meta = {
	startedAt: new Date().toISOString(),
	commit: execSync('git rev-parse --short HEAD').toString().trim(),
	dirty: execSync('git status --porcelain src').toString().trim() !== '',
	node: process.version,
	engines: ENGINES.map((e) => e.engine),
	creditsBefore: before,
	withPlace
};
const rows: unknown[] = [];
const wall0 = performance.now();

for (const file of wanted) {
	const fixture = manifest.find((f) => f.file === file);
	if (!fixture) {
		console.error(`${file}: not in the manifest`);
		continue;
	}
	for (const person of fixture.people) {
		const inscription = {
			carvedName: person.name,
			name: person.name,
			maidenName: null,
			born: person.born,
			died: person.died,
			voice: null,
			place: withPlace ? fixture.place : null
		};
		const query = buildQuery(inscription);
		const t0 = performance.now();
		const runs = await Promise.all(ENGINES.map((e) => runEngine(e, query)));
		const searchMs = Math.round(performance.now() - t0);
		// Merge in engine order and dedupe by URL, keeping which engines returned each page.
		const seen = new Map<string, { id: string; hit: Hit; engines: string[] }>();
		for (const [i, r] of runs.entries()) {
			for (const hit of r.hits) {
				const k = canonicalUrl(hit.link);
				if (!k) continue;
				const found = seen.get(k);
				if (found) found.engines.push(ENGINES[i].engine);
				else seen.set(k, { id: `s${seen.size + 1}`, hit, engines: [ENGINES[i].engine] });
			}
		}
		const merged = [...seen.values()];
		const records = dropGated(
			merged.map((m) => ({
				id: m.id,
				url: m.hit.link,
				title: m.hit.title,
				site: new URL(m.hit.link).hostname,
				snippet: m.hit.snippet
			}))
		);
		const candidates = resolveMatches(inscription, records).map((c) => ({
			confidence: c.confidence,
			born: c.born,
			died: c.died,
			sources: c.sources.map((s) => ({
				url: s.url,
				title: s.title,
				snippet: s.snippet,
				engines: seen.get(canonicalUrl(s.url)!)?.engines ?? []
			}))
		}));
		const row = {
			file,
			person,
			query,
			searchMs,
			engines: runs.map((r) => r.run),
			mergedResults: merged.length,
			afterGatedFilter: records.length,
			candidates
		};
		rows.push(row);
		await writeFile(outFile, JSON.stringify({ meta, partial: true, rows }, null, 2));
		console.error(
			`${file.padEnd(20)} ${searchMs}ms  engines ${runs.map((r) => `${r.run.engine}:${r.run.error ? 'ERR' : r.run.results}`).join(' ')}  merged ${merged.length}  -> ${candidates.map((c) => `${c.confidence}/${c.sources.length}`).join(', ') || 'no candidate'}`
		);
	}
}

const after = await credits();
type Row = {
	engines: EngineRun[];
	searchMs: number;
	candidates: { confidence: string; sources: { engines: string[] }[] }[];
};
const typed = rows as Row[];
const summary = {
	stones: typed.length,
	wallMs: Math.round(performance.now() - wall0),
	medianSearchMs: median(typed.map((r) => r.searchMs)),
	creditsUsed: after.used - before.used,
	creditsLeft: after.left,
	withCandidate: typed.filter((r) => r.candidates.length).length,
	byConfidence: Object.fromEntries(
		['high', 'medium', 'low'].map((k) => [
			k,
			typed.filter((r) => r.candidates[0]?.confidence === k).length
		])
	),
	perEngine: ENGINES.map((e) => {
		const runs = typed.map((r) => r.engines.find((x) => x.engine === e.engine)!);
		return {
			engine: e.engine,
			failures: runs.filter((r) => r.error).length,
			medianMs: median(runs.map((r) => r.ms)),
			results: runs.reduce((a, r) => a + r.results, 0),
			sourcesKept: typed.reduce(
				(a, r) =>
					a +
					r.candidates.reduce(
						(b, c) => b + c.sources.filter((s) => s.engines.includes(e.engine)).length,
						0
					),
				0
			)
		};
	})
};
await writeFile(
	outFile,
	JSON.stringify(
		{ meta: { ...meta, finishedAt: new Date().toISOString(), creditsAfter: after }, summary, rows },
		null,
		2
	)
);
console.log(JSON.stringify(summary, null, 2));
