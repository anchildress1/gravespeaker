import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent } from 'undici';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import robotsParser from 'robots-parser';

const USER_AGENT = 'Gravespeaker';
const MAX_REDIRECTS = 3;
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8000;

// Deny-list ranges, not endpoints: the NOSONAR markers silence S1313.
const blocked = new BlockList();
for (const [net, bits] of [
	['0.0.0.0', 8],
	['10.0.0.0', 8], // NOSONAR
	['100.64.0.0', 10], // NOSONAR
	['127.0.0.0', 8],
	['169.254.0.0', 16], // NOSONAR
	['172.16.0.0', 12], // NOSONAR
	['192.168.0.0', 16] // NOSONAR
] as const) {
	blocked.addSubnet(net, bits, 'ipv4');
}
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6'); // NOSONAR
blocked.addSubnet('fc00::', 7, 'ipv6'); // NOSONAR

/**
 * Resolves a host once and returns the address to connect to, or null when any address is non-public.
 * @param hostname URL hostname.
 * @returns A public address to pin the connection to.
 */
async function resolvePublic(
	hostname: string
): Promise<{ address: string; family: number } | null> {
	const host = hostname.replace(/^\[|\]$/g, '');
	const family = isIP(host);
	const addresses = family
		? [{ address: host, family }]
		: await lookup(host, { all: true }).catch(() => []);
	const ok =
		addresses.length > 0 &&
		addresses.every((a) => !blocked.check(a.address, a.family === 6 ? 'ipv6' : 'ipv4'));
	return ok ? addresses[0] : null;
}

/**
 * Fetches one URL, following up to 3 redirects and re-checking every hop against the SSRF guard.
 * @param start First URL.
 * @returns The final response, or null when blocked, failed or redirected too often.
 */
async function guardedFetch(start: string): Promise<Response | null> {
	let url = start;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return null;
		}
		if (!/^https?:$/.test(parsed.protocol)) return null;
		const target = await resolvePublic(parsed.hostname);
		if (!target) return null;
		// Connecting to the checked address closes the gap where DNS answers differently on a second lookup.
		const dispatcher = new Agent({
			keepAliveTimeout: 1,
			connect: {
				lookup: (_host, options, callback) =>
					options.all ? callback(null, [target]) : callback(null, target.address, target.family)
			}
		});
		let res: Response;
		try {
			res = await fetch(parsed, {
				dispatcher,
				redirect: 'manual',
				headers: { 'User-Agent': USER_AGENT },
				signal: AbortSignal.timeout(TIMEOUT_MS)
			} as RequestInit); // lib.dom's RequestInit lacks undici's `dispatcher`
		} catch {
			return null;
		}
		// nosemgrep: javascript.browser.tainted-redirect.tainted-redirect -- followed server-side; every hop re-runs the SSRF check.
		const location = res.headers.get('location');
		if (res.status >= 300 && res.status < 400 && location) {
			url = new URL(location, parsed).href;
			continue;
		}
		return res;
	}
	return null;
}

/**
 * Reads a response body up to the byte cap.
 * @param res Response to read.
 * @returns Decoded text, truncated at the cap.
 */
async function readCapped(res: Response): Promise<string> {
	const reader = res.body?.getReader();
	if (!reader) return '';
	const chunks: Uint8Array[] = [];
	let size = 0;
	while (size < MAX_BYTES) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		size += value.length;
	}
	await reader.cancel().catch(() => undefined);
	return Buffer.concat(chunks).subarray(0, MAX_BYTES).toString('utf8');
}

/**
 * Fetches a page and extracts its main text. Nothing is persisted.
 * @param url Source URL from a search record.
 * @returns Readable text, or null when blocked, disallowed, gated, non-HTML or empty.
 */
export async function fetchPage(url: string): Promise<string | null> {
	let origin: string;
	try {
		origin = new URL(url).origin;
	} catch {
		return null;
	}
	const robotsRes = await guardedFetch(`${origin}/robots.txt`);
	if (robotsRes?.ok) {
		const robots = robotsParser(`${origin}/robots.txt`, await readCapped(robotsRes));
		if (robots.isAllowed(url, USER_AGENT) === false) return null;
	}
	const res = await guardedFetch(url);
	if (!res?.ok || !res.headers.get('content-type')?.includes('html')) return null;
	const { document } = parseHTML(await readCapped(res));
	const text = new Readability(document as unknown as Document).parse()?.textContent;
	return text?.replace(/\s+/g, ' ').trim() || null;
}
