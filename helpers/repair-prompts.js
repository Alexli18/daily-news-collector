'use strict';
/**
 * Repairs Asset Queue imagePrompt and onScreenText fields for a given planId
 * by re-parsing scenePlanMarkdown from the Visual Plans tab.
 *
 * Usage: PLAN_ID=PLAN-YYYYMMDD-NNN node helpers/repair-prompts.js
 */

const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID || '1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs';
const SCOPES         = ['https://www.googleapis.com/auth/spreadsheets'];
const PLAN_ID        = (process.env.PLAN_ID || '').trim();

const STYLE_ANCHOR =
  'Childish MS Paint style, thick black outlines, flat bucket-fill colors, ' +
  'simple crude shapes, intentionally low quality, funny but clear, ' +
  '2D flat illustration, vertical 9:16, strong readability, cartoon cats, no realism';

const SAFETY_GUARDRAILS =
  'Do not add Eilat sirens or attribute them to Hezbollah. ' +
  'Do not show specific strike locations. ' +
  'Do not include Hormuz drone event. ' +
  'No realistic war footage. No gore. No real explosions. ' +
  'Keep rockets and sirens symbolic and cartoonish.';

// ─── auth ────────────────────────────────────────────────────────────────────

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const json = raw || Buffer.from(b64, 'base64').toString('utf8');
  return new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes: SCOPES });
}

// ─── utilities ───────────────────────────────────────────────────────────────

function colLetter(idx) {
  let result = '', n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

async function readTabAsObjects(sheets, tabName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'`,
  });
  const rows = res.data.values || [];
  if (rows.length === 0) return { headers: [], objects: [], rawRows: [] };
  const headers = rows[0].map(h => (h || '').trim());
  const objects = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
  return { headers, objects, rawRows: rows.slice(1) };
}

// ─── scene parsing ───────────────────────────────────────────────────────────

function parseScenes(markdown) {
  const pattern = /\[(\d{1,2}:\d{2})[–\-—](\d{1,2}:\d{2})\]\s*([\s\S]*?)(?=\[\d{1,2}:\d{2}[–\-—]|$)/g;
  const scenes = [];
  let m;
  while ((m = pattern.exec(markdown)) !== null) {
    const start = m[1].trim();
    const end   = m[2].trim();
    const body  = m[3].trim();
    const titleMatch = body.match(/^([^\n]+)/);
    const title = titleMatch ? titleMatch[1].replace(/\s*—\s*.*/, '').trim() : 'Scene';
    scenes.push({ start, end, body, title });
  }
  return scenes;
}

/**
 * Extracts on-screen text from a scene body.
 * Looks for "On-screen text: TEXT — styling notes." pattern.
 * Returns an array of text lines (for multi-line scenes).
 */
function extractOnScreenFromBody(body) {
  // Match "On-screen text: TEXT (anything up to Camera motion or Cat poses or end)"
  const match = body.match(/On-screen text:\s*([\s\S]*?)(?=Camera motion:|Cat poses:|Transition out:|Sound cues:|$)/i);
  if (!match) return [];

  const raw = match[1].trim();
  // Strip style annotations: " — white bold caps, ..." or " (upper area, ...)"
  // Split on semicolons or explicit line separators like "(upper area)"/"(lower area)"
  // Lines that are timing/instruction notes rather than display text
  const INSTRUCTION_LINE = /^(fades?|appears?|camera|transition|sound|hold|both lines|note:|do not|no |never)/i;
  // Pattern to detect timecodes like "at 0:51" — these are instructions, not text
  const HAS_TIMECODE = /\bat\s+\d+:\d+/i;

  const lines = raw
    .split(/;\s*|\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      // Remove everything from " — " followed by a style/placement word
      l = l.replace(/\s*—\s*(white|large|bold|caps|black|upper|lower|centered|confetti|yellow|black outline|slightly smaller).*$/i, '').trim();
      // Remove ALL parenthetical placement/style notes (anywhere in the line)
      l = l.replace(/\s*\([^)]*\)/g, '').trim();
      // Remove trailing instruction sentences like ". Both lines must remain legible..."
      l = l.replace(/\.\s+(both|hold|note:|all lines|must|should|keep|text must)[^.]*\.?$/i, '').trim();
      return l;
    })
    .filter(l => l.length > 0)
    // Drop lines that are timing/instruction notes, not display text
    .filter(l => !INSTRUCTION_LINE.test(l) && !HAS_TIMECODE.test(l));

  return lines;
}

/**
 * Extracts a visual description suitable for an image prompt from the scene body.
 * Takes the first 2–3 sentences that describe the visual content (before Cat poses / On-screen text).
 */
function extractVisualDescription(body) {
  // Remove the scene title line
  const withoutTitle = body.replace(/^[^\n]+\n/, '').trim();
  // Take the content before "Cat poses:" or "On-screen text:" — that's the main visual block
  const visualBlock = withoutTitle
    .split(/Cat poses:|On-screen text:|Camera motion:|Transition out:|Sound cues:/i)[0]
    .trim();
  // Return first 3 sentences, cleaned up
  const sentences = visualBlock.split(/\.\s+/).slice(0, 3);
  return sentences.join('. ').replace(/\.\s*$/, '').trim() + '.';
}

/**
 * Extracts cat pose description from the scene body.
 */
function extractCatPoses(body) {
  const match = body.match(/Cat poses:\s*([\s\S]*?)(?=On-screen text:|Camera motion:|Transition out:|Sound cues:|$)/i);
  if (!match) return '';
  return match[1].trim().replace(/\.$/, '').trim();
}

/**
 * Extracts composition / camera motion from the scene body.
 */
function extractComposition(body) {
  const match = body.match(/Camera motion:\s*([\s\S]*?)(?=Transition out:|Sound cues:|On-screen text:|$)/i);
  if (!match) return '';
  return match[1].trim().replace(/\.$/, '').trim();
}

/**
 * Infers background from scene body text.
 */
function inferBackground(body) {
  if (/newspaper|front page/i.test(body)) return 'newspaper front page, scroll-beige paper texture';
  if (/split\s*panel|split\s*screen/i.test(body)) return 'split panel — left half newspaper, right half classroom chalkboard';
  if (/world map|parchment/i.test(body)) return 'scroll-beige parchment world map';
  if (/outdoor|wooden sign|model farm/i.test(body)) return 'outdoor scene, white background';
  return 'white MS Paint background';
}

/**
 * Builds a clean, complete imagePrompt from parsed scene data and on-screen text lines.
 */
function buildImagePrompt(scene, onScreenLines) {
  const visualDesc  = extractVisualDescription(scene.body);
  const catPoses    = extractCatPoses(scene.body);
  const composition = extractComposition(scene.body);
  const background  = inferBackground(scene.body);

  const parts = [];

  // A. Style
  parts.push(`Style: ${STYLE_ANCHOR}.`);

  // B. Scene content
  parts.push(`Scene: ${visualDesc}`);
  if (catPoses) parts.push(`Cat poses: ${catPoses}.`);
  parts.push(`Background: ${background}.`);
  if (composition) parts.push(`Composition: ${composition}.`);

  // C. Visible text
  if (onScreenLines.length === 1) {
    parts.push(`Visible on-screen text: "${onScreenLines[0]}".`);
  } else if (onScreenLines.length > 1) {
    const formatted = onScreenLines.map((l, i) => `line ${i + 1}: "${l}"`).join(', ');
    parts.push(`Visible on-screen text: ${formatted}.`);
  }
  if (onScreenLines.length > 0) {
    parts.push('Large readable text, simple lettering, high contrast, white text with black outline.');
  }

  // D. Safety
  parts.push(`Safety: ${SAFETY_GUARDRAILS}`);

  return parts.join(' ');
}

/**
 * Builds a simple 2-column onScreenTextMaster table for the Visual Plans tab.
 * Format: | timecode | text |
 * This is what extractOnScreenText() in expand-to-asset-queue.js expects.
 */
function buildSimpleTextMaster(scenes, onScreenByScene) {
  const rows = scenes.map((scene, i) => {
    const lines = onScreenByScene[i] || [];
    const text  = lines.join(' / ');
    return `| ${scene.start}–${scene.end} | ${text || '(no on-screen text)'} |`;
  });
  return ['| Timecode | On-screen text |', ...rows].join('\n');
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!PLAN_ID) {
    console.error('Usage: PLAN_ID=PLAN-YYYYMMDD-NNN node helpers/repair-prompts.js');
    process.exit(1);
  }

  const auth   = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Read Visual Plans
  const vpData = await readTabAsObjects(sheets, 'Visual Plans');
  const plan   = vpData.objects.find(p => p.planId === PLAN_ID);
  if (!plan) {
    console.error(`Plan not found in Visual Plans: ${PLAN_ID}`);
    process.exit(1);
  }
  const planRowIdx = vpData.objects.indexOf(plan); // 0-based data row index

  // Parse scenes from scenePlanMarkdown
  const scenes = parseScenes(plan.scenePlanMarkdown || '');
  if (scenes.length === 0) {
    console.error('No scenes parsed from scenePlanMarkdown');
    process.exit(1);
  }
  console.error(`Parsed ${scenes.length} scenes from ${PLAN_ID}`);

  // Extract on-screen text for each scene
  const onScreenByScene = scenes.map(s => extractOnScreenFromBody(s.body));
  scenes.forEach((s, i) => {
    console.error(`  Scene ${i + 1} [${s.start}–${s.end}]: ${JSON.stringify(onScreenByScene[i])}`);
  });

  // Read Asset Queue
  const aqData   = await readTabAsObjects(sheets, 'Asset Queue');
  const aqRows   = aqData.objects
    .map((r, i) => ({ ...r, _rowIdx: i }))
    .filter(r => r.planId === PLAN_ID)
    .sort((a, b) => Number(a.sceneNumber) - Number(b.sceneNumber));

  if (aqRows.length === 0) {
    console.error('No Asset Queue rows found for', PLAN_ID);
    process.exit(1);
  }

  const aqHeaders = aqData.headers;
  const onScreenColIdx = aqHeaders.indexOf('onScreenText');
  const promptColIdx   = aqHeaders.indexOf('imagePrompt');
  const validationColIdx = aqHeaders.indexOf('promptValidationStatus');

  if (onScreenColIdx < 0 || promptColIdx < 0) {
    console.error('Missing required columns in Asset Queue');
    process.exit(1);
  }

  // Build repair data
  const batchData = [];
  for (const row of aqRows) {
    const sceneIdx = Number(row.sceneNumber) - 1;
    const scene    = scenes[sceneIdx];
    if (!scene) {
      console.error(`  No scene at index ${sceneIdx} for row sceneNumber=${row.sceneNumber}`);
      continue;
    }

    const onScreenLines = onScreenByScene[sceneIdx];
    const cleanedText   = onScreenLines.join('\n');
    const newPrompt     = buildImagePrompt(scene, onScreenLines);
    const sheetRow      = row._rowIdx + 2; // +1 for header row, +1 for 1-based index

    batchData.push({
      range:  `'Asset Queue'!${colLetter(onScreenColIdx)}${sheetRow}`,
      values: [[cleanedText]],
    });
    batchData.push({
      range:  `'Asset Queue'!${colLetter(promptColIdx)}${sheetRow}`,
      values: [[newPrompt]],
    });
    if (validationColIdx >= 0) {
      batchData.push({
        range:  `'Asset Queue'!${colLetter(validationColIdx)}${sheetRow}`,
        values: [['valid']],
      });
    }

    console.error(`  Scene ${sceneIdx + 1}: onScreen=${JSON.stringify(cleanedText.substring(0, 60))}`);
  }

  if (batchData.length === 0) {
    console.error('Nothing to update.');
    process.exit(0);
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data: batchData },
  });
  console.error(`Updated ${aqRows.length} Asset Queue rows.`);

  // Fix onScreenTextMaster in Visual Plans to 2-column format
  const simpleTextMaster = buildSimpleTextMaster(scenes, onScreenByScene);
  const textMasterColIdx = vpData.headers.indexOf('onScreenTextMaster');
  if (textMasterColIdx >= 0) {
    const vpSheetRow = planRowIdx + 2;
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [{
          range:  `'Visual Plans'!${colLetter(textMasterColIdx)}${vpSheetRow}`,
          values: [[simpleTextMaster]],
        }],
      },
    });
    console.error('Updated onScreenTextMaster in Visual Plans to 2-column format.');
  }

  console.log(JSON.stringify({ repaired: aqRows.length, plan_id: PLAN_ID }));
}

main().catch(e => { console.error(e.message); process.exit(1); });
