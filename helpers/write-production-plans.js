'use strict';
/**
 * Writes visual production plan data to the "Production Plans" sheet tab and
 * updates the originating Scripts rows to scriptStatus=plan_generated.
 *
 * Usage: node helpers/write-production-plans.js <path-to-production-plans.json>
 *
 * Input JSON: array of objects whose keys match PLAN_COLUMNS.
 * Required per object: planId, scriptId, generatedAt.
 */

const fs = require('fs');
const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs';
const SCOPES         = ['https://www.googleapis.com/auth/spreadsheets'];
const PLANS_TAB      = 'Visual Plans';
const SCRIPTS_TAB    = 'Scripts';

const PLAN_COLUMNS = [
  'planId',
  'generatedAt',
  'scriptId',
  'clusterName',
  'totalRuntime',
  'sceneCount',
  'globalVisualStyle',
  'colorPalette',
  'characterReference',
  'scenePlanMarkdown',
  'onScreenTextMaster',
  'transitionSummary',
  'editorGuardrails',
  'subtitleNotes',
];

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const json = raw || Buffer.from(b64, 'base64').toString('utf8');
  return new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes: SCOPES });
}

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

async function ensurePlansTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === PLANS_TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: PLANS_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${PLANS_TAB}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [PLAN_COLUMNS] },
    });
    console.error(`Created tab: ${PLANS_TAB}`);
  }
}

async function getExistingPlanIds(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${PLANS_TAB}'!A:A`,
  });
  const rows = res.data.values || [];
  return new Set(rows.slice(1).map(r => (r[0] || '').trim()).filter(Boolean));
}

async function readScriptsRaw(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: SCRIPTS_TAB,
  });
  const all = res.data.values || [];
  if (all.length === 0) return { headers: [], rows: [] };
  return { headers: all[0].map(h => h.trim()), rows: all.slice(1) };
}

async function updateScriptRow(sheets, headers, dataRowIndex, status) {
  const sheetRow = dataRowIndex + 2; // +1 for 1-based, +1 for header row
  const colIdx = headers.indexOf('scriptStatus');
  if (colIdx < 0) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SCRIPTS_TAB}!${colLetter(colIdx)}${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[status]] },
  });
}

async function main() {
  const [,, inputFile] = process.argv;
  if (!inputFile) {
    console.error('Usage: node helpers/write-production-plans.js <path-to-production-plans.json>');
    process.exit(1);
  }

  const plans = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  if (!Array.isArray(plans) || plans.length === 0) {
    console.log('Input file contains no production plans.');
    return;
  }

  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  await ensurePlansTab(sheets);
  const existingIds = await getExistingPlanIds(sheets);
  const { headers: scriptHeaders, rows: scriptRows } = await readScriptsRaw(sheets);
  const scriptIdCol = scriptHeaders.indexOf('scriptId');

  const newRows = [];
  const pendingUpdates = [];

  for (const p of plans) {
    if (!p.planId || !p.scriptId) {
      console.error('Skipping entry — missing planId or scriptId.');
      continue;
    }
    if (existingIds.has(p.planId)) {
      console.error(`Skipping ${p.planId} — already in ${PLANS_TAB}.`);
      continue;
    }

    newRows.push(PLAN_COLUMNS.map(col => String(p[col] ?? '')));
    existingIds.add(p.planId);

    const rowIdx = scriptRows.findIndex(r => (r[scriptIdCol] || '').trim() === p.scriptId);
    if (rowIdx >= 0) {
      pendingUpdates.push({ rowIdx });
    } else {
      console.error(`Warning: scriptId ${p.scriptId} not found in Scripts tab — status not updated.`);
    }
    console.error(`Queued: ${p.planId} (${p.scriptId})`);
  }

  if (newRows.length === 0) {
    console.log('No new production plans to write.');
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${PLANS_TAB}'!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: newRows },
  });
  console.log(`Wrote ${newRows.length} production plan(s) to "${PLANS_TAB}" tab.`);

  for (const u of pendingUpdates) {
    await updateScriptRow(sheets, scriptHeaders, u.rowIdx, 'plan_generated');
    console.error(`Updated Scripts row → plan_generated`);
  }

  console.log('Done.');
}

main().catch(e => { console.error(e.message); process.exit(1); });
