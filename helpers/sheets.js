#!/usr/bin/env node
'use strict';

/**
 * Google Sheets helper for daily-news-collector.
 *
 * Commands:
 *   read-seen                → prints JSON array of dedupeKeys from Seen Items sheet
 *   append-news <file>       → appends rows from JSON file to Raw News sheet
 *   append-seen <file>       → appends rows from JSON file to Seen Items sheet
 *   log <file>               → appends log entries from JSON file to Logs sheet
 *   init                     → creates sheet tabs + headers if missing (safe to re-run)
 *
 * Required env var:
 *   GOOGLE_SERVICE_ACCOUNT_JSON — full JSON of a Google Service Account key.
 *   The service account must have Editor access to the spreadsheet.
 *
 *   Optional override:
 *   SPREADSHEET_ID — defaults to the hardcoded sheet ID below.
 */

const fs = require('fs');
const { google } = require('googleapis');

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

const SHEET_HEADERS = {
  'Raw News': [
    'collectedAt', 'publishedAt', 'sourceName', 'sourceType', 'language',
    'title', 'url', 'excerpt', 'contentSnippet', 'guid', 'dedupeKey', 'status',
  ],
  'Seen Items': ['dedupeKey', 'url', 'title', 'sourceName', 'firstSeenAt'],
  'Logs':       ['timestamp', 'level', 'message', 'sourceName', 'details'],
};

function getAuth() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyJson) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not set.\n' +
      'See README.md — "Google authentication setup" section.'
    );
  }
  return new google.auth.GoogleAuth({ credentials: JSON.parse(keyJson), scopes: SCOPES });
}

async function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}

// Returns current sheet titles from spreadsheet metadata
async function getExistingSheetTitles(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  return new Set(meta.data.sheets.map(s => s.properties.title));
}

async function ensureSheetAndHeaders(sheets, sheetName) {
  const existing = await getExistingSheetTitles(sheets);

  if (!existing.has(sheetName)) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: sheetName } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [SHEET_HEADERS[sheetName]] },
    });
    console.error(`Created sheet tab: ${sheetName}`);
    return;
  }

  // Tab exists — check whether row 1 has headers already
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!1:1`,
  });
  const firstRow = (res.data.values || [[]])[0] || [];
  if (firstRow.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [SHEET_HEADERS[sheetName]] },
    });
    console.error(`Added headers to existing empty sheet: ${sheetName}`);
  }
}

async function cmdReadSeen() {
  const sheets = await getSheetsClient();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "'Seen Items'!A:A",
    });
  } catch (err) {
    // Sheet doesn't exist yet — no seen items
    if (err.message && (err.message.includes('Unable to parse range') || err.code === 400)) {
      process.stdout.write('[]\n');
      return;
    }
    throw err;
  }
  const rows = res.data.values || [];
  // Row 0 is the header — skip it
  const keys = rows.slice(1).map(r => r[0]).filter(Boolean);
  process.stdout.write(JSON.stringify(keys) + '\n');
}

async function cmdAppendNews(filepath) {
  const items = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  if (!items.length) { console.log('0 rows — nothing to append to Raw News.'); return; }
  const sheets = await getSheetsClient();
  await ensureSheetAndHeaders(sheets, 'Raw News');
  const headers = SHEET_HEADERS['Raw News'];
  const rows = items.map(item => headers.map(h => String(item[h] ?? '')));
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Raw News'!A1",
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
  console.log(`Appended ${rows.length} rows to Raw News.`);
}

async function cmdAppendSeen(filepath) {
  const items = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  if (!items.length) { console.log('0 rows — nothing to append to Seen Items.'); return; }
  const sheets = await getSheetsClient();
  await ensureSheetAndHeaders(sheets, 'Seen Items');
  const headers = SHEET_HEADERS['Seen Items'];
  const rows = items.map(item => headers.map(h => String(item[h] ?? '')));
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Seen Items'!A1",
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
  console.log(`Appended ${rows.length} rows to Seen Items.`);
}

async function cmdLog(filepath) {
  const raw = JSON.parse(fs.readFileSync(filepath, 'utf8'));
  const entries = Array.isArray(raw) ? raw : [raw];
  const sheets = await getSheetsClient();
  await ensureSheetAndHeaders(sheets, 'Logs');
  const now = new Date().toISOString();
  const rows = entries.map(e => [
    e.timestamp || now,
    e.level     || 'INFO',
    e.message   || '',
    e.sourceName || '',
    e.details   || '',
  ]);
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Logs'!A1",
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
  console.log(`Appended ${rows.length} log entries.`);
}

async function cmdInit() {
  const sheets = await getSheetsClient();
  for (const name of Object.keys(SHEET_HEADERS)) {
    await ensureSheetAndHeaders(sheets, name);
    console.log(`✓  ${name}`);
  }
  console.log('Sheet initialization complete.');
}

async function main() {
  const [,, command, filepath] = process.argv;
  try {
    switch (command) {
      case 'read-seen':    await cmdReadSeen();          break;
      case 'append-news':  await cmdAppendNews(filepath); break;
      case 'append-seen':  await cmdAppendSeen(filepath); break;
      case 'log':          await cmdLog(filepath);        break;
      case 'init':         await cmdInit();               break;
      default:
        console.error('Unknown command:', command);
        console.error('Usage: node helpers/sheets.js <read-seen|append-news|append-seen|log|init> [file]');
        process.exit(1);
    }
  } catch (err) {
    console.error('[sheets.js ERROR]', err.message);
    process.exit(1);
  }
}

main();
