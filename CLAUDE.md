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

## STEP 7 — Write run log

Build `/tmp/run-log.json` — a JSON array of log entries. Always include the summary entry first:

```json
[
  {
    "timestamp":  "<current UTC ISO 8601>",
    "level":      "INFO",
    "message":    "Run complete",
    "sourceName": "",
    "details":    "sources_checked:<N> failed:<N> new_items:<N> duplicates_skipped:<N>"
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

## STEP 8 — Send PushNotification

Always send a PushNotification at the end of the run (success or partial failure).

**All sources succeeded:**
> `daily-news-collector: ✓ <N> new items from <N> sources. <N> duplicates skipped.`

**Some sources failed:**
> `daily-news-collector: <N> new items added. FAILED sources (<N>): <name1>, <name2>. <N> duplicates skipped.`

**All sources failed:**
> `daily-news-collector: ALL <N> SOURCES FAILED. 0 new items. Check the Logs sheet.`

---

## Rules — do not violate

- Do NOT delete rows from any sheet.
- Do NOT generate video scripts, summaries, or editorial judgments.
- Do NOT score, rank, cluster, or prioritize stories.
- Do NOT call ElevenLabs, generate images, or publish anything.
- Never crash silently — always log errors to the `Logs` sheet and send a PushNotification.
- If `GOOGLE_SERVICE_ACCOUNT_JSON` is missing, send a PushNotification and stop immediately.
