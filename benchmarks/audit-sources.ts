// Usage: node benchmarks/audit-sources.ts [benchmarks/results/research-N.json]
// Lists every search result each person's research run saw, from the saved SerpApi responses, with
// what the identity engine did with it and why. Saves benchmarks/results/sources-N.json. `own` marks
// a people.json case's reviewed memorial, the one result known to be the stone's person.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pageEvidence, resolveMatches } from '../src/lib/server/identity.ts';
import { dropGated } from '../src/lib/server/search/sites.ts';
import { canonicalUrl } from '../src/lib/server/search/url.ts';
import type { Candidate, Inscription, SourceRecord } from '../src/lib/types.ts';
import { hopFile, newestRun, RESULTS, SAVED } from './runs.ts';

interface Row {
	file: string;
	inscription: Inscription;
	searches: string[];
	candidates: Candidate[];
}

const VERDICTS = [
	'kept',
	'gated site',
	'no name or another initial',
	'date against stone',
	'weaker than a dated match',
	'over the source or candidate cap'
] as const;
type Verdict = (typeof VERDICTS)[number];

const GOOGLE = 'https://www.google.com';

const runFile = process.argv[2] ?? `${RESULTS}/research-${newestRun('research')}.json`;
const run = JSON.parse(readFileSync(runFile, 'utf8')) as {
	meta: { missing: string[]; failed?: number };
	rows: Row[];
};
// A search never replayed would read as "never returned".
if (run.meta.missing.length) throw new Error(`${runFile} ran without saved searches`);
if (run.meta.failed) throw new Error(`${runFile} lost ${run.meta.failed} people to errors`);

const responses = new Map<string, { body?: { organic_results?: Record<string, string>[] } }>();
for (const f of readdirSync(SAVED).filter((x) => !x.startsWith('goto-'))) {
	const saved = JSON.parse(readFileSync(`${SAVED}/${f}`, 'utf8'));
	responses.set(`${saved.engine}: ${saved.query}`, saved);
}
const truth = new Map<string, string>(
	JSON.parse(readFileSync('fixtures/people.json', 'utf8')).map(
		(p: { file: string; source: string }) => [p.file, canonicalUrl(p.source)]
	)
);
const pages = new Map<string, string | null>(
	JSON.parse(readFileSync('fixtures/stories-recorded.json', 'utf8')).flatMap(
		(c: { pages: Record<string, string | null> }) => Object.entries(c.pages)
	)
);

/**
 * Resolves a result link to its page, from the saved hop for a Google redirect.
 * @param link Result link.
 * @returns The page it leads to, or null.
 */
function page(link = ''): string | null {
	const url = URL.parse(link, GOOGLE);
	if (!url) return null;
	// The provider's rule: any link on Google's own origin is a hop.
	if (url.origin !== GOOGLE) return link;
	const file = hopFile(url.href);
	return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).location : null;
}

const people = run.rows.map((row) => {
	const ins = row.inscription;
	const kept = new Set(row.candidates.flatMap((c) => c.sources.map((s) => canonicalUrl(s.url))));
	const dated = row.candidates.some((c) => c.confidence !== 'low');
	const hits = new Map<string, SourceRecord & { search: string }>();
	for (const search of new Set(row.searches)) {
		const saved = responses.get(search);
		if (!saved) throw new Error(`No saved response for ${search}`);
		for (const r of saved.body?.organic_results ?? []) {
			const url = page(r.link);
			const key = url && canonicalUrl(url);
			if (!key || hits.has(key)) continue;
			const site = URL.parse(url)!.hostname;
			hits.set(key, { id: '', url, title: r.title ?? '', site, snippet: r.snippet ?? '', search });
		}
	}
	const results = [...hits.entries()].map(([key, hit]) => {
		const alone = resolveMatches(ins, [hit])[0];
		const undated = resolveMatches({ ...ins, born: null, died: null }, [hit]).length > 0;
		let verdict: Verdict = 'kept';
		if (!kept.has(key)) {
			if (!dropGated([hit]).length) verdict = 'gated site';
			else if (!alone) verdict = undated ? 'date against stone' : 'no name or another initial';
			else if (dated && alone.confidence === 'low') verdict = 'weaker than a dated match';
			else verdict = 'over the source or candidate cap';
		}
		const text = pages.get(hit.url);
		return {
			url: hit.url,
			search: hit.search.split(':')[0],
			query: hit.search.slice(hit.search.indexOf(':') + 2),
			title: hit.title,
			snippet: hit.snippet,
			grade: alone?.confidence ?? null,
			verdict,
			// What the fetched page proves, for kept results only: the story fetches nothing else.
			page:
				text === undefined
					? null
					: text === null
						? 'unreadable'
						: (pageEvidence(ins, text).grade ?? 'against or unnamed'),
			own: truth.get(row.file) === key
		};
	});
	return { file: row.file, name: ins.name, born: ins.born, died: ins.died, results };
});

const out = `${RESULTS}/sources-${newestRun('sources') + 1}.json`;
writeFileSync(out, `${JSON.stringify({ run: runFile, people }, null, '\t')}\n`);

const all = people.flatMap((p) => p.results);
/**
 * Counts results.
 * @param pick Which results to count.
 * @returns How many match.
 */
const count = (pick: (r: (typeof all)[number]) => boolean) => all.filter(pick).length;
console.log(`${out}: ${all.length} results for ${people.length} people from ${runFile}`);
for (const v of VERDICTS) console.log(`  ${v.padEnd(32)} ${count((r) => r.verdict === v)}`);
for (const p of people.filter((x) => truth.has(x.file))) {
	const own = p.results.find((r) => r.own);
	console.log(
		`  own memorial, ${p.name.padEnd(30)} ${own ? `${own.verdict} (${own.search})` : 'never returned'}`
	);
}
