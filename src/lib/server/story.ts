import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import type { Candidate, Inscription, Story } from '#lib/types.ts';
import { runFailure } from './http.ts';
import { inference } from './inference/gemma.ts';
import { groundParagraph, hasEvidence, verifyFacts } from './narrative.ts';
import { fetchPage } from './pages.ts';
import { candidateSchema, inscriptionSchema, sourceSchema } from './research.ts';

const MAX_PAGES = 5;
const MAX_CHARS = 12_000;

export const candidateInputSchema = candidateSchema.extend({
	sources: z.array(sourceSchema).min(1).max(MAX_PAGES)
});

const inputSchema = z.object({ inscription: inscriptionSchema, candidate: candidateInputSchema });
const pageSchema = z.object({ sourceId: z.string(), text: z.string() });
const withPages = inputSchema.extend({ pages: z.array(pageSchema) });
const factSchema = z.object({
	claim: z.enum(['name', 'birth', 'death', 'other']),
	sourceId: z.string(),
	quote: z.string()
});
const withFacts = withPages.extend({ facts: z.array(factSchema) });
const withParagraph = withFacts.extend({ paragraph: z.string() });
const storySchema = z.discriminatedUnion('status', [
	z.object({
		status: z.literal('told'),
		paragraph: z.string(),
		sources: z.array(sourceSchema)
	}),
	z.object({ status: z.literal('insufficient') })
]);

const fetchStep = createStep({
	id: 'fetch',
	inputSchema,
	outputSchema: withPages,
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

const extractStep = createStep({
	id: 'extract',
	inputSchema: withPages,
	outputSchema: withFacts,
	execute: async ({ inputData }) => ({
		...inputData,
		facts: verifyFacts(
			inputData.candidate,
			inputData.pages,
			await inference.extractFacts(inputData.inscription, inputData.candidate, inputData.pages)
		)
	})
});

const tellStep = createStep({
	id: 'tell',
	inputSchema: withFacts,
	outputSchema: withParagraph,
	execute: async ({ inputData }) => ({
		...inputData,
		// With nothing beyond the name and dates there is no story to tell, so skip the model.
		paragraph: hasEvidence(inputData.inscription, inputData.candidate, inputData.facts)
			? await inference.tellStory(
					inputData.candidate.name,
					inputData.facts.map((f) => f.quote)
				)
			: ''
	})
});

const groundStep = createStep({
	id: 'ground',
	inputSchema: withParagraph,
	outputSchema: storySchema,
	execute: ({ inputData }) =>
		Promise.resolve(
			groundParagraph(
				inputData.inscription,
				inputData.candidate,
				inputData.facts,
				inputData.paragraph
			)
		)
});

const storyWorkflow = createWorkflow({ id: 'story', inputSchema, outputSchema: storySchema })
	.then(fetchStep)
	.then(extractStep)
	.then(tellStep)
	.then(groundStep) // NOSONAR: Mastra builder .then(), not a Promise
	.commit();

/**
 * Fetches the candidate's sources, extracts verified facts, writes a paragraph around them and
 * grounds it against those facts.
 * @param inscription The stone's person.
 * @param candidate The candidate the visitor confirmed.
 * @returns A grounded story, or `insufficient`.
 * @throws {ProviderError} When the model fails after retries.
 */
export async function runStory(inscription: Inscription, candidate: Candidate): Promise<Story> {
	const run = await storyWorkflow.createRun();
	const result = await run.start({ inputData: { inscription, candidate } });
	if (result.status !== 'success') {
		throw runFailure('Story', result.status === 'failed' ? result.error : undefined);
	}
	return result.result;
}
