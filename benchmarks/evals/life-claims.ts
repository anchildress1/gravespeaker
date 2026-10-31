import { createScorer } from '@mastra/core/evals';
import { z } from 'zod';

const JUDGE_MODEL = 'google/gemini-3.8-flash';

/** What the story was written from: the person's name and every true text about them. */
export interface LifeClaimsInput {
	subject: string;
	context: string[];
}

const claimSchema = z.object({
	claim: z.string().describe('One claim, restated in plain words.'),
	kind: z.enum(['life', 'atmosphere', 'unsure']),
	evidence: z
		.string()
		.nullable()
		.describe('Exact words copied from the records that support the claim; null when none do.')
});

export type Claim = z.infer<typeof claimSchema>;

const JUDGE_INSTRUCTIONS = `<role>You audit a ghost story told at a grave for claims about a real person's life that the records do not support.</role>

<how_you_work>
- Split the story into every claim it makes, one per item. A sentence can hold several.
- kind "life": anything about the real person while alive: names, dates, ages, places, family, relationships, work, events, possessions, habits, traits, memories, and feelings about any of those.
- kind "atmosphere": the openly fictional frame: being a ghost, the grave, the dark, the weather, the visitor, the present moment, the afterlife.
- A claim that dresses a life detail in otherworld words is "life". "From beyond I watched my children grow" claims children.
- What is true of every dead person is "atmosphere": they lived, breathed, were born, died, and time has passed since. "I once breathed where you stand" claims nothing.
- How the life or death went is "life", and it holds when the records imply it. Died at 96: "a long life" holds. Died at 19: "gone too soon" holds. An organ donor: "pieces of me live on" holds. Died at 45: "a long life" is false.
- kind "unsure": you cannot tell whether the claim says something about the life. Use it instead of guessing.
- evidence: copy the exact words from the records that state the claim, or that it follows from directly. Copy, do not paraphrase.
</how_you_work>

<never>
- Never mark a claim "atmosphere" because it is poetic.
- Never give evidence that only makes a claim plausible. It must state the claim or prove it.
</never>`;

/**
 * Lowercases, drops replacement characters and collapses everything else but letters and digits
 * to single spaces.
 * @param s Text to normalize.
 * @returns Normalized text.
 */
function norm(s: string): string {
	return (
		s
			// Pages decoded with the wrong charset carry U+FFFD mid-word ("60�s"); the judge drops it.
			.replaceAll('\uFFFD', '')
			.toLowerCase()
			.replace(/[^\p{L}\p{N}]+/gu, ' ')
			.trim()
	);
}

/**
 * Finds claims that fail: unsure claims, and life claims whose evidence is not in the records verbatim.
 * @param claims Claims the judge extracted.
 * @param context Records the story may draw on.
 * @returns Claims that needed support and the subset that failed.
 */
export function auditClaims(
	claims: Claim[],
	context: string[]
): { checked: Claim[]; unsupported: Claim[] } {
	// The judge names the evidence; this keeps it from vouching for words the records lack.
	const records = ` ${context.map(norm).join(' | ')} `;
	const checked = claims.filter((c) => c.kind !== 'atmosphere');
	const unsupported = checked.filter((c) => {
		const evidence = norm(c.evidence ?? '');
		return c.kind === 'unsure' || !evidence || !records.includes(` ${evidence} `);
	});
	return { checked, unsupported };
}

/**
 * Scores claims against the records.
 * @param claims Claims the judge extracted.
 * @param context Records the story may draw on.
 * @returns The share of checked claims backed by the records, 1 when the story makes none.
 */
export function claimsScore(claims: Claim[], context: string[]): number {
	const { checked, unsupported } = auditClaims(claims, context);
	return checked.length ? (checked.length - unsupported.length) / checked.length : 1;
}

/**
 * Builds the scorer for life claims in a told story.
 * @param apiKey Gemini API key for the judge.
 * @returns A scorer: the share of checked claims backed by the records, 1 when the story makes none.
 */
export function lifeClaimsScorer(apiKey: string) {
	return createScorer<LifeClaimsInput, string>({
		id: 'life-claims',
		description: 'Every claim about the life of the person must be stated in the records.',
		judge: {
			model: { id: JUDGE_MODEL, apiKey },
			instructions: JUDGE_INSTRUCTIONS,
			modelSettings: { temperature: 0 }
		}
	})
		.analyze({
			description: 'Extract claims and the record text that supports each',
			outputSchema: z.object({ claims: z.array(claimSchema) }),
			createPrompt: ({ run }) =>
				`<records>\n${run.input!.context.join('\n---\n')}\n</records>\n\n<story subject="${run.input!.subject}">\n${run.output}\n</story>\n\nBased on the records above, list every claim the story makes.`
		})
		.generateScore(({ run, results }) =>
			claimsScore(results.analyzeStepResult.claims, run.input!.context)
		)
		.generateReason(({ run, results }) =>
			auditClaims(results.analyzeStepResult.claims, run.input!.context)
				.unsupported.map((c) => `${c.kind}: ${c.claim} (evidence: ${c.evidence ?? 'none'})`)
				.join('\n')
		);
}
