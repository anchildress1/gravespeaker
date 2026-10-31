# 🔎 Search: finding the person on the stone

How research turns a carved name and dates into sources, what broke along the way, and what is still open. The final design is research run 25 (`benchmarks/results/research-25.json`), which replays every search from saved SerpApi responses in `fixtures/serp/`. Run 20 is run 19 with the infant's corrected dates; run 21 adds the review fixes and the re-recorded Google redirects. Runs 22 to 25 replay the same searches after later code-review fixes and return exactly run 21's candidates.

> **Ground truth is reviewed.** Every name and date in `fixtures/people.json` (9 people) and `fixtures/manifest.json` (21 stones) is user-reviewed. "Dated" below is the identity engine's grade; a match is proven to be the right person only where it is that person's own reviewed memorial.

## Final design

- **Phases**, in the order tried:
  1. name and dates
  2. name, dates and town
  3. name and town (only when the stone has a town)
- **Keyword pairs:** each phase is asked plain first, then with `(obituary OR grave OR cemetery)`.
- **Engines:** Yandex first; Google only when Yandex finds no dated match.
- **Stop:** the first dated match (high or medium) ends the loop.
- **Sources:** interleaved by rank across searches, then capped at five per candidate.
- **Outage:** both engines failing in a row returns an error instead of "nobody found".
- **Cost:** 1 to 12 SerpApi credits per stone. A stone with no dated match spends all of them.

## Key challenges

| Challenge                        | What went wrong                                                                                                 | How we overcame it                                                                                                                                                                                                  | Proof                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Testing spent credits            | Every eval run hit SerpApi live and leaned on a cache                                                           | Record once, replay at the fetch boundary; the API key is scrubbed and a leak fails the recording                                                                                                                   | `research.eval.ts`, 0 leaks per recording |
| Story inputs drifted             | Story fixtures depended on whatever search returned that day                                                    | `record-stories.ts` builds only from a saved research run and refuses one with missing searches                                                                                                                     | `fixtures/stories-recorded.json`          |
| Find a Grave text was a tour     | Readability extracted the hidden welcome tour, not the memorial                                                 | Strip hidden elements and dialogs before extraction                                                                                                                                                                 | `pages.test.ts`                           |
| Google redirect links            | `/goto` links, relative and absolute, were kept as pages                                                        | Treat any link on the redirect host as a hop and follow every one (free)                                                                                                                                            | `serpapi.test.ts`                         |
| Relatives and namesakes matched  | A relative's memorial, a "Daisy A." for a "Daisy M.", a Sr. for a Jr., or an initial alone passed as the person | Reject a title with other life years, an initial-only match and any conflicting year; set aside a mention whose middle initial or suffix the stone rules out, keeping the result when it also names the stone's own | `identity.test.ts`                        |
| Dates went unread                | Abbreviated months, weekdays, ordinals, `05-Sep-1929`, "passing", "Name, 45," and splits after "Mr." or "St."   | Wider date and cue patterns; the sentence splitter skips abbreviations                                                                                                                                              | `identity.test.ts`                        |
| Life pages were thrown out       | A name-only result had to read like a death record                                                              | Dropped that rule; a name-only result stays unless it states a year against the stone                                                                                                                               | `identity.test.ts`                        |
| Keywords cut both ways           | With death keywords, life pages vanished; without them, obituaries ranked lower                                 | Ask each phase plain, then with keywords                                                                                                                                                                            | research-13 vs 14                         |
| One phase crowded the rest       | Five results from phase 1 filled the cap before later phases' best hits                                         | Interleave by rank across searches, ranking each engine's results on their own                                                                                                                                      | `src/routes/api/research/server.test.ts`  |
| Google redirects went missing    | 418 of 717 saved redirect hops answered without a location while recording, so their pages vanished             | Re-recorded them (all 418 resolved); the recorder now never saves a hop that does not redirect                                                                                                                      | `research.eval.ts`, run 21                |
| Outages read as "nobody found"   | Search failing after the first query fell through to name-only or empty results                                 | Stop and report an outage once both engines fail in a row                                                                                                                                                           | `src/routes/api/research/server.test.ts`  |
| No way to prove what was dropped | Couldn't show the right sources were discarded and the best kept                                                | `audit-sources.ts` lists every hit with its verdict and reason                                                                                                                                                      | `sources-N.json`                          |
| Search order cost                | Unclear whether reordering or a stricter stop saved credits                                                     | Measured on replay; kept the cheapest                                                                                                                                                                               | table below                               |

## Stop rule and order

Same 9 people, replayed. Search counts include retries after Google timeouts.

| Run | Order                           | Stop        | Searches | Dated |
| --- | ------------------------------- | ----------- | -------- | ----- |
| 19  | plain, then keywords, per phase | first dated | **72**   | 5     |
| 17  | all plain, then all keywords    | first dated | 78       | 5     |
| 18  | all plain, then all keywords    | 2 sources   | 128      | 5     |
| 16  | all plain, then all keywords    | 3 sources   | 136      | 5     |

- No dated match reached 3 sources, so a 3-source minimum runs every search for every stone.
- Running all plain queries first delays the keyword queries that found Chartre and Louella.

Tried and dropped: Yandex's `|` OR syntax and a name-variant query. Neither found anyone new.

## Gaps we could not fill

| Gap                                | Effect                                                                                                       | Next step                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| No dated match for 4 of 9          | Pineda, Reynolds Jr., Hiatt and Yacobi end name-only after 12 to 16 searches                                 | Match on place instead of dates (next branch) |
| Known memorial rarely returned     | Only 2 of the 9 people's own memorials came back from any search                                             | Place matching; no extra search sources       |
| Name-only results are mostly noise | Only the story's page-proof rule keeps them out of a story                                                   | Place matching to separate namesakes          |
| Single-source matches              | Only Olivia's dated match had a second source                                                                | None in scope; the story cites what it has    |
| Google timeouts                    | 4 saved Google searches timed out at the 20 s cap and replay as misses; runs list them under `meta.failures` | Re-record them; about 4 credits               |
| Gated sites                        | Ancestry and similar are dropped unread                                                                      | None; no access                               |
| Most matches unproven              | Beyond the 2 own memorials, a dated match rests on the identity engine's grade                               | None in scope; the engine is the judge        |
| Photo fixtures use old queries     | Their saved searches predate the keyword pairs, so a full 30-person replay can't run                         | Re-record, about 100 to 150 credits           |
