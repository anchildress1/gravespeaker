import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { PARTIAL_DATE } from '#lib/types.ts';
import type { Candidate, Inscription } from '#lib/types.ts';
import { ProviderError } from './http.ts';
import { buildQuery, dropGated, resolveCandidates } from './identity.ts';
import { inference } from './inference/gemma.ts';
import { search } from './search/serpapi.ts';

export const partialDate = z.string().regex(PARTIAL_DATE);

export const inscriptionSchema = z.object({
	carvedName: z.string(),
	name: z.string().min(1),
	maidenName: z.string().nullable(),
	born: partialDate.nullable(),
	died: partialDate.nullable()
});

export const sourceSchema = z.object({
	id: z.string(),
	url: z.string().regex(/^https?:\/\//i),
	title: z.string(),
	site: z.string(),
	snippet: z.string()
});

const candidateSchema = z.object({
	name: z.string(),
	born: partialDate.nullable(),
	died: partialDate.nullable(),
	place: z.string().nullable(),
	sources: z.array(sourceSchema)
});

const rawSchema = z.array(
	z.object({
		name: z.string(),
		born: z.string().nullable(),
		died: z.string().nullable(),
		place: z.string().nullable(),
		resultIds: z.array(z.string())
	})
);

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

const groupStep = createStep({
	id: 'group',
	inputSchema: withRecords,
	outputSchema: withRecords.extend({ raw: rawSchema }),
	execute: async ({ inputData }) => ({
		...inputData,
		raw: inputData.records.length
			? await inference.groupCandidates(inputData.inscription, inputData.records)
			: []
	})
});

const resolveStep = createStep({
	id: 'resolve',
	inputSchema: withRecords.extend({ raw: rawSchema }),
	outputSchema: z.object({ candidates: z.array(candidateSchema) }),
	execute: async ({ inputData }) => ({
		candidates: resolveCandidates(inputData.inscription, inputData.records, inputData.raw)
	})
});

const researchWorkflow = createWorkflow({
	id: 'research',
	inputSchema: inscriptionSchema,
	outputSchema: z.object({ candidates: z.array(candidateSchema) })
})
	.then(searchStep)
	.then(groupStep)
	.then(resolveStep)
	.commit();

/**
 * Searches for records about a stone's person and groups them into candidates.
 * @param inscription The stone's person.
 * @returns Candidates, possibly empty.
 * @throws {ProviderError} When search or the model fails after retries.
 */
export async function runResearch(inscription: Inscription): Promise<Candidate[]> {
	const run = await researchWorkflow.createRun();
	const result = await run.start({ inputData: inscription });
	if (result.status !== 'success') {
		throw new ProviderError('Research failed', {
			cause: result.status === 'failed' ? result.error : undefined
		});
	}
	return result.result.candidates;
}
