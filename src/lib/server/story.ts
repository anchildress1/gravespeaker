import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { epitaph } from '#lib/epitaph.ts';
import { VOICES } from '#lib/types.ts';
import type { Candidate, Confidence, Inscription, Story } from '#lib/types.ts';
import { runFailure } from './http.ts';
import { inference } from './inference/gemma.ts';
import { groundParagraph, groundStone, hasEvidence, verifyFacts } from './narrative.ts';
import { pageEvidence } from './identity.ts';
import { fetchPage } from './pages.ts';
import { candidateSchema, confidenceSchema, inscriptionSchema, sourceSchema } from './research.ts';
import { narratorVoice } from './voice.ts';

const MAX_PAGES = 5;
const MAX_CHARS = 12_000;
const GRADES: Confidence[] = ['low', 'medium', 'high'];

export const candidateInputSchema = candidateSchema.extend({
	sources: z.array(sourceSchema).min(1).max(MAX_PAGES)
});

const inputSchema = z.object({ inscription: inscriptionSchema, candidate: candidateInputSchema });
const pageSchema = z.object({
	sourceId: z.string(),
	text: z.string(),
	grade: confidenceSchema.nullable()
});
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
		confidence: z.enum(['high', 'medium']),
		sources: z.array(sourceSchema),
		voice: z.enum(VOICES)
	}),
	z.object({ status: z.literal('insufficient') })
]);

const fetchStep = createStep({
	id: 'fetch',
	inputSchema,
	outputSchema: withPages,
	execute: async ({ inputData }) => {
		const { inscription, candidate } = inputData;
		const pages = await Promise.all(
			candidate.sources.slice(0, MAX_PAGES).map(async (s) => {
				const text = ((await fetchPage(s.url)) ?? s.snippet).slice(0, MAX_CHARS);
				return { sourceId: s.id, text, ...pageEvidence(inscription, text) };
			})
		);
		// A page that dates the name differently describes someone else, whatever the match grade.
		// A name-only match is as likely a namesake, so its pages must also state at least one of the
		// stone's dates; otherwise the story falls back to the stone.
		return {
			...inputData,
			pages: pages
				.filter((p) =>
					candidate.confidence === 'low' ? (p.grade ?? 'low') !== 'low' : !p.conflicts
				)
				.map(({ sourceId, text, grade }) => ({ sourceId, text, grade }))
		};
	}
});

const extractStep = createStep({
	id: 'extract',
	inputSchema: withPages,
	outputSchema: withFacts,
	execute: async ({ inputData }) => ({
		...inputData,
		facts: inputData.pages.length
			? verifyFacts(
					inputData.candidate,
					inputData.pages,
					await inference.extractFacts(inputData.inscription, inputData.candidate, inputData.pages)
				)
			: []
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
	execute: ({ inputData }) => {
		const { inscription, candidate, pages, facts, paragraph } = inputData;
		const grounded = groundParagraph(inscription, candidate, facts, paragraph);
		return Promise.resolve(
			grounded.status === 'told'
				? {
						...grounded,
						confidence: matchGrade(candidate, pages),
						voice: narratorVoice(
							inscription,
							facts.map((f) => f.quote)
						)
					}
				: grounded
		);
	}
});

/**
 * Grades the told match from its search results and the pages the story read, whichever is stronger.
 * @param candidate The match the story was told from.
 * @param pages Pages kept for the story.
 * @returns The match's confidence; never low, because a name-only match keeps only pages that
 *   state one of the stone's dates, and a story with no pages is never told.
 */
function matchGrade(
	candidate: Candidate,
	pages: { grade: Confidence | null }[]
): Exclude<Confidence, 'low'> {
	const ranks = pages.map((p) => GRADES.indexOf(p.grade ?? 'low'));
	return GRADES[Math.max(GRADES.indexOf(candidate.confidence), ...ranks)] === 'high'
		? 'high'
		: 'medium';
}

const storyWorkflow = createWorkflow({ id: 'story', inputSchema, outputSchema: storySchema })
	.then(fetchStep)
	.then(extractStep)
	.then(tellStep)
	.then(groundStep)
	.commit();

/**
 * Writes a paragraph around what the stone says and grounds it against the stone alone.
 * @param inscription The stone's person.
 * @param today Current date, for how long they have been buried.
 * @returns A stone story.
 * @throws {ProviderError} When the model fails after retries.
 */
export async function runStoneStory(inscription: Inscription, today = new Date()): Promise<Story> {
	const facts = epitaph(inscription, today);
	const paragraph = await inference.tellStory(inscription.name, facts);
	return {
		status: 'stone',
		paragraph: groundStone(inscription, facts, paragraph),
		voice: narratorVoice(inscription, [])
	};
}

/**
 * Fetches the candidate's sources, extracts verified facts, writes a paragraph around them and
 * grounds it against those facts. Falls back to the stone when the records add nothing.
 * @param inscription The stone's person.
 * @param candidate The best match from research.
 * @returns A grounded story.
 * @throws {ProviderError} When the model fails after retries.
 */
export async function runStory(inscription: Inscription, candidate: Candidate): Promise<Story> {
	const run = await storyWorkflow.createRun();
	const result = await run.start({ inputData: { inscription, candidate } });
	if (result.status !== 'success') {
		throw runFailure('Story', result.status === 'failed' ? result.error : undefined);
	}
	return result.result.status === 'told' ? result.result : runStoneStory(inscription);
}
