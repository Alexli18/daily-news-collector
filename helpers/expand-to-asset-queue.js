'use strict';
/**
 * Reads the "Visual Plans" tab, parses scenePlanMarkdown for each eligible plan,
 * and writes one "Asset Queue" row per scene.
 *
 * Usage:  node helpers/expand-to-asset-queue.js
 * Stdout: JSON — { plans_processed, scenes_created, skipped, failed }
 *
 * Repair mode (update existing rows without appending duplicates):
 *   REPAIR_PLAN_ID=PLAN-YYYYMMDD-NNN node helpers/expand-to-asset-queue.js
 */

const { google } = require('googleapis');

const SPREADSHEET_ID   = process.env.SPREADSHEET_ID || '1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs';
const SCOPES           = ['https://www.googleapis.com/auth/spreadsheets'];
const VISUAL_PLANS_TAB = 'Visual Plans';
const ASSET_QUEUE_TAB  = 'Asset Queue';
const LOGS_TAB         = 'Logs';
const REPAIR_PLAN_ID   = (process.env.REPAIR_PLAN_ID || '').trim();

const ASSET_QUEUE_COLUMNS = [
  'assetPlanId', 'planId', 'scriptId', 'clusterName', 'createdAt',
  'sceneNumber', 'sceneStart', 'sceneEnd', 'sceneDuration', 'sceneType',
  'voiceoverLine', 'onScreenText', 'character', 'background',
  'visualDescription', 'compositionNotes', 'transition', 'safetyNotes',
  'imagePrompt', 'assetStatus', 'assetFileName', 'assetLocation',
  'assetGeneratedAt', 'assetNotes', 'promptValidationStatus',
];

// Style anchor prepended to every imagePrompt
const STYLE_ANCHOR =
  'Childish MS Paint style, thick black outlines, flat bucket-fill colors, ' +
  'simple crude shapes, intentionally low quality, funny but clear, ' +
  '2D flat illustration, vertical 9:16, strong readability, cartoon cats, no realism';

// Safety guardrails appended to every imagePrompt
const SAFETY_GUARDRAILS =
  'Do not add Eilat sirens or attribute them to Hezbollah. ' +
  'Do not show specific strike locations. ' +
  'Do not include Hormuz drone event. ' +
  'No realistic war footage. No gore. No real explosions. ' +
  'Keep rockets and sirens symbolic and cartoonish.';

// ─── production-instruction patterns ────────────────────────────────────────
// Each entry maps a regex (to strip from onScreenText) to a layout hint
// (to move into the imagePrompt layout section).

const INSTRUCTION_PATTERNS = [
  { re: /\s*\blower-left\b/gi,      hint: 'Place this text in the lower-left corner.' },
  { re: /\s*\blower-right\b/gi,     hint: 'Place this text in the lower-right corner.' },
  { re: /\s*\btop-left\b/gi,        hint: 'Place this text in the top-left corner.' },
  { re: /\s*\btop-right\b/gi,       hint: 'Place this text in the top-right corner.' },
  { re: /\s*\bspeech\s*bubble\b/gi, hint: 'Display this text in a speech bubble.' },
  { re: /\s*\bon\s+scroll\b/gi,     hint: 'This text appears on the scroll prop.' },
  { re: /\s*\bstaggered\b/gi,       hint: 'Display these lines staggered vertically, appearing in sequence.' },
  { re: /\s*\bblinking\b/gi,        hint: 'This text blinks on screen.' },
  { re: /\s*\(red\)/gi,             hint: 'Use red text.' },
  { re: /\s*\(white\)/gi,           hint: 'Use white text.' },
  { re: /\s*\(black\)/gi,           hint: 'Use black text.' },
  { re: /\s*\bcaption\b/gi,         hint: 'Display as a caption overlay.' },
  { re: /\s*\btext\s*card\b/gi,     hint: 'Display as a full-frame text card.' },
  { re: /\s*\blabel\b/gi,           hint: 'Display as a label with indicator.' },
];

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

function timeToSeconds(t) {
  const parts = t.trim().split(':').map(Number);
  return parts.length === 3
    ? parts[0] * 3600 + parts[1] * 60 + parts[2]
    : parts[0] * 60 + (parts[1] || 0);
}

// ─── scene parsing ───────────────────────────────────────────────────────────

function parseScenes(markdown) {
  if (!markdown) return [];
  const pattern = /\[(\d{1,2}:\d{2})[–\-—](\d{1,2}:\d{2})\]\s*([\s\S]*?)(?=\[\d{1,2}:\d{2}[–\-—]|$)/g;
  const scenes = [];
  let m;
  while ((m = pattern.exec(markdown)) !== null) {
    const start = m[1].trim();
    const end   = m[2].trim();
    const body  = m[3].trim();
    const titleMatch = body.match(/^([^\n—]+)/);
    const title = titleMatch ? titleMatch[1].replace(/\s*—\s*.*/, '').trim() : 'Scene';
    scenes.push({ start, end, duration: timeToSeconds(end) - timeToSeconds(start), title, body });
  }
  return scenes;
}

// ─── onScreenText cleaning ───────────────────────────────────────────────────

/**
 * Removes production instruction words from raw extracted text and returns
 * both the cleaned visible text and an array of layout hints to carry into
 * the imagePrompt.
 */
function extractAndCleanText(rawText) {
  if (!rawText) return { cleaned: '', hints: [] };
  let text = rawText;
  const hints = [];

  for (const { re, hint } of INSTRUCTION_PATTERNS) {
    const testRe  = new RegExp(re.source, re.flags);
    const cleanRe = new RegExp(re.source, re.flags);
    if (testRe.test(text)) {
      hints.push(hint);
      text = text.replace(cleanRe, '');
    }
  }

  // "/" → newline (scene text separator in the raw master field)
  text = text.replace(/\s*\/\s*/g, '\n');
  // Normalise whitespace per line
  text = text.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
  return { cleaned: text.trim(), hints };
}

/**
 * Checks whether any suspicious instruction terms survived cleaning.
 * Returns { isValid, flags }.
 */
function validateOnScreenText(cleanedText) {
  if (!cleanedText) return { isValid: true, flags: [] };
  const flags = INSTRUCTION_PATTERNS
    .filter(({ re }) => new RegExp(re.source, 'i').test(cleanedText))
    .map(({ re }) => re.source);
  return { isValid: flags.length === 0, flags };
}

// Format cleaned text for the imagePrompt "visible on-screen text" section.
function formatTextForPrompt(cleanedText) {
  const lines = cleanedText.split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  if (lines.length === 1) return `"${lines[0]}"`;
  return lines.map((l, i) => `line ${i + 1}: "${l}"`).join(', ');
}

// ─── field inference ─────────────────────────────────────────────────────────

function inferSceneType(text) {
  const t = text.toLowerCase();
  if (/hook\s*card/.test(t))                                            return 'hook_card';
  if (/signing|agreement|no scratching|memo|metaphor/.test(t))         return 'metaphor_setup';
  if (/newspaper|headline|deal|announcement|front page/.test(t))       return 'headline_visual';
  if (/rocket|intercept|launch|same day/.test(t))                      return 'news_reveal';
  if (/split\s*screen|left.*right|vs\./.test(t))                       return 'framing_split';
  if (/question|no comment|podium|didn't|open question/.test(t))       return 'question_scene';
  if (/closing|loop|wink|fade|punchline|shreds|back to scene/.test(t)) return 'final_punchline';
  return 'other';
}

function inferCharacters(body) {
  const checks = [
    [/cat owner|owner.*desk|stick.figure.*whisker/i, 'Cat Owner'],
    [/basement cat/i,    'Basement Cat'],
    [/anchor cat/i,      'Anchor Cat'],
    [/headline cat/i,    'Headline Cat'],
    [/context cat/i,     'Context Cat'],
    [/map cat/i,         'Map Cat'],
    [/happy cats|background cats|cats in background|stick cats/i, 'Happy Cats'],
  ];
  const found = checks.filter(([re]) => re.test(body)).map(([, name]) => name);
  if (found.length === 0 && /cat/i.test(body)) found.push('Cat');
  return found.join(', ');
}

function inferBackground(body) {
  if (/black\s*bg|black\s*background/i.test(body))         return 'black';
  if (/red\s*bg|red\s*background|screen.*red/i.test(body)) return 'alert red';
  if (/newspaper|front page/i.test(body))                  return 'newspaper page';
  if (/split\s*screen/i.test(body))                        return 'split screen, white both halves';
  if (/desk/i.test(body))                                  return 'white, large desk centre';
  if (/trapdoor|basement/i.test(body))                     return 'white with basement trapdoor';
  if (/podium/i.test(body))                                return 'white with empty podium centre';
  return 'white';
}

function inferComposition(title, body) {
  const t = (title + ' ' + body).toLowerCase();
  if (/hook\s*card/.test(t))              return 'centered hook card, full-frame text';
  if (/split\s*screen/.test(t))           return 'split-screen, 50/50 vertical divide';
  if (/close.?up/.test(t))               return 'close-up on subject, centre frame';
  if (/zoom.?in/.test(t))                return 'zoom-in from centre';
  if (/newspaper|front page/.test(t))    return 'full-frame newspaper zoom-in';
  if (/trapdoor|basement/.test(t))       return 'wide shot with trapdoor bottom-left';
  if (/desk/.test(t))                    return 'wide shot, cat owner at desk centre';
  if (/podium/.test(t))                  return 'centred podium, wide shot';
  if (/fills.*frame|full.*frame/.test(t)) return 'full frame, centred';
  return 'centred composition';
}

function inferTransition(body, hasNext) {
  const t = (body || '').toLowerCase();
  if (/hard cut/.test(t))                   return 'hard cut';
  if (/wipe right/.test(t))                 return 'wipe right';
  if (/white flash/.test(t))                return 'white flash + cut';
  if (/split.*slide|slide.*split/.test(t))  return 'vertical split slide';
  if (/push.?in/.test(t))                   return 'push-in zoom';
  if (/dissolve/.test(t))                   return 'dissolve';
  if (/fade.*black/.test(t))                return 'fade to black';
  return hasNext ? 'cut' : 'fade to black';
}

function extractOnScreenText(master, start, end) {
  if (!master) return '';
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Table row: | 0:00–0:05 | text | ...
  const tableRe = new RegExp(`\\|\\s*${esc(start)}[–\\-—]${esc(end)}\\s*\\|([^|]+)`, 'i');
  const tm = master.match(tableRe);
  if (tm) return tm[1].trim();
  // Plain: "0:00-0:05 text. 0:05-0:12 more text" — stop at next timecode
  const plainRe = new RegExp(
    `${esc(start)}[–\\-—]${esc(end)}\\s*([\\s\\S]*?)(?=\\s+\\d{1,2}:\\d{2}[–\\-—]\\d{1,2}:\\d{2}|\\s*$)`,
    'i'
  );
  const pm = master.match(plainRe);
  if (pm) return pm[1].trim().replace(/\.\s*$/, '').trim();
  return '';
}

function extractSafetyNotes(guardrails) {
  if (!guardrails) return '';
  return guardrails
    .split(/\n|\.\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 8 && /not|no |never|do not|don't|avoid|exclude|without/i.test(s))
    .slice(0, 3)
    .join('; ');
}

// ─── prompt building ──────────────────────────────────────────────────────────

/**
 * Builds a structured imagePrompt with clearly separated sections:
 *   A. Style anchor (always first)
 *   B. Scene description: action, characters, background, tone
 *   C. Visible on-screen text + layout instructions (only when text exists)
 *   D. Safety guardrails (always last)
 */
function buildStructuredImagePrompt(scene, plan, cleanedText, layoutHints) {
  const chars  = inferCharacters(scene.body);
  const bg     = inferBackground(scene.body);
  const action = scene.body
    .replace(/^[^—]*—\s*/, '')
    .split(/\.\s+|\n/)[0]
    .trim() || scene.title;

  let tone = 'neutral, illustrative';
  if (/confused|what memo|\?/i.test(scene.body))          tone = 'confused, curious';
  if (/happy|confetti|peace|smile/i.test(scene.body))     tone = 'happy, celebratory';
  if (/red|rocket|siren|alert|danger/i.test(scene.body))  tone = 'alarming, urgent';
  if (/shrug|no comment|deadpan/i.test(scene.body))       tone = 'deadpan, ironic';
  if (/wink|punchline|loop back/i.test(scene.body))       tone = 'cheeky, knowing';
  if (/crumpled|scratch|tear|shreds/i.test(scene.body))   tone = 'dramatic, impactful';

  const parts = [];

  // A. Style
  parts.push(`Style: ${STYLE_ANCHOR}.`);

  // B. Scene content
  parts.push(`Scene: ${action}.`);
  if (chars) parts.push(`Characters: ${chars}.`);
  parts.push(`Background: ${bg}.`);
  parts.push(`Tone: ${tone}.`);

  // C. Visible text + layout
  const formatted = formatTextForPrompt(cleanedText);
  if (formatted) {
    parts.push(`Visible on-screen text: ${formatted}.`);
    if (layoutHints.length > 0) parts.push(layoutHints.join(' '));
    parts.push('Large readable text, simple lettering, high contrast.');
  }

  // D. Safety
  parts.push(`Safety: ${SAFETY_GUARDRAILS}`);

  return parts.join(' ');
}

// ─── sheet utilities ──────────────────────────────────────────────────────────

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

async function ensureTabWithHeaders(sheets, tabName, columns) {
  const meta   = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = meta.data.sheets.some(s => s.properties.title === tabName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${tabName}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [columns] },
    });
    console.error(`Created tab: ${tabName}`);
  }
}

async function ensureColumns(sheets, tabName, headers, newCols) {
  const missing = newCols.filter(c => !headers.includes(c));
  if (missing.length === 0) return headers;
  const updated = [...headers, ...missing];
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${tabName}'!1:1`,
    valueInputOption: 'RAW',
    requestBody: { values: [updated] },
  });
  console.error(`Added columns to ${tabName}: ${missing.join(', ')}`);
  return updated;
}

async function updateCells(sheets, tabName, headers, dataRowIndex, updates) {
  const sheetRow = dataRowIndex + 2;
  const data = Object.entries(updates)
    .map(([col, val]) => {
      const i = headers.indexOf(col);
      if (i < 0) return null;
      return { range: `'${tabName}'!${colLetter(i)}${sheetRow}`, values: [[String(val ?? '')]] };
    })
    .filter(Boolean);
  if (data.length === 0) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
}

async function appendLog(sheets, entries) {
  const now  = new Date().toISOString();
  const rows = entries.map(e => [
    e.timestamp  || now,
    e.level      || 'INFO',
    e.message    || '',
    e.sourceName || '',
    e.details    || '',
  ]);
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${LOGS_TAB}'!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rows },
    });
  } catch (e) {
    console.error('Failed to write logs:', e.message);
  }
}

// ─── scene row builder ────────────────────────────────────────────────────────

/**
 * Builds all computed fields for one scene row. Shared by the append path
 * (new plans) and the in-place update path (repair / dedup).
 */
function buildSceneFields(scene, sceneIdx, plan, now, isLong) {
  const rawText              = extractOnScreenText(plan.onScreenTextMaster, scene.start, scene.end);
  const { cleaned, hints }   = extractAndCleanText(rawText);
  const { isValid, flags }   = validateOnScreenText(cleaned);
  const safetyNote           = extractSafetyNotes(plan.editorGuardrails);

  const promptValidationStatus = isValid ? 'valid' : 'needs_prompt_fix';
  const assetStatus            = isValid ? 'pending_assets' : 'needs_prompt_fix';
  const assetNotes = (() => {
    const parts = [];
    if (isLong && sceneIdx === 0) parts.push('consider compressing this video to 6–7 scenes; runtime may be long for Shorts');
    if (!isValid) parts.push(`Suspicious terms in onScreenText: ${flags.join(', ')}`);
    return parts.join('; ');
  })();

  return {
    sceneType:             inferSceneType(scene.title + ' ' + scene.body),
    voiceoverLine:         scene.title,
    onScreenText:          cleaned,
    character:             inferCharacters(scene.body),
    background:            inferBackground(scene.body),
    visualDescription:     scene.body.split('\n')[0].replace(/^[^—]*—\s*/, '').trim() || scene.title,
    compositionNotes:      inferComposition(scene.title, scene.body),
    transition:            inferTransition(scene.body, sceneIdx < /* will be set at call site */ 999),
    safetyNotes:           safetyNote,
    imagePrompt:           buildStructuredImagePrompt(scene, plan, cleaned, hints),
    assetStatus,
    assetNotes,
    promptValidationStatus,
  };
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const auth   = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const now    = new Date().toISOString();

  if (REPAIR_PLAN_ID) console.error(`Repair mode: targeting ${REPAIR_PLAN_ID}`);

  const summary    = { plans_processed: 0, scenes_created: 0, skipped: 0, failed: 0 };
  const logEntries = [];

  // Ensure Asset Queue tab exists
  await ensureTabWithHeaders(sheets, ASSET_QUEUE_TAB, ASSET_QUEUE_COLUMNS);

  // Read Asset Queue (needed for deduplication and in-place updates)
  let aqData = await readTabAsObjects(sheets, ASSET_QUEUE_TAB);
  let { headers: aqHeaders, objects: aqObjects } = aqData;
  // Ensure promptValidationStatus column exists on pre-existing tabs
  aqHeaders = await ensureColumns(sheets, ASSET_QUEUE_TAB, aqHeaders, ['promptValidationStatus']);
  const existingPlanIds = new Set(aqObjects.map(r => r.planId).filter(Boolean));

  // Read Visual Plans
  let vpData;
  try {
    vpData = await readTabAsObjects(sheets, VISUAL_PLANS_TAB);
  } catch (e) {
    logEntries.push({ level: 'ERROR', message: `Cannot read ${VISUAL_PLANS_TAB}`, details: e.message });
    await appendLog(sheets, logEntries);
    process.stdout.write(JSON.stringify(summary));
    return;
  }
  let { headers: vpHeaders, objects: plans } = vpData;

  // Ensure expansionStatus + expandedAt columns in Visual Plans
  vpHeaders = await ensureColumns(sheets, VISUAL_PLANS_TAB, vpHeaders, ['expansionStatus', 'expandedAt']);

  // Filter eligible plans
  const eligible = plans
    .map((p, i) => ({ ...p, _rowIdx: i }))
    .filter(p => {
      if (!p.planId || !p.scenePlanMarkdown || !p.scriptId) return false;
      // Repair mode: override eligibility filter for the target plan
      if (REPAIR_PLAN_ID && p.planId === REPAIR_PLAN_ID) return true;
      const s = (p.expansionStatus || '').trim().toLowerCase();
      return s === '' || s === 'pending';
    });

  if (eligible.length === 0) {
    logEntries.push({ level: 'INFO', message: 'expand-to-asset-queue: no eligible plans', details: `total_plans:${plans.length}` });
    await appendLog(sheets, logEntries);
    process.stdout.write(JSON.stringify(summary));
    return;
  }

  for (const plan of eligible) {
    try {
      const scenes   = parseScenes(plan.scenePlanMarkdown);
      if (scenes.length === 0) throw new Error('No scenes parsed from scenePlanMarkdown');

      const totalSec = timeToSeconds(scenes[scenes.length - 1].end);
      const isLong   = scenes.length > 7 || totalSec > 60;

      // ── IN-PLACE UPDATE path (repair mode or dedup) ──────────────────────
      if (existingPlanIds.has(plan.planId)) {
        const existingRows = aqObjects
          .map((r, i) => ({ ...r, _rowIdx: i }))
          .filter(r => r.planId === plan.planId)
          .sort((a, b) => Number(a.sceneNumber) - Number(b.sceneNumber));

        const allData = [];
        for (const er of existingRows) {
          const sceneIdx = Number(er.sceneNumber) - 1;
          const scene    = scenes[sceneIdx];
          if (!scene) continue;

          const fields = {
            ...buildSceneFields(scene, sceneIdx, plan, now, isLong),
            transition: inferTransition(scene.body, sceneIdx < scenes.length - 1),
          };
          const sheetRow = er._rowIdx + 2;
          for (const [col, val] of Object.entries(fields)) {
            const ci = aqHeaders.indexOf(col);
            if (ci < 0) continue;
            allData.push({ range: `'${ASSET_QUEUE_TAB}'!${colLetter(ci)}${sheetRow}`, values: [[String(val ?? '')]] });
          }
        }
        if (allData.length > 0) {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { valueInputOption: 'RAW', data: allData },
          });
        }
        summary.plans_processed++;
        summary.scenes_created += existingRows.length;
        logEntries.push({
          level: 'INFO',
          message: REPAIR_PLAN_ID ? 'asset queue repaired in-place' : 'asset queue updated in-place',
          sourceName: plan.planId,
          details: `scenes_updated:${existingRows.length}`,
        });
        console.error(`Updated ${plan.planId} → ${existingRows.length} rows in-place`);
        await updateCells(sheets, VISUAL_PLANS_TAB, vpHeaders, plan._rowIdx, { expansionStatus: 'expanded', expandedAt: now });
        continue;
      }

      // ── APPEND path (new plan, not yet in Asset Queue) ───────────────────
      const assetRows = scenes.map((scene, idx) => {
        const fields = {
          assetPlanId:  `${plan.planId}-SCENE-${String(idx + 1).padStart(2, '0')}`,
          planId:       plan.planId,
          scriptId:     plan.scriptId,
          clusterName:  plan.clusterName || '',
          createdAt:    now,
          sceneNumber:  idx + 1,
          sceneStart:   scene.start,
          sceneEnd:     scene.end,
          sceneDuration: scene.duration,
          ...buildSceneFields(scene, idx, plan, now, isLong),
          transition:   inferTransition(scene.body, idx < scenes.length - 1),
          assetFileName:    '',
          assetLocation:    '',
          assetGeneratedAt: '',
        };
        return ASSET_QUEUE_COLUMNS.map(col => String(fields[col] ?? ''));
      });

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `'${ASSET_QUEUE_TAB}'!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: assetRows },
      });

      summary.plans_processed++;
      summary.scenes_created += scenes.length;
      existingPlanIds.add(plan.planId);

      await updateCells(sheets, VISUAL_PLANS_TAB, vpHeaders, plan._rowIdx, {
        expansionStatus: 'expanded',
        expandedAt: now,
      });
      logEntries.push({
        level: 'INFO',
        message: 'expand-to-asset-queue: plan expanded',
        sourceName: plan.planId,
        details: `scenes:${scenes.length} scriptId:${plan.scriptId}`,
      });
      console.error(`Expanded ${plan.planId} → ${scenes.length} scenes`);

    } catch (err) {
      summary.failed++;
      console.error(`Failed ${plan.planId}: ${err.message}`);
      logEntries.push({
        level: 'ERROR',
        message: 'expand-to-asset-queue: expansion failed',
        sourceName: plan.planId,
        details: err.message,
      });
      try {
        await updateCells(sheets, VISUAL_PLANS_TAB, vpHeaders, plan._rowIdx, { expansionStatus: 'expansion_failed' });
      } catch (_) { /* best-effort */ }
    }
  }

  logEntries.push({
    level: 'INFO',
    message: 'expand-to-asset-queue: run complete',
    details: `plans_processed:${summary.plans_processed} scenes_created:${summary.scenes_created} skipped:${summary.skipped} failed:${summary.failed}`,
  });
  await appendLog(sheets, logEntries);
  process.stdout.write(JSON.stringify(summary));
}

main().catch(e => { console.error(e.message); process.exit(1); });
