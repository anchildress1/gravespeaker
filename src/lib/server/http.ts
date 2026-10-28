import { json } from '@sveltejs/kit';
import type { ApiError } from '#lib/types.ts';

/** Thrown by both provider seams once Mastra's retries are exhausted. */
export class ProviderError extends Error {
	/**
	 * @param message Safe-to-log description.
	 * @param options Standard error options, including `cause`.
	 */
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ProviderError';
	}
}

/**
 * Builds a JSON error response in the {@link ApiError} shape.
 * @param code Error code.
 * @param message Message safe to show the visitor.
 * @param status HTTP status.
 * @returns The response.
 */
export function apiError(code: ApiError['error']['code'], message: string, status: number) {
	return json({ error: { code, message } } satisfies ApiError, { status });
}

/**
 * Maps a thrown error to a response: provider failures become 502, anything else rethrows.
 * @param e Caught error.
 * @returns A 502 `provider_failed` response.
 * @throws {unknown} The original error when it is not a {@link ProviderError}.
 */
export function providerFailed(e: unknown) {
	if (!(e instanceof ProviderError)) throw e;
	return apiError('provider_failed', 'The lookup service failed. Please try again.', 502);
}
