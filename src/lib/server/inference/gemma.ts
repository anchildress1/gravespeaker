import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { Candidate, Inscription, SourceRecord } from '#lib/types.ts';
import { geminiApiKey } from '../env';
import { ProviderError } from '../http';
import type { InferenceProvider, PageText, RawCandidate, RawPerson, RawSentence } from './index';

const MODEL_ID = 'google/gemma-4-26b-a4b-it';
const MAX_RETRIES = 2;

// Gemma 4 thinks ~5k tokens by default, which takes minutes on long prompts.
const NO_THINKING = { google: { thinkingConfig: { thinkingLevel: 'minimal' } } } as const;

const dateHint = 'YYYY-MM-DD or YYYY; ? for an unreadable digit; null if absent.';

/** The only definition of the read output shape. */
export const readSchema = z.object({
	people: z.array(
		z.object({
			name: z.string().describe('Name exactly as carved.'),
			born: z.string().nullable().describe(dateHint),
			died: z.string().nullable().describe(dateHint)
		})
	)
});

/** Rules measured in benchmark run 10. */
export const READ_INSTRUCTIONS = `You read photos of gravestones for a historical research tool.

Transcribe ONLY what is carved or cast on the stone. Do NOT add, guess, or complete anything you cannot see.

- people: one entry per person commemorated, with the name exactly as carved. [] if no name is legible.
- Only the person or people the stone is for go in people. Relatives named in relation to them ("son of", "wife of", "daughter of") and nicknames are NOT separate people.
- born/died: "YYYY-MM-DD", or "YYYY" when only the year is carved. Use "?" for an unreadable digit, and for any worn digit that could be read two ways (1 or 4, 3 or 8). A "?" is better than a guess. null when the date is not on the stone.
- A year that is not a birth or death (marriage length, erection date) is NOT a life date.`;

export const READ_USER_TEXT = 'Transcribe the gravestone in this photo.';
export const READ_SAMPLING = { temperature: 0, topP: 0.95, topK: 64 };

const groupSchema = z.object({
	candidates: z.array(
		z.object({
			name: z.string(),
			born: z.string().nullable().describe(dateHint),
			died: z.string().nullable().describe(dateHint),
			place: z.string().nullable(),
			resultIds: z.array(z.string()).describe('Ids of the search results about this person.')
		})
	)
});

const storySchema = z.object({
	sentences: z.array(
		z.object({
			text: z.string(),
			kind: z.enum(['fact', 'reconstruction']),
			claim: z.enum(['name', 'birth', 'death', 'other']),
			sourceIds: z.array(z.string()),
			quote: z
				.string()
				.describe('Short verbatim excerpt from a cited source; empty for reconstruction.')
		})
	)
});

const GROUP_INSTRUCTIONS = `You group web search results into distinct people for a genealogy lookup.

- Each candidate is one distinct person. Never put one result in two candidates.
- Use only facts present in a result's title or snippet. Do not copy details from the headstone onto a result that does not state them.
- Use null for any field the results do not state.
- Skip results that are not about a specific person.`;

const STORY_INSTRUCTIONS = `You are a ghost speaking from the grave. Perform a short, theatrical monologue in first person, as the deceased, addressed to the visitor standing at the stone. It is openly fiction, so be atmospheric, eerie and dramatic, and weave in the real facts the sources give.

Two kinds of sentence, mixed so the real facts land inside the performance:
- "fact": delivers one real fact from a source, in the ghost's voice. The fact must stay exactly as true as its quote. Flair is fine; extra claims are not.
- "reconstruction": pure theatre about the grave, the dark, the stone, the weather, the passing of time, the visitor. It states nothing about the person's life.

Rules for facts:
- Every "fact" cites sourceIds and copies a short verbatim quote from one of those sources.
- Never invent relationships, events, memories, thoughts or feelings of the deceased.
- Relationships may appear only as cited facts.
- Name a relative only when a cited source says they died before the deceased.
- Never name survivors or other living people.
- claim is "name", "birth" or "death" for facts about those; "other" for any other fact.

Example of the mix (the quotes come from the sources, the rest is theatre):
- reconstruction: "Come closer. The cold keeps no secrets from the living."
- fact: "I taught piano for forty years." (quote: "taught piano for forty years")
- reconstruction: "Strange, how the silence here has no keys at all."`;

/**
 * Builds a one-shot Mastra agent on the hosted Gemma model.
 * @param id Agent id.
 * @param instructions System instructions.
 * @returns The agent.
 */
function agent(id: string, instructions: string): Agent {
	return new Agent({
		id,
		name: id,
		instructions,
		model: { id: MODEL_ID, apiKey: geminiApiKey() },
		maxRetries: MAX_RETRIES
	});
}

/**
 * Wraps a failed model call in a {@link ProviderError}.
 * @param what Operation name for the message.
 * @param e Caught error.
 * @returns The wrapped error, ready to throw.
 */
function failed(what: string, e: unknown): ProviderError {
	return new ProviderError(`${what} failed`, { cause: e });
}

/** Gemma 4 26B on the Gemini API via Mastra. */
export class GemmaProvider implements InferenceProvider {
	/** @inheritdoc */
	async readStone(image: Uint8Array, mimeType: string): Promise<RawPerson[]> {
		try {
			const res = await agent('read-stone', READ_INSTRUCTIONS).generate(
				[
					{
						role: 'user',
						content: [
							{ type: 'image', image: Buffer.from(image).toString('base64'), mimeType },
							{ type: 'text', text: READ_USER_TEXT }
						]
					}
				],
				{ structuredOutput: { schema: readSchema }, modelSettings: READ_SAMPLING }
			);
			return res.object.people;
		} catch (e) {
			throw failed('Reading the stone', e);
		}
	}

	/** @inheritdoc */
	async groupCandidates(
		inscription: Inscription,
		records: SourceRecord[]
	): Promise<RawCandidate[]> {
		const results = records.map(({ id, title, snippet }) => ({ id, title, snippet }));
		try {
			const res = await agent('group-candidates', GROUP_INSTRUCTIONS).generate(
				`Headstone: ${inscription.carvedName}, born ${inscription.born ?? 'unknown'}, died ${inscription.died ?? 'unknown'}.\n\nSearch results:\n${JSON.stringify(results)}`,
				{
					structuredOutput: { schema: groupSchema },
					modelSettings: { temperature: 0 },
					providerOptions: NO_THINKING
				}
			);
			return res.object.candidates;
		} catch (e) {
			throw failed('Grouping candidates', e);
		}
	}

	/** @inheritdoc */
	async tellStory(
		inscription: Inscription,
		candidate: Candidate,
		pages: PageText[]
	): Promise<RawSentence[]> {
		const sources = candidate.sources.map(({ id, title }) => ({
			id,
			title,
			text: pages.find((p) => p.sourceId === id)?.text ?? ''
		}));
		try {
			const res = await agent('tell-story', STORY_INSTRUCTIONS).generate(
				`Speak as ${candidate.name} (stone: ${inscription.carvedName}).\n\nSources:\n${JSON.stringify(sources)}`,
				{
					structuredOutput: { schema: storySchema },
					modelSettings: { temperature: 0.7 },
					providerOptions: NO_THINKING
				}
			);
			return res.object.sentences;
		} catch (e) {
			throw failed('Telling the story', e);
		}
	}
}

export const inference: InferenceProvider = new GemmaProvider();
