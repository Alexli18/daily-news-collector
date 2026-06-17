'use strict';
/**
 * Reads approved clusters from Story Clusters sheet, generates draft scripts,
 * and writes them to the "Draft Scripts" tab.
 *
 * Usage: node helpers/write-scripts.js
 */

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs';
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const TAB = 'Draft Scripts';
const HEADERS = [
  'generatedAt', 'clusterId', 'clusterName', 'hook',
  'script', 'talkingPoints', 'contentNotes', 'riskLevel', 'sourceClusterStatus',
];

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const json = raw || Buffer.from(b64, 'base64').toString('utf8');
  return new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes: SCOPES });
}

async function ensureTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === TAB);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${TAB}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [HEADERS] },
    });
    console.error(`Created tab: ${TAB}`);
  }
}

async function getExistingClusterIds(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A:B`,
  });
  const rows = res.data.values || [];
  // Column B is clusterId; skip header row
  return new Set(rows.slice(1).map(r => (r[1] || '').trim()).filter(Boolean));
}

async function readApprovedClusters(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Story Clusters',
  });
  const rows = res.data.values || [];
  if (rows.length === 0) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1)
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = (row[i] || '').trim(); });
      return obj;
    })
    .filter(r => r.status === 'approved');
}

function generateScript(c) {
  // Tone: playful, simple, MS Paint-style cat characters
  const script = buildScript(c);
  const hook = buildHook(c);
  const talkingPoints = buildTalkingPoints(c);
  const contentNotes = buildContentNotes(c);
  return { script, hook, talkingPoints, contentNotes };
}

function buildHook(c) {
  // Use the suggestedVideoAngle as the base, shorten to one punchy line
  const angle = c.suggestedVideoAngle || c.clusterName;
  // Take up to the first sentence
  return angle.split(/[.!?]/)[0].trim();
}

function buildScript(c) {
  const metaphor = c.possibleCatMetaphor || '';
  const summary = c.eventSummary || '';
  const angle = c.suggestedVideoAngle || '';
  const framing = c.framingConflict || '';
  const missing = c.missingContext || '';

  // Extract the cat metaphor setup (before the dash, if present)
  const metaphorLines = metaphor.split('.');
  const catSetup = metaphorLines[0] ? metaphorLines[0].trim() : '';
  const catPunch = metaphorLines.slice(1).join('.').trim();

  // Build a structured 60-90 second script
  return [
    `Okay so — picture this.`,
    ``,
    `${catSetup}.`,
    ``,
    `${catPunch ? catPunch + '.' : ''}`.trim(),
    ``,
    `That's basically what happened here.`,
    ``,
    buildSummaryParagraph(summary),
    ``,
    buildFramingParagraph(framing),
    ``,
    buildMissingContextParagraph(missing),
    ``,
    `So — what's actually going on?`,
    ``,
    `Nobody has a clean answer yet. But the gap between what the deal says and what's happening on the ground? That part is not complicated.`,
    ``,
    catPunch ? `Remember: ${catPunch.toLowerCase()}.` : '',
    `That's the story.`,
  ].filter(line => line !== null && line !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildSummaryParagraph(summary) {
  // Split into 1-2 short sentences for pacing
  const sentences = summary.match(/[^.!?]+[.!?]+/g) || [summary];
  return sentences.slice(0, 3).join(' ').trim();
}

function buildFramingParagraph(framing) {
  if (!framing) return '';
  const parts = framing.split('.').filter(s => s.trim());
  if (parts.length === 0) return '';
  // Pick the sharpest contrast pair
  return `Here is the thing. ${parts.slice(0, 2).join('. ').trim()}.`;
}

function buildMissingContextParagraph(missing) {
  if (!missing) return '';
  const questions = missing.split('?').filter(s => s.trim());
  if (questions.length === 0) return '';
  // Surface the most important unanswered question
  return `And the question nobody is answering: ${questions[0].trim()}?`;
}

function buildTalkingPoints(c) {
  const points = [];
  if (c.framingConflict) {
    const parts = c.framingConflict.split('.').filter(s => s.trim());
    if (parts[0]) points.push(parts[0].trim());
  }
  if (c.missingContext) {
    const qs = c.missingContext.split('?').filter(s => s.trim());
    if (qs[0]) points.push(`Open question: ${qs[0].trim()}?`);
  }
  if (c.suggestedVideoAngle) {
    points.push(`Angle: ${c.suggestedVideoAngle}`);
  }
  return points.slice(0, 3).join(' | ');
}

function buildContentNotes(c) {
  const notes = [];
  if (c.riskLevel === 'high') {
    notes.push('HIGH RISK: Verify all claims independently before production.');
  } else if (c.riskLevel === 'medium') {
    notes.push('MEDIUM RISK: Cross-check sourcing before publish.');
  } else {
    notes.push('Low risk: sources confirmed.');
  }
  if (c.notes) notes.push(c.notes);
  return notes.join(' | ');
}

async function main() {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  await ensureTab(sheets);
  const existingIds = await getExistingClusterIds(sheets);
  const approved = await readApprovedClusters(sheets);

  if (approved.length === 0) {
    console.log('No approved clusters found. Nothing to write.');
    return;
  }

  const now = new Date().toISOString();
  const newRows = [];

  for (const c of approved) {
    if (existingIds.has(c.clusterId)) {
      console.error(`Skipping ${c.clusterId} — already in Draft Scripts.`);
      continue;
    }
    const { script, hook, talkingPoints, contentNotes } = generateScript(c);
    newRows.push([
      now,
      c.clusterId,
      c.clusterName,
      hook,
      script,
      talkingPoints,
      contentNotes,
      c.riskLevel,
      c.status,
    ]);
    console.error(`Queued: ${c.clusterId} — ${c.clusterName}`);
  }

  if (newRows.length === 0) {
    console.log('All approved clusters already have draft scripts. Nothing new to write.');
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${TAB}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: newRows },
  });

  console.log(`Wrote ${newRows.length} draft script(s) to "${TAB}" tab.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
