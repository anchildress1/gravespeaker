import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hosts: Record<string, string> = {
	'public.test': '93.184.216.34',
	'redirector.test': '93.184.216.34',
	'blocked.test': '93.184.216.34',
	'rebind.test': '10.1.2.3'
};
const lookups: string[] = [];
vi.mock('node:dns/promises', () => ({
	lookup: async (host: string) => {
		lookups.push(host);
		if (!hosts[host]) throw new Error('ENOTFOUND');
		return [{ address: hosts[host], family: 4 }];
	}
}));

const { fetchPage } = await import('./pages');

/**
 * Test helper.
 * @param body Test input.
 * @param status Test input.
 * @returns The fixture.
 */
const html = (body: string, status = 200) =>
	new Response(`<html><body>${body}</body></html>`, {
		status,
		headers: { 'content-type': 'text/html' }
	});
const article =
	'<article><h1>Obituary</h1><p>' +
	'Gaynor taught piano for forty years and loved her garden. '.repeat(20) +
	'</p></article>';

let fetchMock: ReturnType<typeof vi.fn>;
/**
 * Installs the fetch stub.
 * @param handler Receives each URL string.
 */
const stub = (handler: (url: string) => Response) => {
	fetchMock = vi.fn(async (input: string | URL) => handler(String(input)));
	vi.stubGlobal('fetch', fetchMock);
};
/**
 * Test helper.
 * @returns The fixture.
 */
const notFound = () => new Response('', { status: 404 });

/**
 * Builds a body stream that yields one chunk and then fails.
 * @param first Text delivered before the failure.
 * @returns The failing stream.
 */
const erroringBody = (first: string) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(first));
			controller.error(new Error('ECONNRESET'));
		}
	});

beforeEach(() => {
	lookups.length = 0;
	stub(() => notFound());
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchPage', () => {
	it.each([
		'http://169.254.169.254/latest/meta-data',
		'http://localhost/',
		'http://10.0.0.5/',
		'http://[::1]/',
		'http://[::ffff:127.0.0.1]/',
		'ftp://public.test/x',
		'http://rebind.test/'
	])('rejects %s without fetching', async (url) => {
		expect(await fetchPage(url)).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('extracts readable text from a public page', async () => {
		stub((url) => (url.endsWith('/robots.txt') ? notFound() : html(article)));
		expect(await fetchPage('https://public.test/obit')).toContain('taught piano for forty years');
	});

	it('resolves each host once per request and connects to that checked address', async () => {
		stub((url) => (url.endsWith('/robots.txt') ? notFound() : html(article)));
		await fetchPage('https://public.test/obit');
		// robots.txt and the page are separate requests, each resolved once.
		expect(lookups).toEqual(['public.test', 'public.test']);
		for (const [, init] of fetchMock.mock.calls) expect(init.dispatcher).toBeDefined();
	});

	it('follows a redirect to another public page', async () => {
		stub((url) => {
			if (url.endsWith('/robots.txt')) return notFound();
			return url.includes('/old')
				? new Response(null, { status: 301, headers: { location: 'https://public.test/new' } })
				: html(article);
		});
		expect(await fetchPage('https://public.test/old')).toContain('taught piano');
	});

	it('rejects a redirect to a private address', async () => {
		stub((url) =>
			url.endsWith('/robots.txt')
				? notFound()
				: new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } })
		);
		expect(await fetchPage('https://redirector.test/go')).toBeNull();
		expect(fetchMock).not.toHaveBeenCalledWith(
			expect.objectContaining({ hostname: '127.0.0.1' }),
			expect.anything()
		);
	});

	it('gives up after more than 3 redirects', async () => {
		stub((url) =>
			url.endsWith('/robots.txt')
				? notFound()
				: new Response(null, { status: 302, headers: { location: 'https://public.test/next' } })
		);
		expect(await fetchPage('https://public.test/a')).toBeNull();
	});

	it('skips a page robots.txt disallows for Gravespeaker', async () => {
		stub((url) =>
			url.endsWith('/robots.txt')
				? new Response('User-agent: *\nDisallow: /', { status: 200 })
				: html(article)
		);
		expect(await fetchPage('https://blocked.test/obit')).toBeNull();
	});

	it('skips a page that answers 403', async () => {
		stub((url) => (url.endsWith('/robots.txt') ? notFound() : html(article, 403)));
		expect(await fetchPage('https://public.test/gated')).toBeNull();
	});

	it('skips non-HTML content', async () => {
		stub((url) =>
			url.endsWith('/robots.txt')
				? notFound()
				: new Response('%PDF', { headers: { 'content-type': 'application/pdf' } })
		);
		expect(await fetchPage('https://public.test/f.pdf')).toBeNull();
	});

	it('truncates a body over 2 MB instead of reading it all', async () => {
		const huge = '<p>' + 'x'.repeat(3 * 1024 * 1024) + '</p>';
		stub((url) => (url.endsWith('/robots.txt') ? notFound() : html(huge)));
		const text = await fetchPage('https://public.test/big');
		expect(text === null || text.length <= 2 * 1024 * 1024).toBe(true);
	});

	it('returns null instead of throwing when the page body stream errors mid-read', async () => {
		stub((url) =>
			url.endsWith('/robots.txt')
				? notFound()
				: new Response(erroringBody('<html><body><p>partial'), {
						headers: { 'content-type': 'text/html' }
					})
		);
		expect(await fetchPage('https://public.test/stall')).toBeNull();
	});

	it('treats a robots.txt whose body errors mid-read as absent', async () => {
		stub((url) =>
			url.endsWith('/robots.txt')
				? new Response(erroringBody('User-agent: *\nDisallow: /'), { status: 200 })
				: html(article)
		);
		expect(await fetchPage('https://public.test/obit')).toContain('taught piano');
	});

	it('rejects an allowed URL that redirects to a path robots.txt disallows', async () => {
		stub((url) => {
			if (url.endsWith('/robots.txt')) {
				return new Response('User-agent: *\nDisallow: /private', { status: 200 });
			}
			return url.includes('/old')
				? new Response(null, {
						status: 301,
						headers: { location: 'https://public.test/private/x' }
					})
				: html(article);
		});
		expect(await fetchPage('https://public.test/old')).toBeNull();
	});

	it('rejects a redirect to another host whose robots.txt disallows', async () => {
		stub((url) => {
			if (url.startsWith('https://blocked.test/robots.txt')) {
				return new Response('User-agent: *\nDisallow: /', { status: 200 });
			}
			if (url.endsWith('/robots.txt')) return notFound();
			return url.startsWith('https://public.test/')
				? new Response(null, { status: 301, headers: { location: 'https://blocked.test/obit' } })
				: html(article);
		});
		expect(await fetchPage('https://public.test/old')).toBeNull();
	});

	it('returns text after a redirect to a destination robots.txt allows', async () => {
		stub((url) => {
			if (url.endsWith('/robots.txt')) {
				return new Response('User-agent: *\nDisallow: /private', { status: 200 });
			}
			return url.includes('/old')
				? new Response(null, { status: 301, headers: { location: 'https://redirector.test/new' } })
				: html(article);
		});
		expect(await fetchPage('https://public.test/old')).toContain('taught piano');
	});
});
