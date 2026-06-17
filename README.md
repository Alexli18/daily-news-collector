# daily-news-collector

A Claude Code Remote Routine that runs once per day in the cloud, collects fresh news from Israel-focused RSS sources, deduplicates them, and appends new items to a Google Sheet.

**This routine only collects raw news — it does not generate video scripts, summaries, images, or publish anything.**

---

## Google Sheet

[Open the sheet](https://docs.google.com/spreadsheets/d/1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs/edit)

| Tab | Purpose |
|-----|---------|
| `Raw News` | Every new item collected (one row per article) |
| `Seen Items` | Deduplication log — keys of all items ever collected |
| `Logs` | Per-run summary and per-source error log |
| `Sources` | Optional: override `sources.json` from the sheet |

Sheet tabs are created automatically on the first run.

---

## Google authentication setup

The routine authenticates using a **Google Service Account**.

### 1. Create a service account

1. Open [Google Cloud Console → IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
2. Select or create a project
3. Click **Create Service Account**
4. Name it `daily-news-collector`
5. Skip optional role grants for now → click **Done**
6. Click the service account → **Keys** tab → **Add Key → Create new key → JSON**
7. Download the JSON file

### 2. Share the spreadsheet with the service account

1. Open the JSON key file and copy the `client_email` value (looks like `daily-news-collector@your-project.iam.gserviceaccount.com`)
2. Open the [Google Sheet](https://docs.google.com/spreadsheets/d/1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs/edit)
3. Click **Share** → paste the `client_email` → set role to **Editor** → **Send**

### 3. Set the environment variable in Claude Code Remote

In your Claude Code Remote environment settings, add:

```
GOOGLE_SERVICE_ACCOUNT_JSON=<paste the entire contents of the downloaded JSON key file>
```

The value is the raw JSON string (single line or multi-line — both work).

> **Tip:** You can minify it first with `cat key.json | jq -c .` to make it a single line.

---

## Sources

Sources are defined in `sources.json`. Each entry:

```json
{
  "name": "Israel National News (Arutz Sheva)",
  "url": "https://www.israelnationalnews.com/rss.xml",
  "language": "en",
  "sourceType": "israel_focused",
  "enabled": true
}
```

### Supported `sourceType` values

| Value | Description |
|-------|-------------|
| `official` | Israeli government / military official channels |
| `israel_focused` | Israel-focused news publications |
| `media_bias_analysis` | Organizations that track media framing |
| `security_analysis` | Security & regional intelligence analysis |
| `mainstream_framing` | Major international outlets |
| `hostile_framing` | Sources with documented anti-Israel framing (for monitoring) |
| `other` | Everything else |

### Adding or disabling sources

Edit `sources.json`:
- Set `"enabled": false` to temporarily pause a source
- Add a new object to add a new source
- Commit and push the change — it takes effect on the next run

### Overriding sources from the sheet

If the Google Sheet has a tab named `Sources` with a header row (`name`, `url`, `language`, `sourceType`, `enabled`) and at least one data row, the routine uses those rows instead of `sources.json`.

---

## How deduplication works

For each RSS item:

1. Normalize the URL (lowercase, strip trailing slash, strip query string except `?p=`, `?id=`, `?article=`, `?postId=` params)
2. `dedupeKey = "url:" + normalizedUrl` (or `"title:" + sourceName + ":" + title` if no URL)
3. Check against `Seen Items!A:A`
4. If already present → skip
5. If new → append to `Raw News` and record in `Seen Items`

Items are never deleted from either sheet. Deduplication is cumulative across all runs.

---

## Sheet column reference

### Raw News

| Column | Description |
|--------|-------------|
| `collectedAt` | UTC timestamp when the routine ran |
| `publishedAt` | Publish date from the RSS feed |
| `sourceName` | Source name from `sources.json` |
| `sourceType` | Source type category |
| `language` | Language code (`en`, `he`, etc.) |
| `title` | Article title |
| `url` | Article URL |
| `excerpt` | First 500 chars of description/summary |
| `contentSnippet` | First 500 chars of full content |
| `guid` | Feed GUID if available |
| `dedupeKey` | Normalized key used for deduplication |
| `status` | Always `new` when collected (other routines may update this) |

### Seen Items

| Column | Description |
|--------|-------------|
| `dedupeKey` | The dedupe key |
| `url` | Article URL |
| `title` | Article title |
| `sourceName` | Source name |
| `firstSeenAt` | UTC timestamp when first collected |

### Logs

| Column | Description |
|--------|-------------|
| `timestamp` | UTC timestamp |
| `level` | `INFO` or `ERROR` |
| `message` | Log message |
| `sourceName` | Populated for per-source errors |
| `details` | Additional context (source counts, error text) |

---

## Running the routine

### In Claude Code Remote (recommended)

1. Open [claude.ai/code](https://claude.ai/code)
2. Select this repository as the workspace
3. Create a new routine with a daily schedule (e.g. `0 6 * * *` for 06:00 UTC)
4. Set the `GOOGLE_SERVICE_ACCOUNT_JSON` environment variable
5. Click **Run now** to test before scheduling

### Manual test run

If you have Node.js and the env var set locally:

```bash
npm install
node helpers/sheets.js init          # create sheet tabs
node helpers/sheets.js read-seen     # verify auth works
```

---

## File structure

```
daily-news-collector/
├── CLAUDE.md              ← routine instructions (Claude reads this on every run)
├── sources.json           ← list of RSS sources
├── package.json           ← Node.js dependencies
├── README.md              ← this file
└── helpers/
    ├── sheets.js          ← Google Sheets API helper (read/append/init)
    └── fetch-rss.js       ← RSS feed fetcher + parser
```

---

## Next routine: story-clusterer

This routine feeds the `story-clusterer` routine, which reads `Raw News` rows with `status = "new"` and groups them into story clusters for video production.

---

## RSS feed URL notes

Some source RSS URLs may change over time. If a source shows repeated errors in the `Logs` sheet:
1. Visit the source's website and look for an RSS/feed link
2. Update the URL in `sources.json`
3. Commit and push

Known URLs that may need adjustment:
- **IDF**: The IDF website structure changes frequently — check `idf.il/en/rss/`
- **PM Office**: Uses a dynamic gov.il API endpoint — may need updating
