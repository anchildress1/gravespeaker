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

- **Decision**: Mastra model router with `model: { id: 'google/gemma-4-26b-a4b-it', apiKey: env.GEMINI_API_KEY }`. No `@ai-sdk/google` dependency. Model retries use the Agent's `maxRetries`. Search uses `createStep({ retries })`. Page fetch has no retries: `fetchPage` never throws.
- **Rationale**: The router lists `google/gemma-4-26b-a4b-it`. Passing `apiKey` keeps the app reading the generic `GEMINI_API_KEY` per `CLAUDE.md` § Secrets instead of the router's default `GOOGLE_API_KEY`. CLAUDE.md requires Mastra's built-in retries.
- **Rejected**: Setting `GOOGLE_API_KEY` in deploy, which renames the secret mapping for no gain; hand-rolled retry loops, which CLAUDE.md forbids.

## R4. Structured output and the deterministic layer

- **Decision**: Every model call uses Mastra `structuredOutput` with a Zod schema. The result then passes through pure functions that own the format:
  - `inscription.ts`: drops names with no letters (`[]`, `[?]`), strips honorifics, splits `née X` into `maidenName`, validates dates against `YYYY | YYYY-MM-DD` with `?` digits, and maps anything else to unknown.
  - `identity.ts`: matches results to the stone and builds the candidate (see R7).
  - `narrative.ts`: verifies fact quotes and checks the prose (see R8).
- **Rationale**: The benchmark showed exact strings are fragile across models and the schema doesn't prevent junk values. CLAUDE.md says the model never owns formatting.
- **Risk**: whether Mastra's parser tolerates fenced JSON from Gemma is unverified. The first read-endpoint test against a recorded fenced reply settles it. If it fails, add a Mastra output processor, not a hand parser.

## R5. Historical search

- **Decision**: Plain `fetch` to `serpapi.com/search.json` (the `serpapi` package uses `https`, which tests cannot mock), engines `google`, `yandex` and `yahoo` queried in parallel (all return organic results as link, title and snippet), the same query for each, one set of calls per research request: `"<normalized name>" <birth year> <death year> (obituary OR grave OR cemetery)`. A maiden name is not added: live runs showed an `OR "<first> <maiden> <last>"` variant buried the real record under unrelated hits. Google uses `num=10`, `gl=us`, `hl=en`. Unknown years are omitted from the query, never sent as `18?8`.
- **Merge**: Results are merged in that engine order and deduplicated by canonical URL (scheme, `www.`, trailing slash, query and hash ignored; one Find a Grave memorial under any locale subdomain or slug is one page). One engine failing is tolerated; losing every engine is a provider failure (502).
- **Cost**: One SerpApi search credit per engine per research request (3 credits). The engine set was cut from five to three after [`search-1.json`](../../benchmarks/results/search-1.json): over 10 stones Google, Yandex and Yahoo produced every kept source (22, 9 and 3), while Bing returned 94 results and no match at a 9.9 s median and DuckDuckGo returned one result.
- **Rationale**: One query per stone keeps SerpApi quota spend predictable. Several engines recover records Google alone ranks low. Obituary and grave index pages both carry name + dates, which is what identity matching needs.
- **Rejected**:
  - Multiple search providers: PRD Stretch. Several engines through the one SerpApi integration are in scope.
  - A Find a Grave scraper: no API and terms restrict it. SerpApi results that link there are fine.
- **Interface**: `SearchProvider.search(query): Promise<SourceRecord[]>`, with one implementation (`serpapi.ts`).

## R6. Gated and paywalled sources

- **Decision**: A static deny-list of hostnames is applied to search results before identity matching: `ancestry.*`, `newspapers.com`, `genealogybank.com`, `myheritage.*`, `findmypast.*`, `newspaperarchive.com`, `fold3.com`. A page fetch that returns 401/402/403 or a login redirect drops that source.
- **Rationale**: PRD §6 excludes paywalled and login-gated sources. A static list covers the big genealogy paywalls, and the fetch check catches the rest.
- **Rejected**: Detecting paywalls by page content, which is too fuzzy for a deterministic rule.

## R7. Identity resolution

- **Decision**: A deterministic engine, `resolveMatches(inscription, records)`, with no model call. Keys: name, birth year, death year.
  1. Name key: the surname (or the maiden name) as a whole word, accents folded, generational suffixes (Jr, Sr, II-V) ignored, plus at least one of the stone's given names, in the title or snippet.
  2. Year keys: read from the text near the name by label ("born", "died", "d.", "passed away"), by a range like `(1932-2017)`, or derived from "age N" with a one-year slack. A `?` digit in the stone's year matches any digit.
  3. A key the result does not state is neutral. A stated year that disagrees excludes the result (a namesake).
  4. A result with the name and at least one matching date is kept even when its other date is missing.
  5. If no result confirms a date, name-only results are kept as unverified. When any result confirms at least one date, name-only results are dropped.
  6. Results are ordered by number of matching keys, then by whether the page looks like a record (obituary, cemetery, grave, memorial, funeral, died, born). At most 5 become the candidate's sources.
  7. Results that agree on every stated year form one candidate. Results whose stated years contradict each other (two namesakes that both fit a worn stone) form separate candidates, best first, at most three, so two people are never merged. Each Candidate: name = the inscription's name; born/died = the year a matched result states, else null.
  8. Confidence: `high` when every key the stone offers matches (and at least two do), `medium` for two or more matching keys otherwise, `low` for name only.
  9. The visitor always confirms, even for the single candidate, and sees the confidence. `low` is labelled "Unverified: only the name matches. Check the sources before confirming."
- **Rationale**: Name, year and conflict rules are deterministic and testable (Constitution III). A model call added latency and could attach a result to the wrong person.
- **Tradeoff**: A search result is not proof that two records are the same person. A namesake whose snippet states no dates can still be returned, but only as unverified low confidence when nothing stronger exists. The visitor must confirm with the sources visible.
- **Rejected**: Having a model pick or group results (latency, and it let one result attach to the wrong person).

## R8. Story grounding (fetch page text)

- **Decision**: After confirmation, the story pipeline:
  1. Fetches the candidate's source pages in memory, at most 5 in parallel with an 8 s timeout and a 2 MB cap each.
     - Honors robots.txt (`robots-parser`) for user agent `Gravespeaker`.
     - Extracts the main text with `@mozilla/readability` on a `linkedom` DOM.
     - Falls back to the search snippet when a fetch fails.
  2. Fact extraction (model call 1, temperature 0): the model returns facts as `{ claim, sourceId, quote }`. Code keeps a fact only if its quote appears verbatim in the cited source's text (normalized for case, punctuation and whitespace), drops repeats, and drops any fact whose quote names survivors (patterns such as "survived by", "survivors", "leaves behind").
  3. If no verified fact says anything beyond the name, months and dates, the response is `{ status: 'insufficient' }` and the second call is skipped (spec FR-013).
  4. Prose (model call 2, Gemma's recommended sampling: temperature 1.0, top_p 0.95, top_k 64): the model writes one theatrical first-person paragraph of about 100-170 words from the verified fact quotes only. It is plain spoken prose with no stage directions or markup, because a voice service will read it aloud later.
  5. Code splits the paragraph into sentences and drops any sentence that adds a number or number word, a proper noun, or a negation attached to a fact that the verified facts, the name and month names do not give. It also drops repeated sentences. If the surviving paragraph no longer uses a real fact, the response is `{ status: 'insufficient' }`.
  6. The response lists only the sources of facts the paragraph actually uses. Fetched text is never returned to the browser or stored.
- **Rationale**: The user chose page text over snippets (2026-10-27). Snippets alone would fail the evidence bar on most stones. Quote matching gives a deterministic check on every fact. The quote is never displayed, so source content isn't republished.
- **Limit**: The deterministic prose check covers numbers, names and negations. It cannot check the meaning of free prose, so the prose prompt is what keeps the atmosphere from inventing life events.
- **Relatives** (user decision, 2026-10-27): relationships are allowed as cited facts ("my wife of 52 years"). A relative may be named only when a cited source says they died first ("preceded in death by"). Survivors are never named. Facts whose quote names survivors are dropped by pattern, and the prose prompt covers the rest. The grounding benchmark (next spec) measures this with obituaries that list survivors.
- **Rejected**: Snippets only (user rejected); `jsdom`, which is heavier than `linkedom`; a headless browser, which is far too heavy.

## R9. SSRF on page fetch

- **Decision**: The story endpoint receives source URLs from the client, so `fetchPage` checks every request:
  - only `https:`/`http:` URLs;
  - resolves DNS once per hop and rejects loopback, private, link-local (`169.254.0.0/16`, which includes the metadata server), CGNAT, ULA, multicast, reserved, benchmarking and documentation IPv4 ranges, and IPv6 multicast, NAT64, 6to4 and Teredo addresses;
  - pins the connection to the checked address with an `undici` dispatcher, so a second lookup cannot return a different address;
  - follows redirects manually, at most 3 hops, re-checking each hop;
  - checks robots.txt at every redirect hop (once per origin). An unreachable, 5xx or unreadable robots.txt means the page is skipped (RFC 9309); a 4xx robots.txt means no rules;
  - a body that fails mid-read or a malformed redirect target makes that source unavailable.
- **Rationale**: On Cloud Run, an open fetch can reach the metadata server and leak the service account token. Signing candidates server-side would need a new secret, and CLAUDE.md requires asking before adding one.
- **Rejected**: HMAC-signed candidate payloads, which need a new Secret Manager secret; re-running search in the story request, which doubles SerpApi spend.

- **Accepted for the MVP** (user decision 2026-10-28): `/api/story` trusts the candidate, sources and snippets the browser sends, so a direct caller can request a story for sources research never returned. The story reaches only that caller, and the SSRF guard still covers every URL it fetches. The later fix is to sign the research result server-side (a new secret, which needs approval first) or to re-run research inside the story request.

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
  - `undici`
  - `@mozilla/readability`
  - `linkedom`
  - `robots-parser`
- **Constraint**: `@mastra/core` 1.79.0 was published 2026-10-27. If pnpm's release-age gate rejects it, pin the previous version. Never add `minimumReleaseAgeExclude`.
- **Repo config change**: the `package.json` dependency additions and the `Dockerfile` `BODY_SIZE_LIMIT` raise were approved by the user on 2026-10-27. No other repo config changes.

## R12. Benchmark coverage of story grounding

- **Decision**: Out of this spec. The PRD's grounding, unsupported-claims and cost comparison (Gemma vs Flash) becomes the next spec, built on the story pipeline from this one.
- **Rationale**: Constitution I calls for vertical slices. The story pipeline has to exist before it can be benchmarked.
