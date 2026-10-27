# 🔬 OCR smoke test: Gemma 4 vs Gemini Flash

Quick passes at the PRD question "can Gemma read a headstone?", all run on 2026-10-27 before any app code existed. Runner and scorer: `benchmarks/run.ts` and `benchmarks/score.ts`. Run 2's E2B rows came from a one-off LiteRT-LM script that wasn't kept. They measure transcription and field extraction only. Grounding, unsupported claims and cost per run come later with the real benchmark.

## Setup

- **Fixtures:** the 8 human-reviewed stones in `fixtures/manifest.json` (5 recent, 2 historic, 1 illegible).
- **Models:**
  - Hosted on the Gemini API (free tier): `gemma-4-26b-a4b-it`, `gemma-4-31b-it`, `gemini-3.8-flash`.
  - Local on an M4 Max (36 GB): `gemma4:12b` via Ollama, and `gemma-4-E2B-it` via LiteRT-LM (run 2 only).
- **Calls:** one call per image per model, 240 s timeout, no retries.

| Run | Prompt                                                       | Output format                                          | Sampling                                                   |
| --- | ------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------- |
| 1   | One user message: instructions plus a format description     | JSON described in prose, parsed from the reply         | temperature 0                                              |
| 2   | System prompt with role and rules; user turn is image + task | JSON schema enforced by the API (`responseJsonSchema`) | temperature 1.0, top_p 0.95, top_k 64 (Gemma 4 model card) |
| 3   | Same as run 2                                                | Same as run 2                                          | temperature 0, top_p 0.95, top_k 64; 12B only              |

Run 2's full prompt and schema: [`benchmarks/prompts/run2.json`](../../benchmarks/prompts/run2.json). Run 1's prompt ([`benchmarks/prompts/run1.json`](../../benchmarks/prompts/run1.json)):

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
- **Errors:** a timeout, or a reply that isn't valid JSON. Errors score nothing and are left out of the field totals.

## Run 1: prose format, temperature 0

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
| Errors              | 0                  | 1               | 0                | 0                  |
| Avg time per photo  | 24.5 s             | 50.1 s          | 11.9 s           | 5.0 s              |

Raw output: [`run1-hosted.json`](../../benchmarks/results/run1-hosted.json), [`run1-local-12b.json`](../../benchmarks/results/run1-local-12b.json).

## Run 2: system prompt, JSON schema, recommended sampling

| Fixture             | gemma-4-26b-a4b-it | gemma-4-31b-it   | gemini-3.8-flash | gemma4:12b (local) | gemma-4-E2B-it (local) |
| ------------------- | ------------------ | ---------------- | ---------------- | ------------------ | ---------------------- |
| chambers-2011       | 3/3                | 3/3              | 3/3              | 3/3                | 0/3                    |
| gonzalez-2021       | 3/3                | 3/3              | 3/3              | 3/3                | 1/3                    |
| guo-2025            | 3/3                | 3/3              | 3/3              | 3/3                | 2/3                    |
| hildebrand-iii-2018 | 3/3                | 3/3              | 0/3              | 3/3                | bad JSON               |
| hildebrand-jr-2015  | 0/3                | 3/3              | 0/3              | 0/3                | bad JSON               |
| cunningham-1752     | 0/3                | bad JSON         | 3/3              | 0/3                | 0/3                    |
| ellis-1818          | 2/3                | bad JSON         | 3/3              | 0/3                | bad JSON               |
| illegible-marble    | 1/1                | 1/1              | 1/1              | 0/1                | 1/1                    |
| **Fields correct**  | **15/22 (68%)**    | **16/16 (100%)** | **16/22 (73%)**  | **12/22 (55%)**    | **4/13 (31%)**         |
| Text similarity     | 99.2%              | 100.0%           | 99.4%            | 97.6%              | 20.0%                  |
| Errors              | 0                  | 2                | 0                | 0                  | 3                      |
| Avg time per photo  | 3.7 s              | 4.7 s            | 15.3 s           | 4.6 s              | 1.4 s                  |

Raw output: [`run2-hosted.json`](../../benchmarks/results/run2-hosted.json), [`run2-local-12b.json`](../../benchmarks/results/run2-local-12b.json), [`run2-local-e2b.json`](../../benchmarks/results/run2-local-e2b.json).

LiteRT-LM has no JSON-schema decoding, so E2B got the schema as text appended to its system prompt.

## Run 3: tuning on local 12B, temperature 0

Model choice is settled; from here the runs tune the prompt. Run 3 keeps run 2's prompt and schema ([`benchmarks/prompts/run3.json`](../../benchmarks/prompts/run3.json)) and only drops the temperature to 0.

| Fixture             | gemma4:12b (local) |
| ------------------- | ------------------ |
| chambers-2011       | 3/3                |
| gonzalez-2021       | 3/3                |
| guo-2025            | 3/3                |
| hildebrand-iii-2018 | 3/3                |
| hildebrand-jr-2015  | 0/3                |
| cunningham-1752     | 0/3                |
| ellis-1818          | 0/3                |
| illegible-marble    | 0/1                |
| **Fields correct**  | **12/22 (55%)**    |
| Text similarity     | 97.7%              |
| Errors              | 0                  |
| Avg time per photo  | 1.5 s              |

Raw output: [`run3-local-12b.json`](../../benchmarks/results/run3-local-12b.json).

- Same score as run 2. The same three stones fail the same way: "LE ROY", "M. ANDREW", and an invented Ellis ("BETSEY B. [?]", died 1810).
- The illegible stone still comes back as a person named "[?]" instead of an empty list.

## Runs 4–7: tuning hosted Gemma 4 26B

From run 4 on, every run is hosted `gemma-4-26b-a4b-it` at temperature 0 with a system prompt and schema. Each run changes one thing from the run before it. The scorer now also counts **extra people**: entries for anyone the stone isn't for.

| Run | Change                                                                           | Fields correct | Extra people | Avg time | Prompt                                            | Raw output                                                              |
| --- | -------------------------------------------------------------------------------- | -------------- | ------------ | -------- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| 4   | Baseline: run 3's prompt on 26B                                                  | 21/22 (95%)    | 2            | 3.3 s    | [`run4.json`](../../benchmarks/prompts/run4.json) | [`run4-hosted-26b.json`](../../benchmarks/results/run4-hosted-26b.json) |
| 5   | Only the person the stone is for goes in `people`; relatives and nicknames don't | 21/22 (95%)    | **0**        | 5.4 s    | [`run5.json`](../../benchmarks/prompts/run5.json) | [`run5-hosted-26b.json`](../../benchmarks/results/run5-hosted-26b.json) |
| 6   | Write `?` for a worn digit that could be read two ways                           | 21/22 (95%)    | 0            | 6.5 s    | [`run6.json`](../../benchmarks/prompts/run6.json) | [`run6-hosted-26b.json`](../../benchmarks/results/run6-hosted-26b.json) |
| 7   | `mediaResolution: MEDIA_RESOLUTION_LOW`                                          | 13/19 (68%)    | 2            | 11.5 s   | [`run7.json`](../../benchmarks/prompts/run7.json) | [`run7-hosted-26b.json`](../../benchmarks/results/run7-hosted-26b.json) |

- **Run 4:** the only field miss is Ellis's 1818 read as 1848. The extras were the nickname "Eddie Boy" listed as its own person, and Ellis's parents ("Thos. & Betsey Ellis").
- **Run 5 fixed both extras** with no field loss. This is the most relevant change for modern stones, which routinely name relatives ("beloved son of").
- **Run 6 changed nothing.** 26B still reads 1848 with no `?`. Separate probes with thinking on (`thinkingLevel: HIGH`) and with `MEDIA_RESOLUTION_HIGH` also answered 1848.
- **Run 7 is a dead end.** A one-off probe at low resolution read 1818, but across all 8 stones it broke more than it fixed: Betsey Ellis came back named "\*years.\*", Hildebrand III returned broken JSON, and Cunningham picked up an extra person.
- **Best prompt so far: run 6.** Every recent (2010+) stone scores 3/3 with no extra people. The one miss is a worn digit on an 1818 stone.

### Run 8: speed

Run 6's slowdown was the free-tier queue, not the prompt. The same request re-sent right after run 6 took 2.8–4.8 s, the model spent no tokens thinking, and image size didn't change the model's input token count. The only lever the prompt controls is output length, so run 8 drops the full-inscription `text` field ([`run8.json`](../../benchmarks/prompts/run8.json), [`run8-hosted-26b.json`](../../benchmarks/results/run8-hosted-26b.json)). The scorer now reports median time, which a single queue spike can't drag.

| Run | Fields correct | Extra people | Median time | Avg time |
| --- | -------------- | ------------ | ----------- | -------- |
| 6   | 21/22 (95%)    | 0            | 5.5 s       | 6.5 s    |
| 8   | 20/22 (91%)    | 1            | 3.4 s       | 3.3 s    |

- Every named person read the same as in run 6.
- Regression: the illegible stone came back as a person literally named `"[]"`. A name with no letters is easy to reject in the deterministic parsing layer, so this is a code fix, not a prompt one.

## What went wrong

- **Worn digits:** Ellis's 1818 was read as 1848 by every hosted model in run 1, and by Gemma 26B again in run 2. A zoomed crop confirms 1818. No model marked the digit with `?`.
- **Name formatting, not reading:** most name misses came with every date right.
  - "LE ROY" for LEROY (Flash both runs, 12B in run 2).
  - "LERØY" with a slashed O (Gemma 26B, run 2).
  - "M. ANDREW" for "Mr Andrew" (12B both runs, 26B in run 2).
  - Flash added the nickname "Eddie Boy" into Hildebrand III's name in run 2.
- **Gemma 31B's two run 2 errors were correct answers.** It followed valid JSON with a stray closing code fence. Both answers were right, including Ellis's 1818. Schema mode on the Gemini API doesn't stop it.
- **Gemma 26B listed a second person on Ellis** in run 2: "Thos. & Betsey Ellis", the parents named on the stone.
- **Local 12B invents surnames on worn stones:** "BETSEY BUCKS" (run 1) and "BETSEY BATES" (run 2) for Betsey Ellis. In run 2 it also returned a person named "[?]" for the illegible stone.
- **Local E2B is unusable:** without enforced JSON it echoed the schema's shape back. It read Ellis as "STIXIN George Davison", died 1878.

## The dual stone that got cut

`holmquist-2024` was a companion stone: two first names over one shared surname. It was in run 1 and removed afterwards (multi-person stones are an MVP non-goal, see the PRD).

- Both Gemma models read every date correctly but returned "MARSHA FOX" and "CHARLES RAY", leaving off the shared HOLMQUIST.
- Gemini Flash got all 6 fields.
- Including it, run 1's hosted scores were Gemma 26B 75%, Gemma 31B 72% and Flash 86%. That gap is entirely this one stone.

## Takeaways

- Gemma 4 matches Gemini Flash on single-person stones. The open model stays.
- Run 2 made hosted Gemma about 7–11× faster (26B: 24.5 s → 3.7 s). It is now faster than Flash.
- One call per image at temperature 1.0 is noisy: individual stones flipped between runs in both directions. Scores this close need repeated calls per image before they mean anything.
- Exact name strings are fragile across models. Normalization belongs in deterministic code, not the prompt.
- Even with an enforced schema, parse model output defensively: strip stray code fences before `JSON.parse`.
- Worn digits get misread confidently. A user-correction step is the fix; it is deferred to v2.
- Small local models (12B, E2B) guess on worn stones. Hosted Gemma it is.
