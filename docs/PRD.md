# 🪦 Gravespeaker

**Every stone has a story. Let it speak.**

_Photograph a headstone. Discover a life. Hear the story the records left behind._

**Project:** Hacktoberfest 2026, Week 4: Ghost in the Machine
**Deadline:** October 31, 2026, 11:59 PM PDT
**Status:** MVP in development

## 1. Vision

Gravespeaker is a mobile-friendly web application that brings historical lives back into focus.

Users photograph a gravestone or upload an existing image. AI extracts identifying details, searches publicly accessible historical records, and reconstructs the deceased person's story in first person, as though they're speaking from beyond the grave.

The experience should feel mysterious and personal while remaining historically responsible.

**Core principle:** Resurrect the story, not invent the person.

## 2. MVP User Journey

| #   | Step                  | What happens                                                                             | Done when                                                                                      |
| --- | --------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | **Capture or upload** | Photograph a gravestone or select an existing image.                                     | Works from a phone camera and from a desktop file picker.                                      |
| 2   | **Identify**          | AI extracts names, dates, inscriptions and other useful details.                         | User can review and correct every extracted field before searching.                            |
| 3   | **Research**          | Search obituaries, cemetery records, historical archives and indexed public information. | Results come back with source URLs attached.                                                   |
| 4   | **Verify**            | Cross-reference names, dates and places.                                                 | When more than one plausible person matches, the user picks one (or none).                     |
| 5   | **Resurrect**         | Generate a short first-person narrative grounded in the confirmed records.               | Every factual sentence links to at least one source.                                           |
| 6   | **Explore**           | Show source links and separate documented facts from AI reconstruction.                  | Facts and reconstruction are visually distinct, and the narrative is labelled as AI-generated. |

If credible information can't be found, the app says so. It never fills historical gaps with fabricated claims.

## 3. Technical Direction

| Component            | Choice                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| App                  | SvelteKit (Vite) as one app: UI plus server endpoints, built with `adapter-node`                              |
| Runtime              | Node.js 26.12.1 / TypeScript                                                                                  |
| AI orchestration     | Mastra, running inside the SvelteKit server endpoints                                                         |
| Vision and OCR       | Gemma 4 (`gemma-4-26b-a4b-it` / `gemma-4-31b-it`) via the Gemini API, authenticated with an AI Studio API key |
| Historical search    | SerpApi                                                                                                       |
| Narrative generation | Gemma 4                                                                                                       |
| Narration (stretch)  | ElevenLabs                                                                                                    |
| Hosting              | Google Cloud Run, one service, with API keys in Secret Manager                                                |
| Builder              | Claude Code                                                                                                   |
| Development tracking | Entire                                                                                                        |

Model inference and historical search sit behind replaceable interfaces. Everything else stays concrete.

No self-hosted models unless benchmarks show a compelling advantage.

## 4. Key Engineering Challenges

**Headstone recognition**

- Weathered stone, damaged inscriptions, shadows, unusual typography and partial dates.
- Measure actual recognition accuracy instead of assuming a vision model performs well.

**Historical identity resolution**

- Common names, incomplete records, contradictory dates and similarly named people.
- Use multiple identity signals (name, birth/death dates, location) and make uncertainty explicit.
- Never silently combine different people's histories.

**Source discovery and reliability**

- Public availability doesn't guarantee unrestricted reuse.
- Respect access restrictions, provenance, licensing and unavailable records. Link to sources; don't republish their content.
- Every substantive historical claim must trace back to supporting evidence.

**First-person storytelling**

- Atmospheric and engaging without inventing relationships, events, memories, thoughts or emotions.
- Clearly label narratives as AI-generated historical reconstructions.
- Leave out unnecessary sensitive details about living people (for example, surviving relatives named in obituaries).

**Model selection**

- Benchmark Gemma 4 against a closed Gemini model on identical test inputs.
- Compare OCR accuracy, factual grounding, unsupported claims, latency and cost.
- Consider a specialised open OCR model only if testing justifies the extra integration.

## 5. Open Innovation and Challenge Alignment

The open-weight model has to meaningfully contribute to the finished app, not exist only for challenge eligibility.

**Thesis for the DEV post:**

> The value of open innovation isn't that we refused to use closed AI. It's that we could independently test, choose, and improve the technology instead of accepting one provider's answer as the only option.

Document where the open approach performs better, matches a closed alternative, or exposes tradeoffs. Back conclusions with real benchmarks and reproducible examples.

The post focuses on the problem, engineering decisions, real discoveries, failure cases, and the value of making forgotten histories more accessible.

## 6. Scope Boundaries

**Required**

- Functional mobile-friendly website
- Camera and image upload
- AI inscription extraction with user correction
- Public-record search and identity verification
- Source-grounded first-person biography
- Clickable citations
- Small reproducible model evaluation: `scripts/benchmark.ts` runs Gemma 4 and a closed Gemini model on the same fixture images and records OCR accuracy, grounding, unsupported claims, latency and cost
- Deployed public demo

**Stretch**

- ElevenLabs voice narration, with a basic male and female voice
  - The AI picks the voice from obituary evidence first (pronouns, relationship words such as "wife" or "son"), then the name.
  - The guess is shown with the extracted fields, and the user can switch it like any other correction.
  - The guess only selects a voice; it is never stated as a historical fact in the story.
- Additional historical record providers
- Specialized OCR model fallback
- Enhanced atmospheric animations

**Explicitly excluded**

- User accounts or authentication
- Family trees and genealogical graph exploration
- Cemetery navigation and maps
- Native Android or iOS applications
- Custom model hosting
- Persistent user profiles and photo libraries
- Paywalled or login-gated record sources
- Multi-person (companion) stones: the app reads one person per stone
- Optimizing for non-English inscriptions: nothing blocks them, but prompts and parsing target English

## 7. Privacy

- Uploaded images are processed in memory and never stored.
- API keys stay server-side. The browser never calls a model or search provider directly.

## 8. Schedule

| Date            | Focus                                             | Milestone                        |
| --------------- | ------------------------------------------------- | -------------------------------- |
| **Tue, Oct 27** | Repo, strict `CLAUDE.md`, Entire setup, scaffold  | Development foundation           |
| **Wed, Oct 28** | Upload/camera, Gemma vision, extracted fields     | Working headstone identification |
| **Thu, Oct 29** | SerpApi, Mastra workflow, identity matching       | Working historical research      |
| **Fri, Oct 30** | Narrative, citations, model comparison, Cloud Run | Public end-to-end demo           |
| **Sat, Oct 31** | DEV post, screenshots, final verification         | Challenge submitted              |

The schedule leaves room for GitHub Universe. Prefer vertical slices, with a deployable app at every milestone. Saturday is for documentation and submission, not essential development.

## 9. Definition of Done

A user can visit Gravespeaker on a phone, photograph or upload a real gravestone, confirm the extracted identity, and receive a readable first-person historical reconstruction with accessible source evidence.

If the history can't be reliably established, the app says so clearly.

The project includes a working public demo, documented technical decisions, a meaningful open-versus-closed model comparison, and an engaging DEV submission.

**Priority:** Complete one historically defensible end-to-end experience before adding features.

## 10. v2 (after the challenge)

Not part of the October 31 build. Captured so the ideas aren't lost.

**Obituary photos during narration**

- When the matched obituary has a photo, show it while the speaker is talking.
- Display it from its original URL with a visible credit and link. Never download, cache or re-host it, and skip any image whose source restricts embedding.
- This is the one deliberate exception to the "link, don't republish" rule in §4, so it needs a licensing check before it ships.

**Social media search for recent deaths (key v2 feature)**

- When the confirmed death year is 2010 or later, search public social media profiles in addition to the standard historical search.
- Earlier deaths skip social media. Facebook opened to the public in late 2006, and social networking use among online adults 50+ only reached 42% in 2010 (Pew), so earlier searches mostly come back empty.
- Runs through SerpApi in two steps:
  - Google Search engine with `site:` operators (for example `site:facebook.com`, `site:instagram.com`) plus name, dates and place, to find candidate profile URLs.
  - SerpApi's Facebook Profile and Instagram Profile engines to read public profile fields. Both take a profile ID or username, not a name, so the Google step has to come first.
- SerpApi has no LinkedIn engine. LinkedIn results come only from the Google `site:` step.
- Profile hits are candidates like any other search result. They go through the same identity verification in §2, and the user confirms the match.
- Recent deaths mean living relatives and friends are all over these profiles. Only facts about the deceased can reach the story; comments, tags and other people's posts never do.
- Link to the profile; don't republish posts or photos.

**Multi-person stones**

- Tune the extraction prompts for companion stones, where two people share one surname line.
- The MVP benchmark showed hosted Gemma reading every date on one but dropping the shared surname.
