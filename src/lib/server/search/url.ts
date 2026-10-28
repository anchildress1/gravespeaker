/** Query parameters that track the visitor, not the page; they never change which page is served. */
const TRACKING_PARAMS = new Set(['fbclid', 'gclid', 'msclkid', 'dclid', 'ref', 'mc_cid', 'mc_eid']);

/**
 * Tells whether a query parameter is tracking noise.
 * @param name Parameter name.
 * @returns True for utm_* and known click-id parameters.
 */
function isTracking(name: string): boolean {
	const lower = name.toLowerCase();
	return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

/**
 * Reduces a URL to a key shared by duplicates: no scheme, "www.", locale subdomain, hash or tracking parameters.
 * @param link A result link.
 * @returns The dedupe key, or null when the link is not a web URL.
 */
export function canonicalUrl(link: string): string | null {
	const url = URL.parse(link);
	if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) return null;
	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	// Find a Grave serves one memorial under many locale subdomains and slugs.
	const isFindAGrave = host === 'findagrave.com' || host.endsWith('.findagrave.com');
	const memorial = isFindAGrave ? /\/memorial\/(\d+)/.exec(url.pathname) : null;
	if (memorial) return `findagrave.com/memorial/${memorial[1]}`;
	// Some sites address content only by query (e.g. ?o_id=), so the remaining parameters are part of the identity.
	const params = [...url.searchParams]
		.filter(([name]) => !isTracking(name))
		.map(([name, value]) => `${name}=${value}`)
		.sort((a, b) => a.localeCompare(b));
	const query = params.length ? `?${params.join('&')}` : '';
	return `${host}${url.pathname.replace(/\/+$/, '')}${query}`;
}
