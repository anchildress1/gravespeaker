import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { PARTIAL_DATE, VOICES } from '#lib/types.ts';
import type { Candidate, Inscription, SourceRecord } from '#lib/types.ts';
import { ProviderError, runFailure } from './http.ts';
import { resolveMatches } from './identity.ts';
import { searchQueries } from './query.ts';
import type { SearchHit } from './search/index.ts';
import { search } from './search/serpapi.ts';
import { dropGated } from './search/sites.ts';
import { canonicalUrl } from './search/url.ts';

export const confidenceSchema = z.enum(['high', 'medium', 'low']);

export const partialDate = z.string().regex(PARTIAL_DATE);

export const inscriptionSchema = z.object({
	carvedName: z.string(),
	name: z.string().min(1),
	maidenName: z.string().nullable(),
	born: partialDate.nullable(),
	died: partialDate.nullable(),
	voice: z.enum(VOICES).nullable(),
	place: z.string().max(120).nullable()
});

export const sourceSchema = z.object({
	id: z.string(),
	url: z.string().regex(/^https?:\/\//i),
	title: z.string(),
	site: z.string(),
	snippet: z.string()
});

export const candidateSchema = z.object({
	name: z.string(),
	born: partialDate.nullable(),
	died: partialDate.nullable(),
	confidence: confidenceSchema,
	sources: z.array(sourceSchema)
});

const candidatesSchema = z.object({ candidates: z.array(candidateSchema) });

const RETRIES = 2;

// `step` is the query's place in the research order.
const attemptSchema = z.object({ query: z.string(), engine: z.string(), step: z.number() });
// Where a page first turned up: its query's step, and its rank in that search's results.
const foundSchema = sourceSchema.extend({ step: z.number(), rank: z.number() });
type Found = z.infer<typeof foundSchema>;
const searchStateSchema = z.object({
	inscription: inscriptionSchema,
	pending: z.array(attemptSchema),
	// Searches failed in a row, and the last failure's message.
	streak: z.number(),
	error: z.string().nullable(),
	records: z.array(foundSchema),
	candidates: z.array(candidateSchema)
});
type SearchState = z.infer<typeof searchStateSchema>;

/**
 * Tells whether any candidate matched more than the name.
 * @param candidates Resolved candidates.
 * @returns True when one is high or medium confidence.
 */
const dated = (candidates: Candidate[]) => candidates.some((c) => c.confidence !== 'low');

/**
 * Tells whether search is down rather than missing: every engine failed its latest search in a row.
 * @param state The loop's state.
 * @returns True once as many searches as there are engines have failed in a row.
 */
const outage = (state: SearchState) => state.streak >= search.engines.length;

/**
 * Adds hits to the records found so far, numbering new pages and folding a repeat page's snippet into
 * its record.
 * @param records Records found so far.
 * @param hits New hits in rank order.
 * @param step The step of the query that ran the search.
 * @returns The combined records.
 */
function addHits(records: Found[], hits: SearchHit[], step: number): Found[] {
	const out = [...records];
	for (const [rank, hit] of hits.entries()) {
		const key = canonicalUrl(hit.url);
		const i = out.findIndex((r) => canonicalUrl(r.url) === key);
		if (i < 0) out.push({ id: `s${out.length + 1}`, ...hit, step, rank });
		// Another query can show the same page with the dates in its snippet.
		else if (!out[i].snippet.includes(hit.snippet))
			out[i] = { ...out[i], snippet: `${out[i].snippet} … ${hit.snippet}` };
	}
	return out;
}

/**
 * Orders records so every search's best results come before any search's next ones.
 * @param records Records found so far.
 * @returns Records without step and rank, interleaved by rank across searches.
 */
function interleave(records: Found[]): SourceRecord[] {
	// Matching keeps the first five sources per candidate, so one query's results must not crowd
	// out every later query's best.
	return [...records]
		.sort((a, b) => a.rank - b.rank || a.step - b.step)
		.map((r) => sourceSchema.parse(r));
}

const planStep = createStep({
	id: 'plan',
	inputSchema: inscriptionSchema,
	outputSchema: searchStateSchema,
	execute: ({ inputData }) =>
		Promise.resolve({
			inscription: inputData,
			// Each query tries the first engine, and the next only when that one misses.
			pending: searchQueries(inputData).flatMap((query, step) =>
				search.engines.map((engine) => ({ query, engine, step }))
			),
			streak: 0,
			error: null,
			records: [],
			candidates: []
		})
});

const searchStep = createStep({
	id: 'search',
	inputSchema: searchStateSchema,
	outputSchema: searchStateSchema,
	retries: RETRIES,
	execute: async ({ inputData, retryCount }): Promise<SearchState> => {
		const [next, ...pending] = inputData.pending;
		let hits: SearchHit[] = [];
		let error: string | null = null;
		try {
			hits = await search.search(next.query, next.engine);
		} catch (e) {
			// Mastra retries the step first; an engine still failing after that counts as a miss.
			if (retryCount < RETRIES) throw e;
			error = e instanceof Error ? e.message : String(e);
		}
		const records = addHits(inputData.records, hits, next.step);
		return {
			...inputData,
			pending,
			streak: error === null ? 0 : inputData.streak + 1,
			error: error ?? inputData.error,
			records,
			candidates: resolveMatches(inputData.inscription, dropGated(interleave(records)))
		};
	}
});

const resolveStep = createStep({
	id: 'resolve',
	inputSchema: searchStateSchema,
	outputSchema: candidatesSchema,
	execute: ({ inputData }) => {
		if (outage(inputData)) {
			throw new ProviderError('Search failed on every engine', { cause: inputData.error });
		}
		return Promise.resolve({ candidates: inputData.candidates });
	}
});

const researchWorkflow = createWorkflow({
	id: 'research',
	inputSchema: inscriptionSchema,
	outputSchema: candidatesSchema
})
	.then(planStep)
	// Stop at the first dated match: every further search costs a SerpApi credit.
	.dountil(
		searchStep,
		async ({ inputData: s }) => dated(s.candidates) || !s.pending.length || outage(s)
	)
	.then(resolveStep)
	.commit();

/**
 * Searches for records about a stone's person and keeps the ones that match.
 * @param inscription The stone's person.
 * @returns Candidates, possibly empty.
 * @throws {ProviderError} When search fails after retries.
 */
export async function runResearch(inscription: Inscription): Promise<Candidate[]> {
	const run = await researchWorkflow.createRun();
	const result = await run.start({ inputData: inscription });
	if (result.status !== 'success') {
		throw runFailure('Research', result.status === 'failed' ? result.error : undefined);
	}
	return result.result.candidates;
}
