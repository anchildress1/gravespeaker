# Quickstart: Validate the MVP Journey

## Prerequisites

- Node 26.12.1 and pnpm 11.28.9 via Volta (`VOLTA_FEATURE_PNPM=1`, set by the Makefile).
- `.env` with `GEMINI_API_KEY` and `SERPAPI_API_KEY` (keys listed in `.env.example`).

## Automated gate

```sh
make install
make ai-checks
make e2e
```

Expected: `make ai-checks` (format, lint, typecheck, unit tests, build) and `make e2e` pass with zero warnings. Unit tests mock only Gemini and SerpApi at the network boundary.

Unit scenarios that must exist (behavior, not wiring):

| Module        | Scenarios                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `inscription` | `[]`/`[?]` name dropped; `née Staples` split; honorifics dropped; `18?8` kept; `March 1941` → `null`                                                                                                                                                                                                                                                                                   |
| `identity`    | Right person with death date missing returned (medium); name plus both years high; age-derived birth; conflicting year excluded; namesake excluded while the real match is kept; different given name excluded; whole-word surname; maiden name; suffix; accents; `?` wildcard; name-only low; record-like ranking; far-away years ignored; cap 5 sources; none matched → 0 candidates |
| `narrative`   | Fact with quote absent from source dropped; repeated fact dropped; survivor-naming quote dropped; only name/date facts → `insufficient`; prose sentence adding a number, name or negation dropped                                                                                                                                                                                      |
| `fetchPage`   | `169.254.169.254`, `localhost`, `10.x` rejected; redirect to private IP rejected; robots disallow skipped; unreachable or 5xx robots.txt skipped                                                                                                                                                                                                                                       |
| `epitaph`     | Full dates → 4 sentences; year-only → "in YYYY"; `?` in died → no death or years sentence; died < 1 year ago → "less than a year"; exactly 1 → "1 year"                                                                                                                                                                                                                                |
| upload checks | Non-image → 415; 11 MB → 413                                                                                                                                                                                                                                                                                                                                                           |
| providers     | Gemini 5xx / SerpApi error after retries → 502 `provider_failed`; other workflow failure → 500. Search: several engines merged, URL dedupe incl. Find a Grave locales, one engine failing tolerated, every engine failing → `ProviderError`, no results → empty, bad links skipped                                                                                                     |

## Extraction accuracy (SC-001, SC-002, SC-003)

Run the app's read path (model call + `inscription.ts` normalization) against all reviewed fixtures and score with `benchmarks/score.ts`. Save as the next `runN` files; never overwrite.

Expected: ≥ 57/58 fields, illegible fixture returns no people, median < 6 s.

## Manual end-to-end (phone)

1. `make dev`, open the LAN URL on a phone.
2. Tap capture → camera opens → photograph `fixtures/chambers-2011.jpg` on a screen → fields show read-only before search.
3. Candidates appear with source links; pick the match.
4. Story shows a "Story generated with AI" label and one paragraph; the sources it used are listed underneath with working links.
5. Repeat with `fixtures/illegible-marble.jpg` → "no legible name", offer to retry.
6. Repeat with `fixtures/ellis-1818.jpg` → pick "none of these" → stone-only epitaph with "No public record was confirmed"; no AI label.

## Desktop

Open `make dev` URL on desktop → file picker opens (no camera) → upload `fixtures/hawks-2017.jpg` → name shows without "née Staples".
