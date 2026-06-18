# daily-news-collector

You are running the **daily-news-collector** routine.  
Collect fresh Israel-focused news items from RSS feeds and append only new ones to Google Sheets.  
This runs once per day in the cloud. No human is watching. Send a PushNotification when done.

---

## Configuration

| Key | Value |
|-----|-------|
| Google Sheet ID | `1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs` |
| Auth env var | `GOOGLE_SERVICE_ACCOUNT_JSON` |
| Sources file | `sources.json` in this repo |

---

## STEP 0 — Verify auth and install dependencies

Run:
```bash
node -e "if(!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_SERVICE_ACCOUNT_BASE64){console.error('ERROR: No Google auth env var set. See README.md.');process.exit(1);}"
```

If that exits 1, stop here and send a PushNotification: "daily-news-collector FAILED: GOOGLE_SERVICE_ACCOUNT_JSON (or _BASE64) not set — see README.md."

Then:
```bash
npm install --prefer-offline 2>&1 | tail -3
```

---

## STEP 1 — Initialize sheet tabs (safe to re-run)

```bash
node helpers/sheets.js init
```

This creates the `Raw News`, `Seen Items`, and `Logs` sheet tabs with header rows if they do not already exist. If they already exist it does nothing.

---

## STEP 2 — Load seen deduplication keys

```bash
node helpers/sheets.js read-seen > /tmp/seen-keys.json
```

Read `/tmp/seen-keys.json`. It contains a JSON array of strings (dedupeKeys already recorded).  
Store this as your in-memory deduplication set for the rest of this run.

---

## STEP 3 — Load sources

Read `sources.json`. Keep only entries where `"enabled": true`.

---

## STEP 4 — Fetch each RSS feed

For each enabled source, run:
```bash
node helpers/fetch-rss.js "SOURCE_URL" > /tmp/feed-current.json 2>/tmp/feed-error.txt
```

**On success (exit 0):** Read `/tmp/feed-current.json` — it is a JSON array of items.  
**On failure (non-zero exit):** Read `/tmp/feed-error.txt`, record the source as failed, and continue to the next source. Do not stop.

Each item object from the feed has:
- `title` — plain text, HTML stripped
- `url` — item link
- `publishedAt` — ISO 8601 string (may be empty if feed omits it)
- `excerpt` — first 500 chars of description/summary, HTML stripped
- `contentSnippet` — first 500 chars of full content, HTML stripped
- `guid` — feed guid/id (may be empty)

For each item, compute a `dedupeKey`:
1. Normalize the URL: lowercase + strip trailing slash + strip query string,  
   **except** preserve `?p=`, `?id=`, `?article=`, or `?postId=` style params.
2. If `url` is non-empty:  
   `dedupeKey = "url:" + normalizedUrl`
3. If `url` is empty:  
   `dedupeKey = "title:" + sourceName.toLowerCase() + ":" + title.toLowerCase().trim()`

Check whether `dedupeKey` is in your seen-keys set:
- **Already seen** → skip (count as duplicate)
- **Not seen** → keep as a new item

---

## STEP 5 — Build output files

Collect all new items (from all sources combined).

Write `/tmp/new-news.json` — a JSON array, one object per new item:

```json
[
  {
    "collectedAt":     "<current UTC ISO 8601>",
    "publishedAt":     "<from feed>",
    "sourceName":      "<sources.json name>",
    "sourceType":      "<sources.json sourceType>",
    "language":        "<sources.json language>",
    "title":           "<from feed>",
    "url":             "<from feed>",
    "excerpt":         "<from feed>",
    "contentSnippet":  "<from feed>",
    "guid":            "<from feed>",
    "dedupeKey":       "<computed>",
    "status":          "new"
  }
]
```

Write `/tmp/new-seen.json` — a JSON array of the same new items for the Seen Items sheet:

```json
[
  {
    "dedupeKey":   "<computed>",
    "url":         "<from feed>",
    "title":       "<from feed>",
    "sourceName":  "<sources.json name>",
    "firstSeenAt": "<current UTC ISO 8601>"
  }
]
```

If there are zero new items, write empty arrays `[]` to both files anyway (the helper handles empty arrays gracefully).

---

## STEP 6 — Write to Google Sheets

```bash
node helpers/sheets.js append-news /tmp/new-news.json
node helpers/sheets.js append-seen /tmp/new-seen.json
```

---

## STEP 7 — Generate scripts for approved Story Clusters

```bash
node helpers/read-clusters.js > /tmp/story-clusters.json
```

Read `/tmp/story-clusters.json`. Filter for rows where `status` is exactly `"approved"`.

If no approved clusters exist, set `scripts_generated = 0` and skip to STEP 8.

For each approved cluster, draft a script following all rules in the **Script Generation Rules** section. Collect all drafts into `/tmp/scripts.json` — a JSON array, one object per cluster:

```json
[
  {
    "scriptId":              "SCR-YYYYMMDD-NNN",
    "generatedAt":           "<current UTC ISO 8601>",
    "clusterId":             "<from cluster>",
    "clusterName":           "<from cluster>",
    "scriptStatus":          "draft",
    "riskLevel":             "<from cluster>",
    "productionReadiness":   "<from cluster>",
    "englishHook":           "<one-line thumbnail hook>",
    "englishVoiceoverScript":"<drafted script — see Script Generation Rules>",
    "scenePlan":             "<scene-by-scene MS Paint cat description>",
    "onScreenText":          "<key phrases to display on screen>",
    "russianSubtitles":      "<Russian translation of englishVoiceoverScript — required, must not be empty>",
    "hebrewSubtitles":       "<Hebrew translation of englishVoiceoverScript — required, must not be empty>",
    "youtubeTitle":          "<title for YouTube>",
    "youtubeDescription":    "<short description citing sources>",
    "hashtags":              "<space-separated hashtags>",
    "sourceNotes":           "<named sources and what each confirms>",
    "factCheckChecklist":    "<[ ] items that must be verified before production>",
    "visualPromptIdeas":     "<MS Paint / cat visual ideas>",
    "editorNotes":           "<guardrails, excluded facts, pacing notes>"
  }
]
```

**`scriptId` format:** `SCR-YYYYMMDD-NNN` where `YYYYMMDD` is today's date and `NNN` starts at `001`, incrementing for each script drafted in this run (e.g. `SCR-20260617-001`, `SCR-20260617-002`).

Then write to the sheet:

```bash
node helpers/write-scripts.js /tmp/scripts.json
```

`write-scripts.js` automatically:
- Creates the `Scripts` tab if it does not exist
- Skips any `scriptId` already present in the tab (safe to re-run)
- Updates each originating Story Clusters row to `status = script_generated`

Track the count of scripts written as `scripts_generated` for the run log.

---

## STEP 8 — Generate Visual Production Plans for approved Scripts

Read the `Scripts` tab and find rows where `scriptStatus` is exactly `"approved"`.

If no approved scripts exist, set `plans_generated = 0` and skip to STEP 9.

For each approved script, generate a visual production plan using the script's `scenePlan`, `visualPromptIdeas`, `onScreenText`, and `editorNotes` fields. Collect all plans into `/tmp/production-plans.json` — a JSON array, one object per plan:

```json
[
  {
    "planId":              "PLAN-YYYYMMDD-NNN",
    "generatedAt":         "<current UTC ISO 8601>",
    "scriptId":            "<from script>",
    "clusterName":         "<from script>",
    "totalRuntime":        "<estimated duration, e.g. 1:10>",
    "sceneCount":          "<number of scenes>",
    "globalVisualStyle":   "<art style, tone, resolution, frame rate summary>",
    "colorPalette":        "<hex codes and their usage>",
    "characterReference":  "<MS Paint cat character descriptions and pose range>",
    "scenePlanMarkdown":   "<full scene-by-scene breakdown: timecode, visuals, cat poses, on-screen text, camera motion, transitions, sound cues>",
    "onScreenTextMaster":  "<table of all on-screen text cues with timecodes, style, placement>",
    "transitionSummary":   "<table of scene-to-scene transitions with type and duration>",
    "editorGuardrails":    "<guardrail bullets drawn from editorNotes: what not to add, fact-check items, pacing rules>",
    "subtitleNotes":       "<subtitle requirements per language: English burn-in, Russian, Hebrew RTL>"
  }
]
```

**`planId` format:** `PLAN-YYYYMMDD-NNN` where `YYYYMMDD` is today's date and `NNN` starts at `001`, incrementing for each plan drafted in this run.

**Scene breakdown rules:**
- Include one entry per scene with: timecode range, scene title, visual description, cat poses and expressions, on-screen text content and styling, camera motion, transition out, and any sound cues.
- Use the script's `scenePlan` field as the primary source. Enrich with `visualPromptIdeas` for character detail.
- `globalVisualStyle` must always specify: art style (MS Paint / crayon, wobbly lines), resolution (1080×1920 vertical), frame rate (24 fps), and subtitle rendering requirements.
- `colorPalette` must always include hex codes for: background white, alert red, scroll beige, cat orange, cat grey, confetti yellow, outline black, text white.
- `editorGuardrails` must reproduce every restriction from the script's `editorNotes` verbatim, then add fact-check checklist items from `factCheckChecklist`.

Then write to the sheet:

```bash
node helpers/write-production-plans.js /tmp/production-plans.json
```

`write-production-plans.js` automatically:
- Creates the `Production Plans` tab if it does not exist
- Skips any `planId` already present in the tab (safe to re-run)
- Updates each originating Scripts row to `scriptStatus = plan_generated`

Track the count of plans written as `plans_generated` for the run log.

---

## STEP 9 — Write run log

Build `/tmp/run-log.json` — a JSON array of log entries. Always include the summary entry first:

```json
[
  {
    "timestamp":  "<current UTC ISO 8601>",
    "level":      "INFO",
    "message":    "Run complete",
    "sourceName": "",
    "details":    "sources_checked:<N> failed:<N> new_items:<N> duplicates_skipped:<N> scripts_generated:<N> plans_generated:<N>"
  }
]
```

For each source that failed, append an ERROR entry:

```json
{
  "timestamp":  "<current UTC ISO 8601>",
  "level":      "ERROR",
  "message":    "Source fetch failed",
  "sourceName": "<source name>",
  "details":    "<error message from /tmp/feed-error.txt>"
}
```

Then:
```bash
node helpers/sheets.js log /tmp/run-log.json
```

---

## STEP 10 — Send PushNotification

Always send a PushNotification at the end of the run (success or partial failure).

**All sources succeeded, scripts and plans generated:**
> `daily-news-collector: ✓ <N> new items from <N> sources. <N> scripts drafted. <N> plans saved. <N> duplicates skipped.`

**All sources succeeded, scripts only (no approved scripts for plans):**
> `daily-news-collector: ✓ <N> new items from <N> sources. <N> scripts drafted. <N> duplicates skipped.`

**All sources succeeded, no approved clusters or scripts:**
> `daily-news-collector: ✓ <N> new items from <N> sources. <N> duplicates skipped.`

**Some sources failed:**
> `daily-news-collector: <N> new items added. <N> scripts drafted. <N> plans saved. FAILED sources (<N>): <name1>, <name2>. <N> duplicates skipped.`

**All sources failed:**
> `daily-news-collector: ALL <N> SOURCES FAILED. 0 new items. Check the Logs sheet.`

---

## Script Generation Rules

When generating `englishVoiceoverScript` for any cluster, apply these rules before writing the field.

### Content rules

- **One core claim only.** The voiceover must communicate a single main idea. Everything else goes to `sourceNotes` or `factCheckChecklist`.
- **Max 3 factual details in the voiceover.** Any additional facts belong in `sourceNotes`.
- **Only include claims directly supported by `sourceNotes`.** If a claim is suspected but not verified by a named source in `sourceNotes`, move it to `factCheckChecklist` with a note, and do not include it in the voiceover.
- **Do not include a location** (city, street, base) unless a source in `sourceNotes` explicitly names it in this exact story. Geographic specifics that look plausible but aren't confirmed are a common error.
- **Do not make broad media-framing claims** ("Western media covered it as X") without naming specific outlets and headlines. Prefer: *"Some headlines focused on the ceasefire language."*
- No "Today, according to reports…" — no news-anchor voice.
- No corporate language. No passive constructions that soften facts.
- Do not include claims about casualties, hostages, children, hospitals, or mass harm unless confirmed and sourced.

### Length and structure

- **110–130 words.** 45–60 seconds read aloud.
- Structure: viral hook → cat metaphor → news reveal (max 3 facts) → the framing gap → one open question → closing punchline that loops back to the hook.
- Short sentences. One idea per sentence.
- The hook must be a pattern interrupt, contradiction, or vivid cat image — not a factual statement.
- The final line must loop back to the opening metaphor.
- Do not repeat any phrase or sentence anywhere in the script.

### Subtitles — required for every script

Translate `englishVoiceoverScript` into both languages and write them to the corresponding fields:

- `russianSubtitles` — full Russian translation, paragraph breaks preserved, idiomatic (not literal word-for-word).
- `hebrewSubtitles` — full Hebrew translation, paragraph breaks preserved, idiomatic. Write right-to-left text as normal UTF-8 — the sheet handles direction.

**Do not leave either field empty.** A script with blank subtitles is incomplete and must not be written to the sheet.

### Quality gate — check before saving

Answer each before writing the script to the sheet:

1. Is the first line actually interesting? Would someone stop scrolling?
2. Does the script stay on one core claim from start to finish?
3. Does every factual detail in the voiceover appear in `sourceNotes`?
4. Does it end with a memorable line that loops back to the opening?
5. Is it better than a generic news summary?
6. Are both `russianSubtitles` and `hebrewSubtitles` filled in?

If any answer is no, fix before saving.

---

## Rules — do not violate

- Do NOT delete rows from any sheet.
- Do NOT score, rank, cluster, or prioritize stories.
- Do NOT call ElevenLabs, generate images, or publish anything.
- Never crash silently — always log errors to the `Logs` sheet and send a PushNotification.
- If `GOOGLE_SERVICE_ACCOUNT_JSON` is missing, send a PushNotification and stop immediately.

---

# STORY CLUSTERER ROUTINE

Run on demand (not on the daily schedule) to group raw news items into tight,
video-sized story candidates for human review.

```bash
node helpers/story-clusterer.js [--days N] [--dry-run] [--no-clear]
```

| Flag | Default | Meaning |
|------|---------|---------|
| `--days N` | 7 | Look back N days in Raw News |
| `--dry-run` | off | Print clusters without writing to sheets |
| `--no-clear` | off | Append to existing Story Clusters instead of replacing |

Writes results to the **`Story Clusters`** tab and marks matched Raw News rows
with `status: "clustered"`.

---

## Story Clusters tab schema

| Column | Description |
|--------|-------------|
| `clusterId` | Stable ID (SC-001 … SC-NNN) |
| `createdAt` | ISO 8601 timestamp of the clustering run |
| `clusterName` | Specific story title — one event, one angle |
| `clusterType` | `single_event` · `media_framing_conflict` · `policy_debate` · `security_context` · `domestic_politics` · `diplomacy` · `too_broad_needs_split` |
| `eventSummary` | 2–4 sentence factual description of exactly what happened |
| `framingConflict` | How different sources/audiences frame this differently |
| `missingContext` | What context is absent from most coverage |
| `suggestedVideoAngle` | Specific hook for a 45–60 second explainer |
| `possibleCatMetaphor` | Cat-based analogy for the explainer format |
| `mainSources` | Comma-separated source names that contributed items |
| `sourceCount` | Number of distinct sources |
| `relatedRawNewsKeys` | Comma-separated `dedupeKey` values of matched Raw News rows |
| `videoPotential` | 1–5 (5 = ready to script; 1–2 = too broad or no clear angle) |
| `riskLevel` | `low` · `medium` · `high` |
| `productionReadiness` | `ready_for_review` · `needs_more_sources` · `needs_fact_check` · `too_broad` · `reject` |
| `status` | Always `pending_review` on creation |
| `notes` | Verification reminders, sourcing notes, companion cluster links |

---

## Cluster quality rules

1. **One cluster = one video.** A cluster must represent a single event,
   dispute, or framing conflict — not a general topic.

2. **Size:** target 2–12 items. Warn if > 15. Skip single-item clusters
   unless `videoPotential ≥ 4`.

3. **Tight matching.** An item belongs only if it covers *the same specific
   event or angle* as the other items. Shared keywords (Iran, Israel, Hamas)
   are not sufficient.

4. **Split broad themes.** "Iran deal" → subclusters by angle:
   nuclear terms · oil sanctions · Lebanon · Trump/G7 · media framing ·
   Israeli reaction · ceasefire violations.

5. **videoPotential = 5** requires: clear hook, 45–60 sec explainable,
   media-framing conflict or missing-context angle, visualizable.

6. **riskLevel = high** if: extraordinary claim, single source,
   breaking story, casualty numbers, or possible misattribution.

7. **Do not generate scripts.** Output is candidates for human review only.

---

## Updating story frames

Story frames live in `helpers/story-clusterer.js` in the `STORY_FRAMES` array.
Each frame is a JavaScript object with `id`, `clusterName`, `clusterType`,
narrative fields, `videoPotential`, `riskLevel`, `productionReadiness`,
`notes`, and a `matchFn(item)` predicate.

Update the frames when the news cycle shifts. Frames from a previous cycle
that no longer match any items are silently skipped.

Example of a good frame definition:
- `clusterName`: `"IAF Iran strike halted one hour before takeoff"`
- `matchFn`: tight multi-word regex — not just `/iran/i`
- `eventSummary`: factual, sourced, 2–4 sentences
- `framingConflict`: how Israeli / US / Iranian press each framed it
- `missingContext`: what questions remain unanswered
- `suggestedVideoAngle`: one specific hook sentence
- `possibleCatMetaphor`: one sentence cat analogy
