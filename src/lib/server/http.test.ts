import { describe, expect, it } from 'vitest';
import { apiError, ProviderError, providerFailed, runFailure } from './http';

describe('http', () => {
	it('maps a ProviderError to 502 provider_failed', async () => {
		const res = providerFailed(new ProviderError('x'));
		expect(res.status).toBe(502);
		expect((await res.json()).error.code).toBe('provider_failed');
	});

	it('rethrows an unexpected error instead of hiding it as a provider failure', () => {
		expect(() => providerFailed(new TypeError('bug'))).toThrow('bug');
	});

	it('builds the ApiError shape with the given status', async () => {
		const res = apiError('too_large', 'big', 413);
		expect(res.status).toBe(413);
		expect(await res.json()).toEqual({ error: { code: 'too_large', message: 'big' } });
	});

	it('keeps a provider failure from a workflow run as a ProviderError', () => {
		expect(runFailure('Story', { name: 'ProviderError', message: 'x' })).toBeInstanceOf(
			ProviderError
		);
	});

	it('does not report a bug in our own code as a provider failure', () => {
		const err = runFailure('Story', { name: 'TypeError', message: 'x is undefined' });
		expect(err).not.toBeInstanceOf(ProviderError);
		expect(() => providerFailed(err)).toThrow();
	});
});
