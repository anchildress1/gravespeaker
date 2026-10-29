import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type { Voice } from '#lib/types.ts';
import { elevenLabsApiKey } from './env.ts';
import { ProviderError } from './http.ts';

// Flash is the lowest-latency model, so playback starts while the rest still streams.
const MODEL_ID = 'eleven_flash_v2_5';
const MAX_RETRIES = 2;

// Veda Sky (Suspense & Horror Storyteller) and Callum (Husky Trickster): American and eerie.
const VOICE_IDS: Record<Voice, string> = {
	female: '1rnYMVDXZksVr6x7pZPX',
	male: 'N2lVS1w4EtoT3dr4eOWO'
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
		}).textToSpeech.stream(VOICE_IDS[voice], {
			text,
			modelId: MODEL_ID,
			audioEffects: BEYOND_THE_GRAVE
		});
	} catch (e) {
		throw new ProviderError('Narrating the story failed', { cause: e });
	}
}
