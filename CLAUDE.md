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

## STEP 8 — Write run log

Build `/tmp/run-log.json` — a JSON array of log entries. Always include the summary entry first:

```json
[
  {
    "timestamp":  "<current UTC ISO 8601>",
    "level":      "INFO",
    "message":    "Run complete",
    "sourceName": "",
    "details":    "sources_checked:<N> failed:<N> new_items:<N> duplicates_skipped:<N> scripts_generated:<N>"
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

## STEP 9 — Send PushNotification

Always send a PushNotification at the end of the run (success or partial failure).

**All sources succeeded, scripts generated:**
> `daily-news-collector: ✓ <N> new items from <N> sources. <N> scripts drafted. <N> duplicates skipped.`

**All sources succeeded, no approved clusters:**
> `daily-news-collector: ✓ <N> new items from <N> sources. <N> duplicates skipped.`

**Some sources failed:**
> `daily-news-collector: <N> new items added. <N> scripts drafted. FAILED sources (<N>): <name1>, <name2>. <N> duplicates skipped.`

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
