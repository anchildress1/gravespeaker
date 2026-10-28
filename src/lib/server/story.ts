import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import type { Candidate, Inscription, Story } from '#lib/types.ts';
import { ProviderError } from './http.ts';
import { inference } from './inference/gemma.ts';
import { groundStory } from './narrative.ts';
import { fetchPage } from './pages.ts';
import { inscriptionSchema, sourceSchema } from './research.ts';

const MAX_PAGES = 5;
const MAX_CHARS = 12_000;

export const candidateInputSchema = z.object({
	name: z.string(),
	born: inscriptionSchema.shape.born,
	died: inscriptionSchema.shape.died,
	place: z.string().nullable(),
	sources: z.array(sourceSchema).min(1)
});

const inputSchema = z.object({ inscription: inscriptionSchema, candidate: candidateInputSchema });
const pageSchema = z.object({ sourceId: z.string(), text: z.string() });
const withPages = inputSchema.extend({ pages: z.array(pageSchema) });
const withRaw = withPages.extend({
	raw: z.array(
		z.object({
			text: z.string(),
			kind: z.enum(['fact', 'reconstruction']),
			claim: z.enum(['name', 'birth', 'death', 'other']),
			sourceIds: z.array(z.string()),
			quote: z.string()
		})
	)
});
const storySchema = z.discriminatedUnion('status', [
	z.object({
		status: z.literal('told'),
		sentences: z.array(
			z.object({
				text: z.string(),
				kind: z.enum(['fact', 'reconstruction']),
				sourceIds: z.array(z.string())
			})
		),
		sources: z.array(sourceSchema)
	}),
	z.object({ status: z.literal('insufficient') })
]);

const fetchStep = createStep({
	id: 'fetch',
	inputSchema,
	outputSchema: withPages,
	retries: 1,
	execute: async ({ inputData }) => ({
		...inputData,
		pages: await Promise.all(
			inputData.candidate.sources.slice(0, MAX_PAGES).map(async (s) => ({
				sourceId: s.id,
				text: ((await fetchPage(s.url)) ?? s.snippet).slice(0, MAX_CHARS)
			}))
		)
	})
});

const tellStep = createStep({
	id: 'tell',
	inputSchema: withPages,
	outputSchema: withRaw,
	execute: async ({ inputData }) => ({
		...inputData,
		raw: await inference.tellStory(inputData.inscription, inputData.candidate, inputData.pages)
	})
});

const groundStep = createStep({
	id: 'ground',
	inputSchema: withRaw,
	outputSchema: storySchema,
	execute: ({ inputData }) =>
		Promise.resolve(
			groundStory(inputData.inscription, inputData.candidate, inputData.pages, inputData.raw)
		)
});

const storyWorkflow = createWorkflow({ id: 'story', inputSchema, outputSchema: storySchema })
	.then(fetchStep)
	.then(tellStep)
	.then(groundStep) // NOSONAR: Mastra builder .then(), not a Promise
	.commit();

/**
 * Fetches the candidate's sources, writes a story and grounds it against them.
 * @param inscription The stone's person.
 * @param candidate The candidate the visitor confirmed.
 * @returns A grounded story, or `insufficient`.
 * @throws {ProviderError} When the model fails after retries.
 */
export async function runStory(inscription: Inscription, candidate: Candidate): Promise<Story> {
	const run = await storyWorkflow.createRun();
	const result = await run.start({ inputData: { inscription, candidate } });
	if (result.status !== 'success') {
		throw new ProviderError('Story failed', {
			cause: result.status === 'failed' ? result.error : undefined
		});
	}
	return result.result;
}
