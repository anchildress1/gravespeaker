import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { PARTIAL_DATE, VOICES } from '#lib/types.ts';
import type { Candidate, Inscription } from '#lib/types.ts';
import { runFailure } from './http.ts';
import { buildQuery, dropGated, resolveMatches } from './identity.ts';
import { search } from './search/serpapi.ts';

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

/**
 * Runs one search and keeps the records that match the stone.
 * @param inscription The stone's person; its place, when set, goes into the query.
 * @returns Candidates, possibly empty.
 */
async function lookUp(inscription: Inscription): Promise<Candidate[]> {
	return resolveMatches(inscription, dropGated(await search.search(buildQuery(inscription))));
}

/**
 * Tells whether any candidate matched more than the name.
 * @param candidates Resolved candidates.
 * @returns True when one is high or medium confidence.
 */
const dated = (candidates: Candidate[]) => candidates.some((c) => c.confidence !== 'low');

const searchStep = createStep({
	id: 'search',
	inputSchema: inscriptionSchema,
	outputSchema: candidatesSchema,
	retries: 2,
	execute: async ({ inputData }) => {
		// The town finds people a bare name misses, but it also strips dates from records a bare
		// name already matched, so it only runs when the bare search finds nobody dated.
		const plain = await lookUp({ ...inputData, place: null });
		if (!inputData.place || dated(plain)) return { candidates: plain };
		const near = await lookUp(inputData);
		return { candidates: dated(near) ? near : plain };
	}
});

const researchWorkflow = createWorkflow({
	id: 'research',
	inputSchema: inscriptionSchema,
	outputSchema: candidatesSchema
})
	.then(searchStep)
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
