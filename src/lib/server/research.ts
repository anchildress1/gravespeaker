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
	voice: z.enum(VOICES).nullable()
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

const withRecords = z.object({ inscription: inscriptionSchema, records: z.array(sourceSchema) });

const searchStep = createStep({
	id: 'search',
	inputSchema: inscriptionSchema,
	outputSchema: withRecords,
	retries: 2,
	execute: async ({ inputData }) => ({
		inscription: inputData,
		records: dropGated(await search.search(buildQuery(inputData)))
	})
});

const resolveStep = createStep({
	id: 'resolve',
	inputSchema: withRecords,
	outputSchema: z.object({ candidates: z.array(candidateSchema) }),
	execute: ({ inputData }) =>
		Promise.resolve({
			candidates: resolveMatches(inputData.inscription, inputData.records)
		})
});

const researchWorkflow = createWorkflow({
	id: 'research',
	inputSchema: inscriptionSchema,
	outputSchema: z.object({ candidates: z.array(candidateSchema) })
})
	.then(searchStep)
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
