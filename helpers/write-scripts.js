'use strict';
/**
 * Writes pre-generated script data to the "Scripts" sheet tab and updates
 * the originating Story Clusters rows to status=script_generated.
 *
 * Usage: node helpers/write-scripts.js <path-to-scripts.json>
 *
 * Input JSON: array of objects whose keys match SCRIPT_COLUMNS.
 * Required per object: scriptId, clusterId, generatedAt.
 */

const fs = require('fs');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs';
const SCOPES        = ['https://www.googleapis.com/auth/spreadsheets'];
const SCRIPTS_TAB   = 'Scripts';
const CLUSTERS_TAB  = 'Story Clusters';

const SCRIPT_COLUMNS = [
  'scriptId',
  'generatedAt',
  'clusterId',
  'clusterName',
  'scriptStatus',
  'riskLevel',
  'productionReadiness',
  'englishHook',
  'englishVoiceoverScript',
  'scenePlan',
  'onScreenText',
  'russianSubtitles',
  'hebrewSubtitles',
  'youtubeTitle',
  'youtubeDescription',
  'hashtags',
  'sourceNotes',
  'factCheckChecklist',
  'visualPromptIdeas',
  'editorNotes',
];

// Columns added to Story Clusters when missing
const CLUSTER_BACKFILL_COLS = ['scriptId', 'scriptGeneratedAt'];

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const json = raw || Buffer.from(b64, 'base64').toString('utf8');
  return new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes: SCOPES });
}

// 0-based column index → A1 letter(s)
function colLetter(idx) {
  let result = '';
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

async function ensureScriptsTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === SCRIPTS_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: SCRIPTS_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SCRIPTS_TAB}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [SCRIPT_COLUMNS] },
    });
    console.error(`Created tab: ${SCRIPTS_TAB}`);
  }
}

async function getExistingScriptIds(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SCRIPTS_TAB}!A:A`,
  });
  const rows = res.data.values || [];
  return new Set(rows.slice(1).map(r => (r[0] || '').trim()).filter(Boolean));
}

// Returns { headers, rows } — rows are raw arrays (not objects) so indices stay stable
async function readClustersRaw(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: CLUSTERS_TAB,
  });
  const all = res.data.values || [];
  if (all.length === 0) return { headers: [], rows: [] };
  return { headers: all[0].map(h => h.trim()), rows: all.slice(1) };
}

// Appends missing columns to the Story Clusters header row; returns updated headers
async function ensureClusterCols(sheets, headers) {
  const missing = CLUSTER_BACKFILL_COLS.filter(c => !headers.includes(c));
  if (missing.length === 0) return headers;
  const updated = [...headers, ...missing];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${CLUSTERS_TAB}!1:1`,
    valueInputOption: 'RAW',
    requestBody: { values: [updated] },
  });
  console.error(`Added columns to Story Clusters: ${missing.join(', ')}`);
  return updated;
}

// Updates status, scriptId, and scriptGeneratedAt for one cluster data row
async function updateClusterRow(sheets, headers, dataRowIndex, scriptId, generatedAt) {
  const sheetRow = dataRowIndex + 2; // +1 for 1-based, +1 for header row
  const pairs = [
    ['status',           'script_generated'],
    ['scriptId',         scriptId],
    ['scriptGeneratedAt', generatedAt],
  ];
  const updates = pairs
    .map(([col, val]) => {
      const i = headers.indexOf(col);
      if (i < 0) return null;
      return { range: `${CLUSTERS_TAB}!${colLetter(i)}${sheetRow}`, values: [[val]] };
    })
    .filter(Boolean);

  if (updates.length === 0) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data: updates },
  });
}

async function main() {
  const [,, inputFile] = process.argv;
  if (!inputFile) {
    console.error('Usage: node helpers/write-scripts.js <path-to-scripts.json>');
    process.exit(1);
  }

  const scripts = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  if (!Array.isArray(scripts) || scripts.length === 0) {
    console.log('Input file contains no scripts.');
    return;
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  await ensureScriptsTab(sheets);
  const existingIds = await getExistingScriptIds(sheets);
  let { headers, rows: clusterRows } = await readClustersRaw(sheets);
  headers = await ensureClusterCols(sheets, headers);

  const clusterIdCol = headers.indexOf('clusterId');
  const newRows      = [];
  const pendingUpdates = [];

  for (const s of scripts) {
    if (!s.scriptId || !s.clusterId) {
      console.error(`Skipping entry — missing scriptId or clusterId.`);
      continue;
    }
    if (existingIds.has(s.scriptId)) {
      console.error(`Skipping ${s.scriptId} — already in ${SCRIPTS_TAB}.`);
      continue;
    }

    newRows.push(SCRIPT_COLUMNS.map(col => s[col] ?? ''));
    existingIds.add(s.scriptId);

    const rowIdx = clusterRows.findIndex(r => (r[clusterIdCol] || '').trim() === s.clusterId);
    if (rowIdx >= 0) {
      pendingUpdates.push({ rowIdx, scriptId: s.scriptId, generatedAt: s.generatedAt });
    } else {
      console.error(`Warning: clusterId ${s.clusterId} not found in Story Clusters — status not updated.`);
    }
    console.error(`Queued: ${s.scriptId} (${s.clusterId}) — ${s.clusterName}`);
  }

  if (newRows.length === 0) {
    console.log('No new scripts to write.');
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SCRIPTS_TAB}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: newRows },
  });
  console.log(`Wrote ${newRows.length} script(s) to "${SCRIPTS_TAB}" tab.`);

  for (const u of pendingUpdates) {
    await updateClusterRow(sheets, headers, u.rowIdx, u.scriptId, u.generatedAt);
    console.error(`Updated Story Clusters row for ${u.scriptId} → script_generated`);
  }

  console.log('Done.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
