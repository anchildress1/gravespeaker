/**
 * Reduces a URL to a key shared by duplicates: no scheme, "www.", locale subdomain, query or hash.
 * @param link A result link.
 * @returns The dedupe key, or null when the link is not a web URL.
 */
export function canonicalUrl(link: string): string | null {
	const url = URL.parse(link);
	if (!url || !/^https?:$/.test(url.protocol)) return null;
	const host = url.hostname.toLowerCase().replace(/^www\./, '');
	// Find a Grave serves one memorial under many locale subdomains and slugs.
	const memorial =
		/^([a-z]{2}\.)?findagrave\.com$/.exec(host) && /\/memorial\/(\d+)/.exec(url.pathname);
	if (memorial) return `findagrave.com/memorial/${memorial[2]}`;
	return `${host}${url.pathname.replace(/\/+$/, '')}`;
}
