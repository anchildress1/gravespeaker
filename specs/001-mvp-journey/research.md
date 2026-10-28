# Research: Gravespeaker MVP Journey

Each entry: decision, rationale, alternatives rejected.

## R1. Reading model and prompt

- **Decision**: Hosted `gemma-4-26b-a4b-it` on the Gemini API, run 9's rules rewritten as app-owned instructions plus one Zod schema in `inference/gemma.ts` (never imported from `benchmarks/`, which the Docker build excludes); run 10 re-measures the rewrite, temperature 0, top_p 0.95, top_k 64, default media resolution.
- **Rationale**: Run 9 scored 53/58 fields on 20 reviewed stones at 4.1 s median. Every stone from 1950 on read correctly. All three misses are parsing or worn-digit issues, not prompt issues.
- **Rejected**:
  - `gemma-4-31b-it`: slower (4.7–50 s) and emitted stray code fences in run 2.
  - `gemini-3.8-flash`: no accuracy gain on single-person stones; slower in run 2; closed model weakens the challenge thesis.
  - `MEDIA_RESOLUTION_LOW` (run 7): broke more than it fixed.
  - Local 12B / E2B: invent surnames on worn stones.

## R2. Orchestration: Mastra without workflow suspend

- **Decision**: Three stateless server endpoints (read, research, story). The client holds journey state between them. Mastra `Agent`s make the model calls. Mastra `createWorkflow`/`createStep` run the multi-step research and story pipelines in memory, with step `retries` on the network steps.
- **Rationale**: Mastra suspend/resume persists snapshots to a storage provider. The spec forbids persistence (no accounts, images never stored), and a store adds infra to a 4-day build. The visitor's pick is just the input to the next request.
- **Rejected**: Mastra suspend/resume with an in-memory store, which breaks across Cloud Run instances; one long-lived streaming request, which has the same problem and is harder on mobile.

## R3. Model access and retries

- **Decision**: Mastra model router with `model: { id: 'google/gemma-4-26b-a4b-it', apiKey: env.GEMINI_API_KEY }`. No `@ai-sdk/google` dependency. Model retries use the Agent's `maxRetries`. Search and page fetch use `createStep({ retries })`.
- **Rationale**: The router lists `google/gemma-4-26b-a4b-it`. Passing `apiKey` keeps the app reading the generic `GEMINI_API_KEY` per `CLAUDE.md` § Secrets instead of the router's default `GOOGLE_API_KEY`. CLAUDE.md requires Mastra's built-in retries.
- **Rejected**: Setting `GOOGLE_API_KEY` in deploy, which renames the secret mapping for no gain; hand-rolled retry loops, which CLAUDE.md forbids.

## R4. Structured output and the deterministic layer

- **Decision**: Every model call uses Mastra `structuredOutput` with a Zod schema. The result then passes through pure functions that own the format:
  - `inscription.ts`: drops names with no letters (`[]`, `[?]`), strips honorifics, splits `née X` into `maidenName`, validates dates against `YYYY | YYYY-MM-DD` with `?` digits, and maps anything else to unknown.
  - `identity.ts`: filters candidate groups (see R7).
  - `narrative.ts`: validates citations and quotes (see R8).
- **Rationale**: The benchmark showed exact strings are fragile across models and the schema doesn't prevent junk values. CLAUDE.md says the model never owns formatting.
- **Risk**: whether Mastra's parser tolerates fenced JSON from Gemma is unverified. The first read-endpoint test against a recorded fenced reply settles it. If it fails, add a Mastra output processor, not a hand parser.

## R5. Historical search

- **Decision**: Plain `fetch` to `serpapi.com/search.json` (the `serpapi` package uses `https`, which tests cannot mock), engine `google`, one query per research request: `"<normalized name>" <birth year> <death year> (obituary OR grave OR cemetery)`. A maiden name is not added: live runs showed an `OR "<first> <maiden> <last>"` variant buried the real record under unrelated hits. Use `num=10`, `gl=us`, `hl=en`. Unknown years are omitted from the query, never sent as `18?8`.
- **Rationale**: One call per stone keeps SerpApi quota spend predictable. Obituary and grave index pages both carry name + dates, which is what identity matching needs.
- **Rejected**:
  - Multiple engines or providers: PRD Stretch.
  - A Find a Grave scraper: no API and terms restrict it. SerpApi results that link there are fine.
- **Interface**: `SearchProvider.search(query): Promise<SourceRecord[]>`, with one implementation (`serpapi.ts`).

## R6. Gated and paywalled sources

- **Decision**: A static deny-list of hostnames is applied to search results before identity matching: `ancestry.*`, `newspapers.com`, `genealogybank.com`, `myheritage.*`, `findmypast.*`, `newspaperarchive.com`, `fold3.com`. A page fetch that returns 401/402/403 or a login redirect drops that source.
- **Rationale**: PRD §6 excludes paywalled and login-gated sources. A static list covers the big genealogy paywalls, and the fetch check catches the rest.
- **Rejected**: Detecting paywalls by page content, which is too fuzzy for a deterministic rule.

## R7. Identity resolution

- **Decision**:
  1. The model groups search results into candidate people with a structured output: `{ name, born, died, place, resultIds[] }`.
  2. Code then:
     - drops unknown `resultIds`;
     - drops any result claimed by more than one candidate from all of them, which prevents silent merges;
     - drops candidates whose known years conflict with the inscription (a `?` digit matches any digit);
     - drops candidates left with no results;
     - caps the list at 5, ordered by the number of matching inscription fields.
  3. The visitor always confirms, even when only one candidate remains.
- **Rationale**: Clustering free text into people is model work. Conflict and merge rules are deterministic and testable (Constitution III).
- **Rejected**: Pure string scoring, which can't tell two "John Smith 1950–2011" obituaries apart by snippet alone.

## R8. Story grounding (fetch page text)

- **Decision**: After confirmation, the story pipeline:
  1. Fetches the candidate's source pages in memory, at most 5 in parallel with an 8 s timeout and a 2 MB cap each.
     - Honors robots.txt (`robots-parser`) for user agent `Gravespeaker`.
     - Extracts the main text with `@mozilla/readability` on a `linkedom` DOM.
     - Falls back to the search snippet when a fetch fails.
  2. Sends the extracted text to the story agent, which returns sentences: `{ text, kind: 'fact' | 'reconstruction', claim: 'name' | 'birth' | 'death' | 'other', sourceIds[], quote }`.
  3. Code keeps a `fact` sentence only if every `sourceId` belongs to the candidate and its `quote` appears, after normalization, in one cited source's text. Otherwise the sentence is dropped.
  4. If no surviving fact has `claim: 'other'` with a quote containing a token beyond the deceased's name, month names and digits, the response is `insufficient` (spec FR-013). The model's `claim` label alone is never trusted for the bar.
  5. Fetched text is never returned to the browser or stored.
- **Rationale**: The user chose page text over snippets (2026-10-27). Snippets alone would fail the evidence bar on most stones. Quote matching gives a deterministic check against fabrication. The quote is never displayed, so source content isn't republished.
- **Relatives** (user decision, 2026-10-27): relationships are allowed as cited facts ("my wife of 52 years"). A relative may be named only when a cited source says they died first ("preceded in death by"). Survivors are never named. The story agent's instructions enforce this, and the grounding benchmark (next spec) measures it with obituaries that list survivors. No code check: telling a survivor's name from a predeceased relative's takes reading comprehension, not a pattern.
- **Rejected**: Snippets only (user rejected); `jsdom`, which is heavier than `linkedom`; a headless browser, which is far too heavy.

## R9. SSRF on page fetch

- **Decision**: The story endpoint receives source URLs from the client, so `fetchPage` checks every request:
  - only `https:`/`http:` URLs;
  - resolves DNS and rejects loopback, private, link-local (`169.254.0.0/16`, which includes the metadata server), CGNAT and ULA addresses;
  - follows redirects manually, at most 3 hops, re-checking each hop.
- **Rationale**: On Cloud Run, an open fetch can reach the metadata server and leak the service account token. Signing candidates server-side would need a new secret, and CLAUDE.md requires asking before adding one.
- **Rejected**: HMAC-signed candidate payloads, which need a new Secret Manager secret; re-running search in the story request, which doubles SerpApi spend.

## R10. Upload limits and formats

- **Decision**: Accept `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, up to 10 MB. The client uses `<input type="file" accept="image/*" capture="environment">`.
  - `capture` opens the camera on phones; desktop ignores it and shows the file picker.
  - Raise the Dockerfile's `BODY_SIZE_LIMIT` from `10M` to `12M` so multipart overhead doesn't trip it before the app's own check.
- **Rationale**: Phone photos are 2–8 MB. The Dockerfile already sets `10M`, which a 10 MB photo plus multipart overhead would exceed. All five types are supported Gemini image inputs.
- **Rejected**: Resizing images client-side. Run 8 showed image size doesn't change the input token count, so it saves nothing.

## R11. Dependency versions

- **Decision**: Add these exact runtime dependencies, resolved at install time:
  - `@mastra/core`
  - `zod` (v4)
  - `serpapi`
  - `@mozilla/readability`
  - `linkedom`
  - `robots-parser`
- **Constraint**: `@mastra/core` 1.79.0 was published 2026-10-27. If pnpm's release-age gate rejects it, pin the previous version. Never add `minimumReleaseAgeExclude`.
- **Repo config change**: the `package.json` dependency additions and the `Dockerfile` `BODY_SIZE_LIMIT` raise were approved by the user on 2026-10-27. No other repo config changes.

## R12. Benchmark coverage of story grounding

- **Decision**: Out of this spec. The PRD's grounding, unsupported-claims and cost comparison (Gemma vs Flash) becomes the next spec, built on the story pipeline from this one.
- **Rationale**: Constitution I calls for vertical slices. The story pipeline has to exist before it can be benchmarked.
