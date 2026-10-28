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
	['192.168.0.0', 16], // NOSONAR
	['192.0.0.0', 24], // NOSONAR
	['192.0.2.0', 24],
	['198.18.0.0', 15], // NOSONAR
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4], // NOSONAR
	['240.0.0.0', 4] // NOSONAR
] as const) {
	blocked.addSubnet(net, bits, 'ipv4');
}
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6'); // NOSONAR
blocked.addSubnet('fc00::', 7, 'ipv6'); // NOSONAR
blocked.addSubnet('ff00::', 8, 'ipv6'); // NOSONAR
// NAT64, 6to4 and Teredo can encode a private IPv4 destination.
blocked.addSubnet('64:ff9b::', 96, 'ipv6'); // NOSONAR
blocked.addSubnet('2002::', 16, 'ipv6'); // NOSONAR
blocked.addSubnet('2001::', 32, 'ipv6'); // NOSONAR

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
 * Fetches one URL without following redirects, connecting only to the address the SSRF guard approved.
 * @param parsed URL to fetch.
 * @returns The response, or null when the host is non-public or the request fails.
 */
async function fetchHop(parsed: URL): Promise<Response | null> {
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
	try {
		return await fetch(parsed, {
			dispatcher,
			redirect: 'manual',
			headers: { 'User-Agent': USER_AGENT },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		} as RequestInit); // lib.dom's RequestInit lacks undici's `dispatcher`
	} catch {
		return null;
	}
}

/**
 * Fetches one URL, following up to 3 redirects and re-checking every hop against the SSRF guard.
 * @param start First URL.
 * @param allowed Optional per-hop gate; a false answer for any hop, the first included, yields null.
 * @returns The final response, or null when blocked, failed or redirected too often.
 */
async function guardedFetch(
	start: string,
	allowed?: (url: URL) => Promise<boolean>
): Promise<Response | null> {
	let url = start;
	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		const parsed = URL.parse(url);
		if (!parsed || !/^https?:$/.test(parsed.protocol)) return null;
		if (allowed && !(await allowed(parsed))) return null;
		const res = await fetchHop(parsed);
		if (!res) return null;
		// nosemgrep: javascript.browser.tainted-redirect.tainted-redirect -- followed server-side; every hop re-runs the SSRF check.
		const location = res.headers.get('location');
		if (res.status < 300 || res.status >= 400 || !location) return res;
		const next = URL.parse(location, parsed);
		if (!next) return null;
		url = next.href;
	}
	return null;
}

/**
 * Reads a response body up to the byte cap.
 * @param res Response to read.
 * @returns Decoded text truncated at the cap, or null when the stream fails mid-read.
 */
async function readCapped(res: Response): Promise<string | null> {
	const reader = res.body?.getReader();
	if (!reader) return '';
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (size < MAX_BYTES) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			size += value.length;
		}
	} catch {
		return null;
	} finally {
		await reader.cancel().catch(() => undefined);
	}
	return Buffer.concat(chunks).subarray(0, MAX_BYTES).toString('utf8');
}

/**
 * Builds a per-call robots gate that fetches each origin's robots.txt at most once.
 * @returns A hop check: true when that origin's robots.txt permits Gravespeaker to fetch the URL.
 */
function robotsGate(): (url: URL) => Promise<boolean> {
	const cache = new Map<string, Promise<(href: string) => boolean>>();
	/**
	 * Loads one origin's robots.txt and returns its verdict function.
	 * @param origin Origin to load robots.txt from.
	 * @returns A permission check. A 4xx robots.txt means no rules (allow all). Per RFC 9309 an
	 * unreachable, 5xx or unreadable one means disallow all.
	 */
	const load = async (origin: string): Promise<(href: string) => boolean> => {
		const res = await guardedFetch(`${origin}/robots.txt`);
		if (!res || res.status >= 500) return () => false;
		if (!res.ok) return () => true;
		const body = await readCapped(res);
		if (body === null) return () => false;
		const robots = robotsParser(`${origin}/robots.txt`, body);
		return (href) => robots.isAllowed(href, USER_AGENT) !== false;
	};
	return async (url) => {
		let verdict = cache.get(url.origin);
		if (!verdict) {
			verdict = load(url.origin);
			cache.set(url.origin, verdict);
		}
		return (await verdict)(url.href);
	};
}

/**
 * Fetches a page and extracts its main text. Nothing is persisted.
 * @param url Source URL from a search record.
 * @returns Readable text, or null when blocked, disallowed, gated, non-HTML, unreadable or empty.
 */
export async function fetchPage(url: string): Promise<string | null> {
	const res = await guardedFetch(url, robotsGate());
	if (!res?.ok || !res.headers.get('content-type')?.includes('html')) return null;
	const body = await readCapped(res);
	if (body === null) return null;
	const { document } = parseHTML(body);
	const text = new Readability(document as unknown as Document).parse()?.textContent;
	return text?.replace(/\s+/g, ' ').trim() || null;
}
