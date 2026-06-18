'use strict';
const fs = require('fs');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs';
const NOW = new Date().toISOString();

function loadAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const json = raw || Buffer.from(b64, 'base64').toString('utf8');
  const creds = JSON.parse(json);
  return new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}

const BOILERPLATE_TITLES = new Set([
  'Home 2','Home 3','Home 5','Personal Details','CONTACT US','ABOUT US','Languages','Countries',
  'Projects','News','Publications','Projects Abroad','Courses','Courses abroad','Overseas Activities',
  'Photo Galleries','Video Galleries','Digital library','Plenaries',
  'Home | Ministry of Foreign Affairs','Home | English','Home | 4IL Community',
  'Ready Archives - Page 2508 of 2508','Lebanon War Archives','World Cup 2026 Archives',
  'Buzzy Gordon Archives','MEMRI Newsletter','JTTM','Cyber & Jihad Lab',
  'Contact Us / Request a Clip','www.israelhayom.com','- www.israelhayom.com',
  'Israel News | Israel Hayom - www.israelhayom.com','Israel News | Israel National News',
  'News Briefs','Opeds','MCTC Annual Reports 2023/24','Untitled',
  'Home | MASHAV INTERNATIONAL AGRICULTURAL TRAINING CENTER',
  'Home | The Golda Meir Mashav-Carmel International Training Center',
  'Home | Prime Minister\'s Office',
  'About Prime Minister\'s Office','Public Affairs Department | Prime Minister\'s Office',
  'National Economic Council','Director General of the Prime Minister\'s Office',
  'Apply for a position in the Prime Minister\'s Office security and emergency department',
  '1997 Hebron Protocol, News And Latest Headlines',
  'The 32th Government Prime Minister\'s Office','The 30th Government Prime Minister\'s Office',
  'The 27th Government Prime Minister\'s Office','The Government Prime Minister\'s Office',
  'Former Prime Ministers','Prime Ministers of the State of Israel Ministry of Foreign Affairs',
  'Benjamin Netanyahu - Curriculum Vitae 2009- Present Prime Minister 2005-2009 Chairman of Likud, Leader of the Opposition',
  'Ariel Sharon Prime Minister\'s Office','Ehud Barak Prime Minister\'s Office',
  'MEMRI TV Clips: Hamas & Muslim Brotherhood LInked MAB Director',
  'UKRAINE','Georgia','Africa','Central Europe and Eurasia',
  'Annual Report 2024','ANNUAL REPORT','Impact Magazine','Toolbox Item 4',
  'Poster Exhibition','Say Shalom','MCTC STAFF',
]);
const BOILERPLATE_RE = [
  /^Home \d/, /^Personal Details/, /^www\./, /^- www\./,
  /^MEMRI TV YouTube/, /^MEMRI Videos Have Had/, /^Fight Extremism/,
  /^Religious Days Of Vengeance/, /^MEMRI Welcomes/, /^Visit The New MEMRI/,
  /^\s*$/, /^Prime Minister's Office$/, /^Prime Minister$/,
];

function isBoilerplate(item) {
  if (BOILERPLATE_TITLES.has(item.title)) return true;
  return BOILERPLATE_RE.some(p => p.test(item.title));
}

// Cluster definitions: name, theme, and keyword matcher
const CLUSTER_DEFS = [
  {
    name: 'Iran nuclear deal and US-Iran negotiations',
    theme: 'Iran diplomacy',
    match: (t, e) => /iran.*(deal|negotiat|nuclear|agreement|MOU|ceasefire.*iran|hormuz.*deal|concession|appease|Tehran.*sign|sign.*deal|diplomacy.*iran)/i.test(t+e)
      || /us.*iran.*(talk|deal|negotiat)/i.test(t+e)
      || /iran.*nuclear.*issue/i.test(t+e)
      || /(300.*billion.*fund.*iran|iran.*fund)/i.test(t+e)
      || /rescue.*iran|iran.*rescue/i.test(t+e)
      || /kingdom for a deal/i.test(t)
      || /messianic.*deal|deal.*messianic/i.test(t+e)
      || /reza pahlavi.*deal|deal.*reza pahlavi/i.test(t+e)
      || /iran.*oil.*strait|strait.*iran.*oil/i.test(t+e)
      || /tehran.*signals.*time|time.*signing/i.test(t+e)
      || /gulf states divided.*iran/i.test(t+e)
      || /qatari.*pm.*gulf.*war|qatari.*miscalculation/i.test(t+e)
  },
  {
    name: 'Iran missile strikes on Israel and IDF counter-strikes',
    theme: 'Iran-Israel military conflict',
    match: (t, e) => /iran.*(launch|strike|attack|missile|bomb|cluster munition|fire at israel)/i.test(t+e)
      || /idf.*(hit|strike|eliminat).*(iran|nuclear facility)/i.test(t+e)
      || /(blow to iran|iran.*nuke|nuclear facility.*hit)/i.test(t+e)
      || /iran.*84 violations|84 violations.*iran/i.test(t+e)
      || /iranian.*parliament.*response|severe response.*iran/i.test(t+e)
      || /iran.*attack.*israel|israel.*attack.*iran/i.test(t+e)
      || /minister katz.*iran.*operation|iran operation moved/i.test(t+e)
      || /home front.*(guideline|command)/i.test(t+e)
      || /ben gurion airport.*escalat|airport.*escalat/i.test(t+e)
      || /ramat david.*iran/i.test(t+e)
      || /iran.*deterrence doctrine/i.test(t+e)
      || /iran.*strikes.*israel|iran strikes israel/i.test(t+e)
      || /bennett slams netanyahu.*iran/i.test(t+e)
      || /overthrow.*iranian regime|iranian regime.*thwart/i.test(t+e)
      || /interceptor.*malfunction|malfunction.*intercept/i.test(t+e)
      || /idf prepares.*fire.*iran|fire.*iran.*israel/i.test(t+e)
      || /escalation.*(iran|israel)|iran.*escalat/i.test(t+e)
      || /everything in iran.*ended/i.test(t+e)
      || /cabinet.*iran.*(response|debate)|iran.*response.*cabinet/i.test(t+e)
      || /netanyahu.*iran.*eyes open/i.test(t+e)
      || /iranian.*embassies.*sacrifice/i.test(t+e)
  },
  {
    name: 'Israel-Lebanon ceasefire and Hezbollah activity',
    theme: 'Lebanon ceasefire / Hezbollah',
    match: (t, e) => /israel.*lebanon ceasefire|lebanon.*ceasefire/i.test(t+e)
      || /hezbollah.*(attack|kill|drone|tunnel|war|casualt|armed|conquer)/i.test(t+e)
      || /beaufort ridge/i.test(t)
      || /lebanon.*ceasefire|ceasefire.*lebanon/i.test(t+e)
      || /un personnel killed.*(hezbollah|lebanon)/i.test(t+e)
      || /idf.*lebanon.*ceasefire|ceasefire.*hold/i.test(t+e)
      || /northern.*front|israel.*(northern front|north)/i.test(t+e)
      || /infiltration.*lebanon|lebanon.*infiltrat/i.test(t+e)
      || /withdraw.*lebanon|lebanon.*withdraw/i.test(t+e)
      || /visuals israel.hezbollah|israel.hezbollah war/i.test(t+e)
      || /ambassador leiter.*lebanon/i.test(t+e)
      || /hezbollah pushed.*iran.*brink|brink.*hezbollah/i.test(t+e)
      || /egypt.*israel.lebanon.*talks|egypt.*limited.*security talks/i.test(t+e)
      || /netanyahu.*message.*lebanese|lebanese.*netanyahu/i.test(t+e)
      || /netanyahu.*security equation.*iran.*hezbollah/i.test(t+e)
      || /US evacuates.*lebanon|aircraft carrier.*crete/i.test(t+e)
      || /hezbollah.*casualties.*ignored|hezbollah.*(drone|killed soldier)/i.test(t+e)
      || /sergeant.*killed.*drone|noam hamburger|nehoray leizer|ayal uriel bianco/i.test(t+e)
      || /joint statement.*netanyahu.*katz.*june 7/i.test(t+e)
  },
  {
    name: 'Gaza operations and Hamas targeted eliminations',
    theme: 'Gaza / Hamas',
    match: (t, e) => /gaza.*operation|operation.*gaza/i.test(t+e)
      || /hamas.*(eliminat|kill|leader|commander|official|military)/i.test(t+e)
      || /idf eliminat.*(hamas|islamic jihad|nukhba)/i.test(t+e)
      || /mohammad odeh|nukhba.*commander/i.test(t+e)
      || /israel.*strike.*hamas|hamas.*strike/i.test(t+e)
      || /gazacrossings|gaza crossings|humanitarian aid.*halt|halt.*humanitarian/i.test(t+e)
      || /security cabinet.*war/i.test(t+e)
      || /hamas.*executions.*gaza|hamas.*isis/i.test(t+e)
      || /hamas.*caliphate|hamas official/i.test(t+e)
      || /living under hamas|dark realities.*hamas/i.test(t+e)
      || /hamas.*prevent.*aid/i.test(t+e)
      || /hamas.*oct.* 7|oct.*7.*hamas/i.test(t+e)
      || /hamas.*conference.*liberation.*palestine/i.test(t+e)
      || /trump.*gaza ceasefire.*effect|gaza ceasefire.*trump/i.test(t+e)
  },
  {
    name: 'Mossad leadership transition and Iran regime change strategy',
    theme: 'Israeli intelligence / Mossad',
    match: (t, e) => /mossad.*(chief|director|head|command|appointment|change of command|barnea|gofman)/i.test(t+e)
      || /roman gofman|david barnea/i.test(t+e)
      || /mossad.*announcement.*change of command/i.test(t+e)
      || /mossad.*cia.*kurd|kurd.*mossad.*cia/i.test(t+e)
      || /kurd.*militia.*topple.*iran|topple.*iranian.*kurd/i.test(t+e)
      || /hussein yazdanpana|yazdanpana/i.test(t+e)
      || /extremist regime.*replaced|campaign.*completed.*regime/i.test(t+e)
  },
  {
    name: 'US-Israel relations and Trump-Netanyahu diplomacy',
    theme: 'US-Israel diplomacy',
    match: (t, e) => /trump.*(netanyahu|israel|deal.*iran|fox news.*deal)/i.test(t+e)
      || /netanyahu.*(trump|white house|washington)/i.test(t+e)
      || /huckabee.*(israel|america)/i.test(t+e)
      || /sen\.? graham.*israel|graham.*trump.*israel/i.test(t+e)
      || /netanyahu.*will do whatever.*trump|trump.*netanyahu.*want/i.test(t+e)
      || /us envoy.*israel.*heritage/i.test(t+e)
      || /witkoff.*netanyahu|netanyahu.*witkoff/i.test(t+e)
      || /israel.*spying.*us|us.*israel.*spy|israel.*targeted.*witkoff|nyt.*israel.*spy/i.test(t+e)
      || /espionage.*israel|israel.*espionage/i.test(t+e)
      || /anonymous sources.*espionage|viral claims.*espionage/i.test(t+e)
  },
  {
    name: 'Antisemitism and anti-Israel actions in Western countries',
    theme: 'Antisemitism / diaspora',
    match: (t, e) => /antisemit/i.test(t+e)
      || /hatzolah.*torch|arson.*london|golders green/i.test(t+e)
      || /jews eat children|subway.*attack.*jew/i.test(t+e)
      || /un envoy.*germany.*holocaust|un envoy.*mocks.*holocaust/i.test(t+e)
      || /un envoy.*mother.*oct.*7|mocks.*mother/i.test(t+e)
      || /barghouti.*statue|statue.*terrorist/i.test(t+e)
      || /london.*synagogue.*protest|anti.israel.*synagogue/i.test(t+e)
      || /emoji guide.*antisemitism/i.test(t+e)
      || /danon.*hostage.*pin.*ceremony/i.test(t+e)
  },
  {
    name: 'Israel diplomatic tensions with Europe and ICC',
    theme: 'Israel international standing',
    match: (t, e) => /netherlands.*security threat|security threat.*netherlands/i.test(t+e)
      || /slovenia.*(israir|embassy|bar)/i.test(t+e)
      || /eu.*israel.*death penalty|death penalty.*eu/i.test(t+e)
      || /italy.*ben.gvir.*flotilla|ben.gvir.*italy/i.test(t+e)
      || /icc.*(suspend|chief|prosecutor|khan)/i.test(t+e)
      || /icc.*(israel|genocide)|israel.*icc/i.test(t+e)
      || /romanian.*presidential|romanian.*minister/i.test(t+e)
      || /tommy robinson.*arrest/i.test(t+e)
  },
  {
    name: 'West Bank security operations and settler-Palestinian tensions',
    theme: 'West Bank / Judea and Samaria',
    match: (t, e) => /hebron.*(operation|terror|attack|infant|investigat)/i.test(t+e)
      || /huwara|west bank.*settler|settler.*west bank/i.test(t+e)
      || /knesset.*sovereignty.*judea.*samaria|sovereignty.*judea/i.test(t+e)
      || /joseph.*tomb|samaria.*(community|water|development)/i.test(t+e)
      || /counterterror.*hebron|large.*scale.*operation.*hebron/i.test(t+e)
      || /suspect.*breach.*checkpoint/i.test(t+e)
      || /terror attack.*central israel|master sergeant.*killed.*terror/i.test(t+e)
      || /idf.*police.*investigat.*infant.*hebron/i.test(t+e)
  },
  {
    name: 'Israeli domestic politics and Knesset',
    theme: 'Israeli domestic politics',
    match: (t, e) => /knesset.*(dissolution|committee|bill|approves|session|77 years)/i.test(t+e)
      || /minister.*heart attack|dudi amsalem/i.test(t+e)
      || /cadets.*dismissed.*elite.*unit|national.religious.*cadet/i.test(t+e)
      || /israelis.*terminate.*residency/i.test(t+e)
      || /smotrich.*isaac accords|isaac accords/i.test(t+e)
      || /cabinet.*iran.*(response|debate)/i.test(t+e)
      || /ministers clash.*cabinet|ben gvir.*betrayed/i.test(t+e)
      || /bennett.*clock.*regime change.*government.*israel.*changed/i.test(t+e)
      || /rabbi.*law.*torah.*moses/i.test(t+e)
      || /chief of staff.*moshiach.*patch/i.test(t+e)
      || /death penalty bill.*knesset|knesset.*death penalty/i.test(t+e)
      || /pro.israel trump pick.*concern/i.test(t+e)
  },
  {
    name: 'Media bias and anti-Israel narrative framing',
    theme: 'Media analysis / information war',
    match: (t, e) => /honestreporing|cnn.*anti.israel|drop site.*hamas|drop site.*sanitize/i.test(t+e)
      || /flotilla.*outrage.*stopped|flotilla.*media/i.test(t+e)
      || /media.*(framed|terror|west bank)/i.test(t+e)
      || /weak reporting.*narrative/i.test(t+e)
      || /hezbollah.*casualties.*ignored/i.test(t+e)
      || /samidoun.*designation/i.test(t+e)
      || /al.jazeera.*propaganda.*iran/i.test(t+e)
      || /qatari.*media.*propaganda|propaganda.*iran.*qatar/i.test(t+e)
      || /nyc.*mayoral.*zohran.*dsa|zohran mamdani/i.test(t+e)
      || /islamic movement about to collapse|palestinian movement.*collapse/i.test(t+e)
      || /cair.*executive.*october 7/i.test(t+e)
  },
  {
    name: 'Strait of Hormuz and US naval blockade of Iran',
    theme: 'Strait of Hormuz / regional military',
    match: (t, e) => /hormuz|strait.*iran|iran.*strait/i.test(t+e)
      || /three tankers.*strike|tanker.*india/i.test(t+e)
      || /apache.*helicopter.*hormuz/i.test(t+e)
      || /us.*forces.*shot down.*iranian.*drone/i.test(t+e)
      || /iran.*sell.*oil.*strait/i.test(t+e)
  },
  {
    name: 'IHRA presidency and Holocaust remembrance',
    theme: 'IHRA / Holocaust remembrance',
    match: (t, e) => /ihra/i.test(t+e)
      || /holocaust.*remembrance|yom hashoah|holocaust.*ceremony/i.test(t+e)
      || /survivors.*declaration|declaration.*survivors/i.test(t+e)
      || /pontian greek genocide|türkish crime|turkish crime/i.test(t+e)
      || /foreign ministers.*antisemitism/i.test(t+e)
  },
  {
    name: 'Islamic extremism and jihadist threats (MEMRI)',
    theme: 'Jihadist extremism',
    match: (t, e) => /isis.*(weekly|spokesman|attack|jihad|kill christian|eid)/i.test(t+e)
      || /islamic state.*(spokesman|calls for attack|glorif|predict|eid)/i.test(t+e)
      || /iums.*fatwa.*jihad|jihad.*duty.*muslims|armed jihad.*israel.*duty/i.test(t+e)
      || /neo.nazi.*(telegram|ai|accelerationist)/i.test(t+e)
      || /texas islamic conference.*islam rule|islam.*rule.*world.*america/i.test(t+e)
      || /taliban|jihadist|salafi/i.test(t+e)
      || /terrorgram.*neo.nazi/i.test(t+e)
      || /islamization.*syria.*al.sharaa/i.test(t+e)
      || /iskp.*monero|iskp.*solicit/i.test(t+e)
      || /american communist.*death to america.*iran/i.test(t+e)
      || /posters.*pro.islamic state.*threaten.*holiday/i.test(t+e)
      || /12 christians.*sudan.*drone/i.test(t+e)
      || /jihadi drones.*isis.*hamas/i.test(t+e)
      || /hamas.*promise of the hereafter|liberation.*palestine.*disappearance.*israel/i.test(t+e)
  },
  {
    name: 'Iran regime and regional Islamist networks',
    theme: 'Iran regional influence / Islamism',
    match: (t, e) => /iran.*messianic|iran.*leadership.*messianic/i.test(t+e)
      || /iranian.*regime.*threatens|iran.*threaten.*washington|iran.*deter.*trump/i.test(t+e)
      || /support iran.*islamic revolution/i.test(t+e)
      || /afghan.*scholar.*palestine.*unif/i.test(t+e)
      || /mrs.*muslim brotherhood|sheikha moza.*islamist/i.test(t+e)
      || /muslim brotherhood.*(oust|online campaign|egypt|sisi)/i.test(t+e)
      || /turkey.*islamic nato|islamic nato.*turkey/i.test(t+e)
      || /iranian.*regime.*convinced.*threatens.*trump/i.test(t+e)
      || /egypt.*military exercise.*deterrence.*israel/i.test(t+e)
      || /iranian majlis.*speaker/i.test(t+e)
      || /former qatari.*pm.*iran.*miscalculation/i.test(t+e)
      || /people.*fighters.*front.*sunni.*iran/i.test(t+e)
  },
];

async function readRawNewsWithRowNums() {
  const auth = loadAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Raw News'!A:L",
  });
  const rows = res.data.values || [];
  const headers = rows[0];
  const statusIdx = headers.indexOf('status');
  return { rows, headers, statusIdx };
}

async function ensureStoryClustersTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = new Set(meta.data.sheets.map(s => s.properties.title));
  if (!existing.has('Story Clusters')) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: 'Story Clusters' } } }] },
    });
    const clusterHeaders = ['clusterName','theme','itemCount','sources','urls','rawItems','createdAt','status','riskLevel','productionReadiness'];
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: "'Story Clusters'!A1",
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [clusterHeaders] },
    });
    console.log('Created Story Clusters tab');
  }
}

async function main() {
  const items = JSON.parse(fs.readFileSync('/tmp/unclustered-items.json', 'utf8'));
  const substantive = items.filter(i => !isBoilerplate(i));
  console.log(`Processing ${substantive.length} substantive items out of ${items.length} total`);

  // Assign each item to a cluster
  const clusterMap = {};
  CLUSTER_DEFS.forEach(cd => { clusterMap[cd.name] = { ...cd, items: [] }; });
  const unclustered = [];

  for (const item of substantive) {
    const text = (item.title || '') + ' ' + (item.excerpt || '');
    let assigned = false;
    for (const cd of CLUSTER_DEFS) {
      if (cd.match(item.title || '', item.excerpt || '')) {
        clusterMap[cd.name].items.push(item);
        assigned = true;
        break;
      }
    }
    if (!assigned) unclustered.push(item);
  }

  // Report
  for (const [name, cd] of Object.entries(clusterMap)) {
    if (cd.items.length > 0) console.log(`  [${cd.items.length}] ${name}`);
  }
  console.log(`  [${unclustered.length}] UNCLUSTERED`);
  unclustered.slice(0, 20).forEach(i => console.log('    unmatched:', i.sourceName, '|', i.title));

  // Write output for review
  fs.writeFileSync('/tmp/clusters-preview.json', JSON.stringify(
    Object.values(clusterMap).filter(c => c.items.length > 0).map(c => ({
      name: c.name, theme: c.theme, count: c.items.length,
      titles: c.items.map(i => `[${i.sourceName}] ${i.title}`)
    })), null, 2
  ));
  fs.writeFileSync('/tmp/unclustered-remaining.json', JSON.stringify(unclustered.map(i => ({
    sourceName: i.sourceName, title: i.title, url: i.url
  })), null, 2));
  console.log('Previews written to /tmp/clusters-preview.json and /tmp/unclustered-remaining.json');
}

main().catch(e => { console.error(e.message); process.exit(1); });
