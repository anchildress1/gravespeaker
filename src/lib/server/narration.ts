import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { Voice } from '#lib/types.ts';
import { elevenLabsApiKey } from './env.ts';
import { ProviderError } from './http.ts';

// Flash is the lowest-latency model, so playback starts while the rest still streams.
const MODEL_ID = 'eleven_flash_v2_5';
const MAX_RETRIES = 2;

// ElevenLabs premade voices, which a library owner cannot withdraw: Matilda (low alto) and
// Callum (gravelly). Callum reads quickly at the default speed, which undercuts the slow pacing.
const VOICES: Record<Voice, { id: string; speed: number }> = {
	female: { id: 'XrExE9yKIg1WjnnlVkGX', speed: 1 },
	male: { id: 'N2lVS1w4EtoT3dr4eOWO', speed: 0.85 }
};

// A hollow tunnel tail and some distance, so the voice seems to rise from below the stone.
const BEYOND_THE_GRAVE = { environmentId: 'tunnel', sendLevel: 0.45, distance: 0.5 };

/**
 * Streams the narration of a story in the chosen voice.
 * @param text The story paragraph.
 * @param voice Narrator voice.
 * @returns MP3 audio as it is synthesized.
 * @throws {ProviderError} When ElevenLabs fails after the SDK's retries.
 */
export async function narrate(text: string, voice: Voice): Promise<ReadableStream<Uint8Array>> {
	try {
		return await new ElevenLabsClient({
			apiKey: elevenLabsApiKey(),
			maxRetries: MAX_RETRIES
		}).textToSpeech.stream(VOICES[voice].id, {
			text,
			modelId: MODEL_ID,
			voiceSettings: { speed: VOICES[voice].speed },
			audioEffects: BEYOND_THE_GRAVE
		});
	} catch (e) {
		throw new ProviderError('Narrating the story failed', { cause: e });
	}
}
