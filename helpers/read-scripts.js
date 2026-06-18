'use strict';
/**
 * Reads all rows from the "Scripts" sheet tab and prints them as a JSON array.
 *
 * Usage:  node helpers/read-scripts.js > /tmp/scripts-tab.json
 *
 * Each object has keys matching the Scripts tab header row.
 * scriptStatus lifecycle: draft → approved → plan_generated
 *
 * Filter in the calling agent — e.g. filter for scriptStatus === 'approved'
 * to find scripts that need a Visual Production Plan generated.
 */

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs';
const SCOPES         = ['https://www.googleapis.com/auth/spreadsheets'];
const SCRIPTS_TAB    = 'Scripts';

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const json = raw || Buffer.from(b64, 'base64').toString('utf8');
  return new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes: SCOPES });
}

async function main() {
  const sheets = google.sheets({ version: 'v4', auth: getAuth() });
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: SCRIPTS_TAB,
    });
  } catch (err) {
    if (err.message && (err.message.includes('Unable to parse range') || err.code === 400)) {
      // Tab does not exist yet — no scripts
      process.stdout.write('[]\n');
      return;
    }
    throw err;
  }
  const rows = res.data.values || [];
  if (rows.length === 0) { process.stdout.write('[]\n'); return; }
  const headers = rows[0].map(h => h.trim());
  const data = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (row[i] || '').trim(); });
    return obj;
  });
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

main().catch(e => { console.error(e.message); process.exit(1); });
