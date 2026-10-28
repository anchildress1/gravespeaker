import { GEMINI_API_KEY, SERPAPI_API_KEY } from '$app/env/private';

/**
 * Asserts a secret is set.
 * @param key Variable name, for the error message.
 * @param value Value read from the environment.
 * @returns The non-empty value.
 * @throws {Error} When the value is unset or empty.
 */
function required(key: string, value: string | undefined): string {
	if (!value) throw new Error(`${key} is not set`);
	return value;
}

/**
 * Gemini API key.
 * @returns The key.
 * @throws {Error} When unset.
 */
export const geminiApiKey = (): string => required('GEMINI_API_KEY', GEMINI_API_KEY);

/**
 * SerpApi key.
 * @returns The key.
 * @throws {Error} When unset.
 */
export const serpApiKey = (): string => required('SERPAPI_API_KEY', SERPAPI_API_KEY);
