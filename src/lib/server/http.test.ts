import { describe, expect, it } from 'vitest';
import { apiError, ProviderError, providerFailed } from './http';

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
});
