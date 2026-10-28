import { describe, expect, it, vi } from 'vitest';

const keys = vi.hoisted(() => ({ GEMINI_API_KEY: '', SERPAPI_API_KEY: 'serp' }));
vi.mock('$app/env/private', () => keys);

const { geminiApiKey, serpApiKey } = await import('./env');

describe('env', () => {
	it('throws a clear error when a key is empty', () => {
		expect(() => geminiApiKey()).toThrow('GEMINI_API_KEY is not set');
	});

	it('returns a key that is set', () => {
		expect(serpApiKey()).toBe('serp');
	});
});
