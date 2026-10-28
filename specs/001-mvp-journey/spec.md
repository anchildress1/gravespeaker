# Feature Specification: Gravespeaker MVP Journey

**Feature Branch**: `feat/mvp-journey`

**Created**: 2026-10-27

**Status**: Draft

**Input**: User description: "Gravespeaker MVP end-to-end journey per docs/PRD.md §2: capture/upload headstone photo, extract name + life dates via Gemma 4, search public records via SerpApi, verify identity (user picks candidate or none), generate source-grounded first-person narrative with per-sentence citations, show facts vs AI reconstruction. Use benchmarks/ results to inform decisions."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Read the stone (Priority: P1)

A visitor photographs a headstone on their phone (or picks an image on desktop) and sees the name and birth and death dates the app read from it.

**Why this priority**: Every later step depends on a correct reading. Alone, it already demonstrates the open model reading weathered stones.

**Independent Test**: Upload each reviewed fixture image and compare the displayed fields with `fixtures/manifest.json`.

**Acceptance Scenarios**:

1. **Given** a phone browser, **When** the visitor chooses to photograph a stone, **Then** the device camera opens and the captured photo is submitted.
2. **Given** a desktop browser, **When** the visitor picks an image file, **Then** that image is submitted.
3. **Given** a legible single-person stone, **When** reading finishes, **Then** the name, birth date and death date are shown read-only before any search starts.
4. **Given** a stone with a worn digit the reader marked as unreadable, **When** fields are shown, **Then** the unreadable digit is shown as unknown, not guessed.
5. **Given** a stone with no legible name, **When** reading finishes, **Then** the app says no name could be read and offers to try another photo.
6. **Given** a name carved with a maiden name ("née Staples"), **When** fields are shown, **Then** the name is shown without the "née" clause and the maiden name is kept as a search signal.

---

### User Story 2 - Find and confirm the person (Priority: P2)

From the read fields, the app searches public records and shows candidate people, each with source links. The visitor picks the right person, or none.

**Why this priority**: Identity confirmation is the gate that stops misreads and namesakes from reaching the story.

**Independent Test**: With search responses recorded for a fixture, confirm candidates appear with source links and that picking "none" ends the journey without a story.

**Acceptance Scenarios**:

1. **Given** extracted fields, **When** the search completes, **Then** each candidate shows name, life dates, place when known, and at least one source link.
2. **Given** results for two different people with the same name, **When** candidates are shown, **Then** they appear as separate candidates and are never combined.
3. **Given** exactly one plausible candidate, **When** results are shown, **Then** the visitor must still confirm it or pick "none of these"; the story never starts automatically.
4. **Given** candidates are shown, **When** the visitor picks "none of these", **Then** the app shows the stone-only epitaph with a note that no public record was confirmed; no AI story is generated.
5. **Given** no records match, **When** search completes, **Then** the app shows the stone-only epitaph with a note that no public records were found; no AI story is generated.

---

### User Story 3 - Hear their story (Priority: P3)

After confirming a person, the visitor reads a short first-person narrative in which every factual sentence links to its source, with documented facts visually distinct from AI reconstruction.

**Why this priority**: This is the payoff, but it is only trustworthy once Stories 1 and 2 hold.

**Independent Test**: For a confirmed candidate with recorded sources, every factual sentence in the narrative carries at least one citation that resolves to one of that candidate's sources.

**Acceptance Scenarios**:

1. **Given** a confirmed candidate, **When** the story is shown, **Then** it is labelled as an AI-generated historical reconstruction.
2. **Given** the story, **When** the visitor reads a factual sentence, **Then** it links to at least one source of the confirmed candidate.
3. **Given** the story, **When** displayed, **Then** documented facts and atmospheric reconstruction are visually distinct.
4. **Given** an obituary that says "survived by his wife Jane and son Mark", **When** the story is generated, **Then** it may say "I left behind my wife and son" but never "Jane" or "Mark".
5. **Given** a source that says a relative died before the deceased ("preceded in death by his wife Ruth"), **When** the story is generated, **Then** it may name Ruth, with a citation.
6. **Given** a generated sentence that states a fact no source supports, **When** the story is checked before display, **Then** that sentence is removed or the fact is rendered as unknown.
7. **Given** the confirmed candidate's records hold nothing beyond what the stone already says (name and life dates only), **When** the story would be generated, **Then** the app shows the stone-only epitaph with a note that the records hold nothing beyond the stone.
8. **Given** an inscription `Gaynor Claire Hawks`, born `1932-03-10`, died `2017-12-27`, viewed on 2026-10-31, **When** the epitaph is shown, **Then** it reads "My name was Gaynor Claire Hawks. I was born on March 10, 1932. I died on December 27, 2017. I've been here 8 years."
9. **Given** a died date with a `?` digit, **When** the epitaph is shown, **Then** the death sentence and the years-here sentence are omitted, never guessed.

---

### Edge Cases

- No path after a legible read ends on a blank dead end: "none of these", no records and not-enough-on-record all show the stone-only epitaph.

- Stone commemorates more than one person: each person read is shown read-only and the visitor picks one to research. No tuning for companion stones (benchmark: Gemma drops the shared surname), so a wrong name fails at the confirm step.
- Photo is not a headstone, or is blank: same outcome as "no legible name".
- Reader returns a "name" with no letters (`[]`, `[?]`): treated as no legible name (seen on the illegible fixture in runs 8 and 9).
- Reader output wrapped in stray code fences or otherwise malformed: parsed defensively; if still unusable, the visitor sees a retryable error.
- Only a birth or death year is carved, or a date is absent: shown as year-only or unknown; search still runs.
- Confident misread digit (Ellis 1818 → 1848): accepted in the MVP; it fails at the confirm step (no match or visitor picks none).
- Non-English inscription: not rejected; no special handling.
- Model or search provider fails or times out: visitor sees a plain error with a retry; no partial story is shown.
- Search result from a login-gated or paywalled source: not used as a candidate source.
- Image larger than the upload limit or not an image: rejected before reading with a clear message.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: Visitors MUST be able to submit a headstone image from a phone camera or a desktop file picker.
- **FR-002**: System MUST reject non-image uploads and images over the size limit before reading.
- **FR-003**: System MUST extract, for the person the stone is for, the name and birth and death dates.
- **FR-004**: System MUST normalize extracted output in deterministic code: name cleanup (honorifics, "née" clause split into a maiden-name signal), date format (`YYYY-MM-DD`, `YYYY`, unknown digits), and rejection of letterless names.
- **FR-005**: System MUST show extracted fields read-only before searching.
- **FR-006**: System MUST search public obituaries, cemetery records and archives using the name and life dates. The maiden name is a read signal only; live searches showed it hurts recall.
- **FR-007**: Every candidate MUST carry at least one source URL.
- **FR-008**: System MUST exclude login-gated and paywalled sources.
- **FR-009**: System MUST never combine records that may belong to different people into one candidate.
- **FR-010**: Visitors MUST be able to choose one candidate or "none of these".
- **FR-011**: System MUST require explicit confirmation even when only one candidate is found.
- **FR-012**: When more than one person is read from a stone, visitors MUST pick one before searching.
- **FR-013**: System MUST generate an AI story only when the confirmed candidate has at least one source with information beyond the stone's name and life dates.
- **FR-014**: System MUST generate a first-person narrative only from the confirmed candidate's sources.
- **FR-015**: Every factual sentence in the narrative MUST cite at least one of those sources; uncited factual claims MUST NOT be displayed.
- **FR-016**: Narrative MUST be labelled AI-generated and MUST visually separate documented facts from reconstruction.
- **FR-017**: Narrative MAY state sourced family relationships (spouse, children, years married). It MAY name a relative only when a cited source says that relative died before the deceased. It MUST NOT name survivors or other living people.
- **FR-018**: Narrative MUST NOT invent relationships, events, memories, thoughts or emotions.
- **FR-019**: When the visitor picks "none of these", no records are found, or the evidence bar (FR-013) fails, the system MUST show the stone-only epitaph and MUST say no public record supports a fuller story. It MUST NOT generate an AI story.
- **FR-023**: The stone-only epitaph MUST be built by deterministic code from the read fields only: "My name was {name}.", "I was born on {born}.", "I died on {died}.", "I've been here {n} years." (whole years since the death date; "less than a year" under 1). A sentence whose field is unknown or contains a `?` digit is omitted; year-only dates render as "in {YYYY}". It cites the headstone as its source and is not labelled AI-generated.
- **FR-020**: Uploaded images MUST be processed in memory and never stored.
- **FR-021**: The browser MUST never call a model or search provider directly.
- **FR-022**: The journey MUST be usable on a phone-width screen.

### Key Entities

- **Extracted Inscription**: name as read, normalized name, maiden name (optional), birth date, death date; each date may be full, year-only, partially unknown, or absent.
- **Source Record**: URL, title, publisher/site, short snippet used for matching; never republished in full.
- **Candidate**: one hypothesized person — name, life dates, place when known, and the source records attributed to them.
- **Story**: ordered sentences; each sentence is either a cited fact (one or more Source Records) or labelled reconstruction.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: On the 20 reviewed fixtures, at least 57 of 58 fields are read correctly (run 9 scored 53/58; the Hawks "née" fix recovers 3 fields and the illegible-stone fix 1; only the worn Ellis 1818 digit may still miss).
- **SC-002**: The illegible fixture yields "no legible name", never a person.
- **SC-003**: Median time from submitting a photo to seeing extracted fields is under 6 seconds (run 9 median: 4.1 s).
- **SC-004**: 100% of factual sentences in generated narratives cite a source belonging to the confirmed candidate.
- **SC-005**: Zero AI stories are generated when the visitor picks "none" or no records are found; every such path ends on the stone-only epitaph.
- **SC-006**: A first-time visitor on a phone completes photo → story in under 2 minutes, excluding reading time.

## Assumptions

- Extraction uses hosted `gemma-4-26b-a4b-it` with the run 9 prompt and schema, at temperature 0. It scored 91% on 20 stones at 4.1 s median and matched Gemini Flash on single-person stones; 31B is slower and emitted stray code fences.
- Narrative generation uses the same hosted Gemma 4 model unless the benchmark shows a grounding gap.
- Free-tier Gemini API latency spikes are tolerated; no paid tier.
- Field correction is a v2 feature; misreads fail at the confirm step.
- One person per stone; English inscriptions are the tuning target.
- No accounts, no persistence, no history between visits.
- Voice narration and other PRD Stretch items are out of scope.
