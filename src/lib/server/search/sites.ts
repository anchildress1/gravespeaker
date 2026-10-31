import type { SourceRecord } from '#lib/types.ts';

const GATED =
	/(^|\.)(ancestry|myheritage|findmypast)\.[a-z.]+$|(^|\.)(newspapers|genealogybank|newspaperarchive|fold3)\.com$/;
// People-search directories list the living by name, so they match namesakes and never prove a death.
const DIRECTORIES =
	/(^|\.)(whitepages|truepeoplesearch|beenverified|411|192|spokeo|fastpeoplesearch)\.com$|(^|\.)ufind\.name$/;

/**
 * Removes records from paywalled or login-gated genealogy sites and people-search directories.
 * @param records Search hits.
 * @returns Hits on open sites that can hold a record of the dead.
 */
export function dropGated(records: SourceRecord[]): SourceRecord[] {
	return records.filter((r) => {
		// A trailing dot is the same host in DNS, and would slip past the anchored patterns.
		const site = r.site.toLowerCase().replace(/\.+$/, '');
		return !GATED.test(site) && !DIRECTORIES.test(site);
	});
}
