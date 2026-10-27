# 🔬 OCR smoke test: Gemma 4 vs Gemini Flash

First pass at the PRD question "can Gemma read a headstone?", run on 2026-10-27 before any app code existed. This is a throwaway script, not `scripts/benchmark.ts`. It measures transcription and field extraction only. Grounding, unsupported claims and cost per run come later with the real benchmark.

## Setup

- **Fixtures:** the 8 human-reviewed stones in `fixtures/manifest.json` (5 recent, 2 historic, 1 illegible).
- **Models:**
  - Hosted on the Gemini API: `gemma-4-26b-a4b-it`, `gemma-4-31b-it`, `gemini-3.8-flash`.
  - Local on an M4 Max (36 GB) via Ollama: `gemma4:12b`.
- **Settings:** temperature 0, one call per image, identical prompt for every model. Ollama runs used `think: false`.
- **Timeout:** 240 s per hosted call. No retries.

Prompt:

```text
You are reading a photo of a gravestone for a historical research tool.

Transcribe ONLY what is carved or cast on the stone. Do NOT add, guess, or complete anything you cannot see.

Return ONLY a JSON object, no prose, no code fences:
{"text": string|null, "people": [{"name": string, "born": string|null, "died": string|null}]}

- text: every line of the inscription in order, joined with "\n". Write "[?]" for a word you cannot read. null if nothing is legible.
- people: one entry per person commemorated. name exactly as carved. born/died as "YYYY" or "YYYY-MM-DD"; use "?" for an unreadable digit; null when the date is not on the stone. [] if no name is legible.
- A year that is not a birth or death (marriage length, erection date) is NOT a life date.
```

## Scoring

- **Fields:** name, born and died per expected person, each right or wrong.
  - Names compare case- and punctuation-insensitively, with honorifics (Mr, Mrs, Miss, Dr) dropped.
  - A wrong name zeroes that person's dates too, because an app can't attach dates to the wrong person.
  - The illegible stone scores 1 field: correct when the model returns no people.
- **Text similarity:** 1 − Levenshtein distance / expected length, after lowercasing and collapsing punctuation.

## Results

| Fixture             | gemma-4-26b-a4b-it | gemma-4-31b-it  | gemini-3.8-flash | gemma4:12b (local) |
| ------------------- | ------------------ | --------------- | ---------------- | ------------------ |
| chambers-2011       | 3/3                | 3/3             | 3/3              | 3/3                |
| gonzalez-2021       | 3/3                | 3/3             | 3/3              | 3/3                |
| guo-2025            | 3/3                | 3/3             | 3/3              | 3/3                |
| hildebrand-iii-2018 | 3/3                | 3/3             | 3/3              | 3/3                |
| hildebrand-jr-2015  | 3/3                | 3/3             | 0/3              | 3/3                |
| cunningham-1752     | 3/3                | timeout         | 3/3              | 0/3                |
| ellis-1818          | 2/3                | 2/3             | 2/3              | 0/3                |
| illegible-marble    | 1/1                | 1/1             | 1/1              | 1/1                |
| **Fields correct**  | **21/22 (95%)**    | **18/19 (95%)** | **18/22 (82%)**  | **16/22 (73%)**    |
| Text similarity     | 99.4%              | 99.3%           | 99.1%            | 96.6%              |
| Timeouts            | 0                  | 1               | 0                | 0                  |
| Avg time per photo  | 24.5 s             | 50.1 s          | 11.9 s           | 5.0 s              |

Raw model output: [`2026-10-27-hosted.json`](2026-10-27-hosted.json) and [`2026-10-27-local-12b.json`](2026-10-27-local-12b.json).

## What went wrong

- **Every hosted model read Ellis's 1818 as 1848.** A zoomed crop confirms 1818. The worn 1 looks like a 4, and no model flagged doubt with `?`.
- **Gemini Flash split LEROY into "LE ROY"** on Hildebrand Jr. All three dates were right. Under strict name matching that costs the whole person, which is most of why Flash trails Gemma here.
- **Gemma 31B timed out** on the 1752 Cunningham stone and averaged 50 s elsewhere. It is too slow for a phone user waiting on a result.
- **Local 12B invented a surname:** "BETSEY BUCKS", died 1810, for Betsey Ellis, 1818. It also read "M. ANDREW CUNNINGHAM" for "Mr Andrew Cunningham". Fast, but it guesses on worn stones.

## The dual stone that got cut

`holmquist-2024` was a companion stone: two first names over one shared surname. It was in the first run and removed afterwards (multi-person stones are an MVP non-goal, see the PRD).

- Both Gemma models read every date correctly but returned "MARSHA FOX" and "CHARLES RAY", leaving off the shared HOLMQUIST.
- Gemini Flash got all 6 fields.
- Including it, the hosted scores were Gemma 26B 75%, Gemma 31B 72% and Flash 86%. That gap is entirely this one stone.

## Takeaways

- Gemma 4 26B matches or beats Gemini Flash on single-person stones. The open model stays.
- Latency is Gemma's real cost: about 2× Flash on the hosted API.
- Exact name strings are fragile across models (`LE ROY`, trailing periods, honorifics). Normalization belongs in deterministic code, not the prompt.
- Worn digits get misread confidently. A user-correction step is the fix; it is deferred to v2.
