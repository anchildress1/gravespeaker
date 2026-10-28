import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { Candidate, Inscription } from '#lib/types.ts';
import { geminiApiKey } from '../env';
import { ProviderError } from '../http';
import type { InferenceProvider, PageText, RawPerson, RawFact } from './index';

const MODEL_ID = 'google/gemma-4-26b-a4b-it';
const MAX_RETRIES = 2;

// Gemma 4 thinks ~5k tokens by default, which takes minutes on long prompts.
const NO_THINKING = { google: { thinkingConfig: { thinkingLevel: 'minimal' } } } as const;

const dateHint = 'YYYY-MM-DD or YYYY; ? for an unreadable digit; null if absent.';

/** Read output shape. The `satisfies` clause fails the type check if it drifts from {@link RawPerson}. */
export const readSchema = z.object({
	people: z.array(
		z.object({
			name: z.string().describe('Name exactly as carved.'),
			born: z.string().nullable().describe(dateHint),
			died: z.string().nullable().describe(dateHint)
		})
	)
}) satisfies z.ZodType<{ people: RawPerson[] }>;

/** Rules measured in benchmark run 10. */
export const READ_INSTRUCTIONS = `You read photos of gravestones for a historical research tool.

Transcribe ONLY what is carved or cast on the stone. Do NOT add, guess, or complete anything you cannot see.

- people: one entry per person commemorated, with the name exactly as carved. [] if no name is legible.
- Only the person or people the stone is for go in people. Relatives named in relation to them ("son of", "wife of", "daughter of") and nicknames are NOT separate people.
- born/died: "YYYY-MM-DD", or "YYYY" when only the year is carved. Use "?" for an unreadable digit, and for any worn digit that could be read two ways (1 or 4, 3 or 8). A "?" is better than a guess. null when the date is not on the stone.
- A surname carved once, at the top or the bottom of a stone shared by two people, belongs to every person on the stone. Put it on each name, e.g. "ANN MARIE" and "JOHN PAUL" under "BRANDT" are "Ann Marie Brandt" and "John Paul Brandt". Give each person only the dates carved for them, and null for a date that is not carved for them.
- A year that is not a birth or death (marriage length, erection date) is NOT a life date.`;

export const READ_USER_TEXT = 'Transcribe the gravestone in this photo.';
export const READ_SAMPLING = { temperature: 0, topP: 0.95, topK: 64 };

const factsSchema = z.object({
	facts: z.array(
		z.object({
			claim: z.enum(['name', 'birth', 'death', 'other']),
			sourceId: z.string(),
			quote: z.string().describe('Copied exactly from the source text, under 25 words.')
		})
	)
}) satisfies z.ZodType<{ facts: RawFact[] }>;

const EXTRACT_INSTRUCTIONS = `Task: pull checkable facts about one deceased person out of source texts.

Rules:
- Return only facts the sources state about this person, each as claim, sourceId and quote.
- quote is copied exactly from the source text, with no edits. Keep it short: one phrase or sentence, under 25 words.
- claim is "name", "birth" or "death" for those facts, and "other" for anything else: work, hobbies, places lived, family relationships, achievements.
- Skip facts about other people, unless the fact states this person's relationship to them. Never include the names of survivors or other living people.
- Skip guesses, opinions and anything the text does not say.
- If the sources hold no usable facts, return an empty list.`;

const STORY_INSTRUCTIONS = `Task: write a short theatrical monologue spoken by a ghost, built around a list of verified facts.

Rules:
- Write one paragraph of 100 to 170 words, in first person as the deceased, spoken to a visitor at the grave.
- Weave in as many of the facts as read naturally. State each fact plainly and truthfully.
- Add atmosphere around the facts: the grave, the dark, the stone, the weather, time, the visitor. Make it eerie, dramatic and intimate. It is openly fiction.
- Use only the facts given. Do not add any name, place, number, date, event, relationship, memory, thought or feeling of the deceased that the facts do not state. Do not deny or reverse a fact.
- Never name anyone the facts do not name, and never name living people.
- A voice actor will read it aloud: use plain flowing sentences. No stage directions, brackets, parentheses, emoji, markdown, headings or lists. Use commas, periods and ellipses for pauses.
- Output only the paragraph.`;

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
	async extractFacts(
		inscription: Inscription,
		candidate: Candidate,
		pages: PageText[]
	): Promise<RawFact[]> {
		const sources = candidate.sources.map(({ id, title }) => ({
			id,
			title,
			text: pages.find((p) => p.sourceId === id)?.text ?? ''
		}));
		try {
			const res = await agent('extract-facts', EXTRACT_INSTRUCTIONS).generate(
				`Person: ${candidate.name} (headstone: ${inscription.carvedName}).\n\nSources:\n${JSON.stringify(sources)}`,
				{
					structuredOutput: { schema: factsSchema },
					modelSettings: { temperature: 0 },
					providerOptions: NO_THINKING
				}
			);
			return res.object.facts;
		} catch (e) {
			throw failed('Extracting facts', e);
		}
	}

	/** @inheritdoc */
	async tellStory(name: string, facts: string[]): Promise<string> {
		try {
			const res = await agent('tell-story', STORY_INSTRUCTIONS).generate(
				`Deceased: ${name}\n\nVerified facts:\n${facts.map((f) => `- ${f}`).join('\n')}`,
				{
					// Gemma's documented sampling for every use case; the creative call needs the variety.
					modelSettings: { temperature: 1, topP: 0.95, topK: 64 },
					providerOptions: NO_THINKING
				}
			);
			return res.text.trim();
		} catch (e) {
			throw failed('Telling the story', e);
		}
	}
}

export const inference: InferenceProvider = new GemmaProvider();
