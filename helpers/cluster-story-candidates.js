#!/usr/bin/env node
'use strict';
/**
 * helpers/cluster-story-candidates.js
 *
 * On-demand grouping of un-clustered "Raw News" rows into lightweight Story
 * Cluster candidates for human review. Unlike helpers/story-clusterer.js
 * (which authors a full editorial narrative per cluster), this pass is
 * mechanical: it topic-matches items, writes clusterName/theme/sources/
 * urls/rawItems/createdAt/status into the existing 'Story Clusters' tab, and
 * leaves the narrative-only columns (eventSummary, framingConflict, etc.)
 * blank for these rows. It does not delete or overwrite any existing row.
 *
 * Usage:
 *   node helpers/cluster-story-candidates.js [--dry-run]
 */

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs';

// Extra columns this script owns (appended after the existing Story Clusters
// header if not already present). Existing columns clusterName / mainSources /
// createdAt / status are reused as-is.
const EXTRA_HEADERS = ['theme', 'itemCount', 'urls', 'rawItems'];

function loadAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const json = raw || Buffer.from(b64, 'base64').toString('utf8');
  return new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}

function text(item) {
  return ((item.title || '') + ' ' + (item.excerpt || '')).toLowerCase();
}

// Same boilerplate/navigation filter used by earlier clustering passes on this feed.
const BOILERPLATE_TITLES = new Set([
  'Home 2', 'Home 3', 'Home 5', 'Personal Details', 'PersonalDetails', 'CONTACT US', 'ABOUT US',
  'Languages', 'Countries', 'Projects', 'News', 'Publications', 'Projects Abroad', 'Courses',
  'Courses abroad', 'Overseas Activities', 'Photo Galleries', 'Video Galleries', 'Digital library',
  'Plenaries', 'Home | Ministry of Foreign Affairs', 'Home | English', 'Home | 4IL Community',
  'Buzzy Gordon Archives', 'MEMRI Newsletter', 'JTTM', 'Cyber & Jihad Lab',
  'Contact Us / Request a Clip', 'www.israelhayom.com', '- www.israelhayom.com',
  'Israel News | Israel Hayom - www.israelhayom.com', 'Israel News | Israel National News',
  'News Briefs', 'Opeds', 'Untitled', 'Key Documents', 'LATIN AMERICA & THE CARIBBEAN',
  'Home | The Aharon Ofri MASHAV International Educational Training Center',
  "Prime Minister's Office announcement", "Prime Minister's Office Statement",
  'Bilateral relations', 'MEMRI TV', 'Donate to Main Donation Form',
  'Soldier Killed, News And Latest Headlines', 'FIFA World Cup 2026',
]);
const BOILERPLATE_RE = [
  /^Home \d+$/, /^Personal ?Details$/i, /^www\./, /^- www\./,
  /^MEMRI TV YouTube/, /^\s*$/, /Archives$/, /^December Briefings/,
];
function isBoilerplate(item) {
  const t = (item.title || '').trim();
  if (BOILERPLATE_TITLES.has(t)) return true;
  return BOILERPLATE_RE.some((re) => re.test(t));
}

// Topic-matching definitions tuned to the current Iran-deal / Lebanon / Gaza
// news cycle present in this feed. First match wins. Update as the cycle shifts.
const CLUSTER_DEFS = [
  {
    name: 'Iran nuclear deal / MoU signing and reactions',
    theme: 'Iran diplomacy',
    match: (t) => /iran.*(mou|memorandum|deal|negotiat|nuclear|agreement|sign)/i.test(t)
      || /us.iran.*(talk|deal|negotiat|pact)/i.test(t)
      || /trump.*iran deal|trump signs iran/i.test(t)
      || /300.*billion.*iran|iran.*\$?300 billion/i.test(t)
      || /hormuz.*reopen|reopen.*hormuz/i.test(t)
      || /qatar.*bribed|qatar buys america/i.test(t)
      || /iran.*superpower|we are a superpower/i.test(t)
      || /vance.*iran deal|vance.*peace process/i.test(t)
      || /israel.*not consulted.*mou/i.test(t)
      || /dermer.*iran/i.test(t)
      || /exiled iranian crown prince/i.test(t)
      || /pahlavi/i.test(t),
  },
  {
    name: 'Trump-Netanyahu tension over the Iran deal',
    theme: 'US-Israel diplomacy',
    match: (t) => /trump.*netanyahu|netanyahu.*trump/i.test(t)
      || /trump.*betrayal.*israel/i.test(t)
      || /netanyahu.*derail.*deal|derail.*iran deal/i.test(t)
      || /israel.*has to respect.*peace process/i.test(t)
      || /huckabee/i.test(t)
      || /witkoff/i.test(t),
  },
  {
    name: 'Hezbollah / Israel-Lebanon front activity',
    theme: 'Lebanon / Hezbollah',
    match: (t) => /hezbollah/i.test(t)
      || /hizbullah/i.test(t)
      || /lebanon/i.test(t)
      || /southern lebanon/i.test(t)
      || /idf troops.*open-fire rules/i.test(t)
      || /erdogan warns israeli strikes/i.test(t),
  },
  {
    name: 'Gaza operations, Hamas, and ceasefire status',
    theme: 'Gaza / Hamas',
    match: (t) => /hamas/i.test(t)
      || /gaza/i.test(t)
      || /nukhba/i.test(t)
      || /hostage/i.test(t)
      || /unrwa/i.test(t),
  },
  {
    name: 'IRGC and Iranian military leadership strikes',
    theme: 'Iran-Israel military conflict',
    match: (t) => /irgc/i.test(t)
      || /khamenei/i.test(t)
      || /larijani/i.test(t)
      || /qods force/i.test(t)
      || /israel won the battle with iran/i.test(t)
      || /iran.*bypassed.*air defense/i.test(t)
      || /iran.*anthem/i.test(t)
      || /iranian proxies/i.test(t),
  },
  {
    name: 'Mossad leadership and Israeli intelligence',
    theme: 'Israeli intelligence / Mossad',
    match: (t) => /mossad/i.test(t)
      || /most dangerous spy/i.test(t)
      || /qatari regime.*spying/i.test(t),
  },
  {
    name: 'IDF operations, capabilities, and briefings',
    theme: 'IDF military operations',
    match: (t) => /idf/i.test(t)
      || /reservist killed/i.test(t)
      || /soldier.*killed/i.test(t)
      || /press briefing/i.test(t)
      || /iron wasp/i.test(t)
      || /interceptor/i.test(t)
      || /firearms found/i.test(t)
      || /munitions self-sufficiency/i.test(t),
  },
  {
    name: 'Antisemitism and anti-Israel incidents abroad',
    theme: 'Antisemitism / diaspora',
    match: (t) => /antisemit/i.test(t)
      || /hate crime.*flyer/i.test(t)
      || /free palestine.*hotel/i.test(t)
      || /london memorial arson/i.test(t)
      || /emoji guide/i.test(t)
      || /pride and prejudice.*lgbtq/i.test(t)
      || /spain.*killing jews/i.test(t),
  },
  {
    name: 'Media bias and framing of the Israel/Iran story',
    theme: 'Media analysis / information war',
    match: (t) => /cnn/i.test(t)
      || /honestreporting/i.test(t)
      || /anti-israel narrative/i.test(t)
      || /media framed.*terror/i.test(t)
      || /gaza now.*hamas/i.test(t)
      || /genocide/i.test(t)
      || /forgotten exodus/i.test(t)
      || /aliyah/i.test(t),
  },
  {
    name: 'Islamic extremism, jihadist threats, and terror plots (MEMRI)',
    theme: 'Jihadist extremism',
    match: (t) => /isis/i.test(t)
      || /al-qaeda|al qaeda/i.test(t)
      || /jihad/i.test(t)
      || /taliban/i.test(t)
      || /world cup.*attack|attack.*world cup/i.test(t)
      || /lone wolf|lone actor/i.test(t)
      || /mosque.*tribute/i.test(t)
      || /imam.*children of israel/i.test(t)
      || /oct\.? 7 anniversary plot/i.test(t),
  },
  {
    name: 'Iraqi and Gulf-region Iranian proxy networks',
    theme: 'Iran regional influence / Islamism',
    match: (t) => /iraqi militia|iraq.*militia/i.test(t)
      || /qods|irgc.*iraqi cells/i.test(t)
      || /gulf neighbors/i.test(t)
      || /muslim brotherhood/i.test(t),
  },
  {
    name: 'Israel diplomatic standing, EU/ICC, and Europe relations',
    theme: 'Israel international standing',
    match: (t) => /\beu\b.*israel|israel.*\beu\b/i.test(t)
      || /\bicc\b/i.test(t)
      || /flotilla/i.test(t)
      || /british embassy/i.test(t)
      || /king charles/i.test(t),
  },
  {
    name: 'Israeli domestic politics and Knesset',
    theme: 'Israeli domestic politics',
    match: (t) => /knesset/i.test(t)
      || /state comptroller/i.test(t)
      || /sovereignty/i.test(t)
      || /green line/i.test(t)
      || /gush etzion/i.test(t)
      || /lapid/i.test(t)
      || /commission of inquiry/i.test(t),
  },
  {
    name: 'Israeli society, economy, and human interest',
    theme: 'Israeli innovation / society',
    match: (t) => /housing market/i.test(t)
      || /el al/i.test(t)
      || /galilee/i.test(t)
      || /trucking/i.test(t)
      || /academization/i.test(t)
      || /jewish woman.*president/i.test(t)
      || /snake bites back/i.test(t)
      || /disability conference/i.test(t)
      || /beit issie/i.test(t),
  },
  {
    name: 'MASHAV international development aid and cooperation',
    theme: 'Israeli development aid / MASHAV',
    match: (t) => /mashav/i.test(t)
      || /irrigation/i.test(t)
      || /poultry farming/i.test(t)
      || /early childhood education/i.test(t)
      || /educational mission/i.test(t)
      || /agricultural training/i.test(t),
  },
  {
    name: 'Holocaust remembrance and IHRA-related coverage',
    theme: 'IHRA / Holocaust remembrance',
    match: (t) => /holocaust/i.test(t)
      || /\bihra\b/i.test(t)
      || /survivors/i.test(t),
  },
  {
    name: 'Israeli government statements, PMO/MFA archival and miscellaneous items',
    theme: 'Israeli government / diplomacy',
    match: () => true, // catch-all, always last
  },
];

async function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: loadAuth() });
}

async function ensureStoryClustersTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = new Set(meta.data.sheets.map((s) => s.properties.title));
  if (!existing.has('Story Clusters')) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: 'Story Clusters' } } }] },
    });
  }
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'Story Clusters'!1:1" });
  let headers = (res.data.values || [[]])[0] || [];
  if (headers.length === 0) {
    headers = ['clusterId', 'createdAt', 'clusterName', 'clusterType', 'eventSummary', 'framingConflict',
      'missingContext', 'suggestedVideoAngle', 'possibleCatMetaphor', 'mainSources', 'sourceCount',
      'relatedRawNewsKeys', 'videoPotential', 'riskLevel', 'productionReadiness', 'status', 'notes',
      'scriptId', 'scriptGeneratedAt'];
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: "'Story Clusters'!A1",
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [headers] },
    });
  }
  const missingExtras = EXTRA_HEADERS.filter((h) => !headers.includes(h));
  if (missingExtras.length > 0) {
    const startCol = headers.length; // 0-based index of first new column
    const colLetter = (n) => {
      let s = '';
      n += 1;
      while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
      return s;
    };
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'Story Clusters'!${colLetter(startCol)}1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [missingExtras] },
    });
    headers = headers.concat(missingExtras);
  }
  return headers;
}

async function readUnclusteredRawNews(sheets) {
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: "'Raw News'!A:L" });
  const rows = res.data.values || [];
  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if ((r[idx.status] || '') !== 'new') continue;
    items.push({
      rowNum: i + 1,
      sourceName: r[idx.sourceName] || '',
      title: r[idx.title] || '',
      url: r[idx.url] || '',
      excerpt: r[idx.excerpt] || '',
      publishedAt: r[idx.publishedAt] || '',
      dedupeKey: r[idx.dedupeKey] || '',
    });
  }
  return items;
}

async function markClustered(sheets, rowNums) {
  if (!rowNums.length) return;
  const data = rowNums.map((rowNum) => ({ range: `'Raw News'!L${rowNum}`, values: [['clustered']] }));
  for (let i = 0; i < data.length; i += 500) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: data.slice(i, i + 500) },
    });
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sheets = await getSheetsClient();

  const items = await readUnclusteredRawNews(sheets);
  console.error(`Found ${items.length} un-clustered Raw News rows`);
  if (items.length === 0) {
    console.log(JSON.stringify({ clustersWritten: 0, itemsClustered: 0, message: 'No new items to cluster.' }));
    return;
  }

  const boilerplateCount = items.filter((i) => isBoilerplate(i)).length;
  console.error(`  substantive-looking: ${items.length - boilerplateCount}, boilerplate/archival: ${boilerplateCount} (all still routed to a cluster so none are left dangling as "new")`);

  const buckets = CLUSTER_DEFS.map((cd) => ({ ...cd, items: [] }));
  for (const item of items) {
    const t = text(item);
    for (const b of buckets) {
      if (b.match(t)) { b.items.push(item); break; }
    }
  }

  const now = new Date().toISOString();
  const nonEmpty = buckets.filter((b) => b.items.length > 0);
  console.error(`Built ${nonEmpty.length} clusters:`);
  nonEmpty.forEach((b) => console.error(`  [${b.items.length}] ${b.name}`));

  if (dryRun) {
    console.log(JSON.stringify({
      clustersWritten: 0,
      itemsClustered: 0,
      preview: nonEmpty.map((b) => ({ name: b.name, theme: b.theme, itemCount: b.items.length })),
    }, null, 2));
    return;
  }

  const headers = await ensureStoryClustersTab(sheets);
  const colIndex = (name) => headers.indexOf(name);

  const rows = [];
  const clusteredRowNums = [];
  for (const b of nonEmpty) {
    const row = new Array(headers.length).fill('');
    const uniqueSources = [...new Set(b.items.map((i) => i.sourceName))];
    let urls = b.items.map((i) => i.url).filter(Boolean).join('|');
    if (urls.length > 45000) urls = urls.substring(0, 45000) + '...(truncated)';
    let rawItemsJson = JSON.stringify(b.items.map((i) => ({
      sourceName: i.sourceName, title: i.title, url: i.url, publishedAt: i.publishedAt,
    })));
    if (rawItemsJson.length > 45000) rawItemsJson = rawItemsJson.substring(0, 45000) + '...(truncated)]';

    row[colIndex('clusterName')] = b.name;
    row[colIndex('mainSources')] = uniqueSources.join(', ');
    row[colIndex('createdAt')] = now;
    row[colIndex('status')] = 'pending_review';
    row[colIndex('theme')] = b.theme;
    row[colIndex('itemCount')] = String(b.items.length);
    row[colIndex('urls')] = urls;
    row[colIndex('rawItems')] = rawItemsJson;
    rows.push(row);

    b.items.forEach((i) => clusteredRowNums.push(i.rowNum));
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Story Clusters'!A1",
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
  console.error(`Appended ${rows.length} cluster rows`);

  await markClustered(sheets, clusteredRowNums);
  console.error(`Marked ${clusteredRowNums.length} Raw News rows as clustered`);

  console.log(JSON.stringify({ clustersWritten: rows.length, itemsClustered: clusteredRowNums.length }));
}

main().catch((e) => { console.error('[FATAL]', e.message); process.exit(1); });
