'use strict';
const fs = require('fs');
const { google } = require('googleapis');

const SPREADSHEET_ID = '1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs';
const NOW = new Date().toISOString();

function loadAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const json = raw || Buffer.from(b64, 'base64').toString('utf8');
  return new google.auth.GoogleAuth({ credentials: JSON.parse(json), scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
}

// Items that are navigation/boilerplate pages — not real news
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
  'About Prime Minister\'s Office','Public Affairs Department | Prime Minister\'s Office',
  'National Economic Council','Director General of the Prime Minister\'s Office',
  'Apply for a position in the Prime Minister\'s Office security and emergency department',
  '1997 Hebron Protocol, News And Latest Headlines',
  'The 32th Government Prime Minister\'s Office','The 30th Government Prime Minister\'s Office',
  'The 27th Government Prime Minister\'s Office','The Government Prime Minister\'s Office',
  'Former Prime Ministers','Prime Ministers of the State of Israel Ministry of Foreign Affairs',
  'Ariel Sharon Prime Minister\'s Office','Ehud Barak Prime Minister\'s Office',
  'UKRAINE','Georgia','Africa','Central Europe and Eurasia',
  'ANNUAL REPORT','Impact Magazine','Toolbox Item 4','Poster Exhibition','Say Shalom','MCTC STAFF',
  'Lebanon News & Analysis Research Archive','A Picture Of Victory','Menahem Milson',
  'MEMRI TV Clips: Hamas & Muslim Brotherhood LInked MAB Director',
  'Sami Hamdi\'s Father: Don\'t Judge Him Based on One Video',
  'As MEMRI Marks 30 Years, Exciting Changes Ahead',
  'Special Announcement: MEMRI Welcomes Himdad Mustafa As Special Advisor To Kurdish Studies Project',
  'MEMRI Founder And President Yigal Carmon In Interview', // partial
]);
const BOILERPLATE_RE = [
  /^Home \d/, /^Personal Details/, /^www\./, /^- www\./,
  /^MEMRI TV YouTube/, /^MEMRI Videos Have Had/, /^Fight Extremism/,
  /^Religious Days Of Vengeance/, /^MEMRI Welcomes.*Ret\./,
  /^\s*$/, /^WATCH \| IDF$/, /^French Content \| IDF$/,
  /^MEMRI Welcomes Ret\./, /^Visit The New MEMRI/, /^MEMRI Founder.*Interview/,
];

function isBoilerplate(item) {
  if (BOILERPLATE_TITLES.has(item.title)) return true;
  // Partial title match for long boilerplate
  if (item.title.startsWith('Benjamin Netanyahu - Curriculum Vitae')) return true;
  if (item.title.startsWith('MEMRI Founder And President Yigal Carmon In Interview')) return true;
  return BOILERPLATE_RE.some(p => p.test(item.title));
}

// Cluster definitions — ordered by priority (first match wins)
const CLUSTER_DEFS = [
  {
    name: 'Iran nuclear deal and US-Iran negotiations',
    theme: 'Iran diplomacy',
    match: (t, e) =>
      /iran.*(deal|negotiat|nuclear|agreement|MOU|concession|appease)/i.test(t+e)
      || /us.*iran.*(talk|deal|negotiat)/i.test(t+e)
      || /(300.*billion.*iran|iran.*fund.*deal)/i.test(t+e)
      || /rescue.*iran|iran.*rescue/i.test(t+e)
      || /kingdom for a deal/i.test(t)
      || /reza pahlavi.*deal/i.test(t+e)
      || /iran.*oil.*strait.*reopen|strait.*reopen.*iran/i.test(t+e)
      || /tehran.*signals.*time.*sign/i.test(t+e)
      || /gulf states divided.*iran.*ceasefire/i.test(t+e)
      || /qatari.*pm.*miscalculation.*gulf/i.test(t+e)
      || /danon accuses iran.*systemic/i.test(t+e)
      || /iran.*signing|signing.*deal.*iran/i.test(t+e)
      || /no choice but diplomacy/i.test(t+e)
  },
  {
    name: 'Iran missile strikes on Israel and IDF counter-strikes',
    theme: 'Iran-Israel military conflict',
    match: (t, e) =>
      /iran.*(launch|fired|cluster munition|ballistic missile.*israel)/i.test(t+e)
      || /idf.*(hit|strike|eliminat).*(iran|nuclear facility)/i.test(t+e)
      || /(blow to iran.*nuke|nuclear facility.*idf|idf.*nuclear)/i.test(t+e)
      || /iran.*84 violations|84 violations/i.test(t+e)
      || /severe response.*coming.*iran|iranian.*parliament.*response/i.test(t+e)
      || /minister katz.*iran.*operation|iran operation moved/i.test(t+e)
      || /home front.*(guideline|command|defense.*hermetic)/i.test(t+e)
      || /ben gurion airport.*escalat/i.test(t+e)
      || /ramat david.*iran/i.test(t+e)
      || /iran.*deterrence doctrine/i.test(t+e)
      || /iran.*strikes.*israel|bennett slams netanyahu.*iran/i.test(t+e)
      || /overthrow.*iranian regime.*thwart|opportunity.*topple.*thwart/i.test(t+e)
      || /interceptor.*malfunction.*airport/i.test(t+e)
      || /idf prepares.*fire.*iran|preparing.*fire.*iran/i.test(t+e)
      || /everything in iran.*except/i.test(t+e)
      || /cabinet.*iran.*(response|debate)|ministers clash.*iran/i.test(t+e)
      || /netanyahu.*iran.*eyes open/i.test(t+e)
      || /iranian.*embassies recruit.*sacrifice/i.test(t+e)
      || /iran continues launching.*ballistic/i.test(t+e)
      || /satellite imagery.*damage.*iran/i.test(t+e)
      || /wizz air.*israel.*escalat/i.test(t+e)
      || /closed.*crossings.*iranian.*missile/i.test(t+e)
  },
  {
    name: 'Israel-Lebanon ceasefire and Hezbollah',
    theme: 'Lebanon ceasefire / Hezbollah',
    match: (t, e) =>
      /israel.*lebanon ceasefire|lebanon.*ceasefire/i.test(t+e)
      || /hezbollah.*(attack|kill|drone|tunnel|war|casualt|armed|conquer)/i.test(t+e)
      || /beaufort ridge/i.test(t)
      || /un personnel killed.*(hezbollah|lebanon)/i.test(t+e)
      || /northern.*front.*idf|idf.*northern front/i.test(t+e)
      || /infiltration.*lebanon|northern residents.*terrorist.*lebanon/i.test(t+e)
      || /israel.*withdraw.*lebanon|withdraw.*lebanon/i.test(t+e)
      || /visuals israel.hezbollah|israel.hezbollah war/i.test(t+e)
      || /ambassador leiter.*lebanon/i.test(t+e)
      || /hezbollah pushed.*iran.*brink/i.test(t+e)
      || /egypt.*israel.lebanon.*talks.*hizbullah armed/i.test(t+e)
      || /netanyahu.*message.*lebanese people/i.test(t+e)
      || /netanyahu.*rejects.*security equation.*iran.*hezbollah/i.test(t+e)
      || /US evacuates.*lebanon|aircraft carrier gerald ford/i.test(t+e)
      || /hezbollah.*casualties.*ignored/i.test(t+e)
      || /noam hamburger|nehoray leizer|ayal uriel bianco/i.test(t+e)
      || /joint statement.*netanyahu.*katz.*june 7/i.test(t+e)
      || /ceasefire.*hold|lets see.*ceasefire/i.test(t+e)
      || /hizbullah.*2023 drill.*simulated.*israel/i.test(t+e)
      || /saudi arabia lifts.*ban.*lebanese/i.test(t+e)
      || /journalist.*appears.*lebanese network/i.test(t+e)
      || /key clauses.*lebanon ceasefire/i.test(t+e)
  },
  {
    name: 'Gaza operations and Hamas',
    theme: 'Gaza / Hamas',
    match: (t, e) =>
      /hamas.*(eliminat|kill|leader|commander|official|military|executions|prevents.*aid)/i.test(t+e)
      || /idf eliminat.*(hamas|islamic jihad|nukhba)/i.test(t+e)
      || /mohammad odeh|nukhba.*commander/i.test(t+e)
      || /israel.*strike.*hamas|air strike.*hamas/i.test(t+e)
      || /gaza.*crossings.*closed|halt.*humanitarian.*iran/i.test(t+e)
      || /security cabinet.*war.*situation/i.test(t+e)
      || /hamas.*caliphate|hamas official.*victim/i.test(t+e)
      || /living under hamas|dark realities.*hamas/i.test(t+e)
      || /hamas.*prevent.*aid.*centers/i.test(t+e)
      || /hamas.*promise of the hereafter|liberation.*palestine.*disappearance.*israel/i.test(t+e)
      || /trump.*gaza ceasefire.*effect/i.test(t+e)
      || /voices.*condemn hamas.*executions.*isis/i.test(t+e)
      || /idf eliminat.*islamic jihad.*hamas.*commanders/i.test(t+e)
      || /first hostages return home/i.test(t)
  },
  {
    name: 'Mossad leadership transition and Iran regime change strategy',
    theme: 'Israeli intelligence / Mossad',
    match: (t, e) =>
      /mossad.*(chief|director|head|command|appointment|barnea|gofman|change of command)/i.test(t+e)
      || /roman gofman|david barnea/i.test(t+e)
      || /mossad.*cia.*kurd.*iran|kurd.*militia.*topple.*iran/i.test(t+e)
      || /hussein yazdanpana/i.test(t+e)
      || /extremist regime.*replaced|campaign.*completed.*regime.*replaced/i.test(t+e)
      || /mossad.*announcement.*command/i.test(t+e)
      || /foundations.*terrorist regime.*iran.*cracked/i.test(t+e)
  },
  {
    name: 'US-Israel relations and Trump-Netanyahu diplomacy',
    theme: 'US-Israel diplomacy',
    match: (t, e) =>
      /trump.*(netanyahu|fox news.*deal.*hours)/i.test(t+e)
      || /netanyahu.*(trump|white house|welcomed.*trump)/i.test(t+e)
      || /huckabee.*(israel|america)/i.test(t+e)
      || /sen\.? graham.*israel|graham.*trump.*israel|graham.*message.*trump/i.test(t+e)
      || /netanyahu.*will do whatever.*trump|trump.*netanyahu.*want/i.test(t+e)
      || /us envoy.*israel.*heritage|envoy.*america.*founding/i.test(t+e)
      || /witkoff.*netanyahu|netanyahu.*witkoff/i.test(t+e)
      || /nyt.*israel.*targeted.*witkoff|israel.*spying.*pentagon/i.test(t+e)
      || /anonymous sources.*espionage.*israel|viral claims.*espionage/i.test(t+e)
      || /israel.*conflict.*trump|no choice.*risk.*open conflict.*trump/i.test(t+e)
  },
  {
    name: 'IDF military capabilities and operations briefings',
    theme: 'IDF military operations',
    match: (t, e) =>
      /kc.46|pegasus.*tanker|refueling aircraft|gideon.*aircraft/i.test(t+e)
      || /idf.*press briefing|press briefing.*idf spokesperson/i.test(t+e)
      || /operation.*arnon|background.*operation.*arnon/i.test(t+e)
      || /3 soldiers.*3 faiths|soldiers.*faiths.*purpose/i.test(t+e)
      || /israel.*air superiority/i.test(t+e)
      || /women.*female soldier.*elite.*unit/i.test(t+e)
      || /military.*police.*investigation.*killing.*infant.*hebron/i.test(t+e)
  },
  {
    name: 'Antisemitism and anti-Israel actions in Western countries',
    theme: 'Antisemitism / diaspora',
    match: (t, e) =>
      /antisemit/i.test(t+e)
      || /hatzolah.*torch|arson.*london.*golders/i.test(t+e)
      || /jews eat children|subway.*attack.*jew/i.test(t+e)
      || /un envoy.*germany.*holocaust|forget.*holocaust/i.test(t+e)
      || /un envoy.*mocks.*mother.*oct.*7/i.test(t+e)
      || /barghouti.*statue|statue.*terrorist.*london/i.test(t+e)
      || /london.*synagogue.*protest|anti.israel.*synagogue/i.test(t+e)
      || /emoji guide.*antisemitism/i.test(t+e)
      || /danon.*hostage.*pin.*holocaust.*ceremony/i.test(t+e)
  },
  {
    name: 'Israel diplomatic tensions with Europe and ICC',
    theme: 'Israel international standing',
    match: (t, e) =>
      /netherlands.*security threat/i.test(t+e)
      || /slovenia.*(israir|bar.*flight)|eu.*open.skies/i.test(t+e)
      || /eu.*israel.*death penalty|death penalty.*eu.*double standards/i.test(t+e)
      || /italy.*ben.gvir.*flotilla/i.test(t+e)
      || /icc.*(suspend|chief.*prosecutor|karim khan)/i.test(t+e)
      || /tommy robinson.*arrest.*counterterrorism/i.test(t+e)
      || /israeli ministers slam.*romanian/i.test(t+e)
  },
  {
    name: 'West Bank security operations and settler-Palestinian tensions',
    theme: 'West Bank / Judea and Samaria',
    match: (t, e) =>
      /hebron.*(operation|terror|attack|investigation)/i.test(t+e)
      || /huwara.*settler|settler.*huwara/i.test(t+e)
      || /knesset.*sovereignty.*judea|sovereignty.*judea.*samaria/i.test(t+e)
      || /joseph.*tomb.*daylight/i.test(t+e)
      || /large.scale.*counterterrorism.*hebron/i.test(t+e)
      || /checkpoint.*suspect.*shot/i.test(t+e)
      || /master sergeant.*killed.*terror.*central israel/i.test(t+e)
      || /military.*police.*infant.*hebron/i.test(t+e)
      || /near the west bank.*media.*framed/i.test(t+e)
      || /egypt.*diploma.*suicide bombing.*israel/i.test(t+e)
  },
  {
    name: 'Israeli domestic politics and Knesset',
    theme: 'Israeli domestic politics',
    match: (t, e) =>
      /knesset.*(dissolution|committee|approves.*bill|session.*77 years)/i.test(t+e)
      || /dudi amsalem.*heart attack/i.test(t+e)
      || /cadets.*dismissed.*elite.*national.religious/i.test(t+e)
      || /israelis.*terminate.*residency/i.test(t+e)
      || /smotrich.*isaac accords/i.test(t+e)
      || /ministers clash.*cabinet.*iran/i.test(t+e)
      || /ben gvir.*betrayed.*dignity/i.test(t+e)
      || /rabbi.*law.*torah.*moses/i.test(t+e)
      || /chief of staff.*moshiach.*patch/i.test(t+e)
      || /pro.israel trump pick.*comments.*jews/i.test(t+e)
      || /netanyahu.*picks.*national security council|nsc.*head/i.test(t+e)
      || /bennett.*clock.*regime.*government.*israel.*changed/i.test(t+e)
      || /knesset.*approves.*resolution.*sovereignty/i.test(t+e)
  },
  {
    name: 'Media bias and information war against Israel',
    theme: 'Media analysis / information war',
    match: (t, e) =>
      /cnn.*troubling.*pattern.*anti.israel/i.test(t+e)
      || /drop site.*sanitizes.*hamas/i.test(t+e)
      || /flotilla.*global outrage.*stopped.*libya/i.test(t+e)
      || /weak reporting.*fueled.*narrative.*espionage/i.test(t+e)
      || /hezbollah.*casualties.*ignored.*media/i.test(t+e)
      || /samidoun.*jaldia.*designation/i.test(t+e)
      || /al.jazeera.*propaganda.*iranian/i.test(t+e)
      || /qatari.*media.*propaganda.*iran/i.test(t+e)
      || /zohran mamdani.*dsa.*palestine/i.test(t+e)
      || /palestinian movement.*collapse.*video/i.test(t+e)
      || /cair.*executive.*october 7.*happy/i.test(t+e)
      || /arab journalists.*muslim brotherhood.*designating/i.test(t+e)
      || /aliyah.*honestreporing/i.test(t+e)
  },
  {
    name: 'Strait of Hormuz tensions and US-Iran naval standoff',
    theme: 'Strait of Hormuz / regional military',
    match: (t, e) =>
      /hormuz/i.test(t+e)
      || /three tankers.*three strikes.*indian sailors/i.test(t+e)
      || /apache.*helicopter.*strait/i.test(t+e)
      || /us.*forces.*shot down.*iranian.*drone.*hormuz/i.test(t+e)
  },
  {
    name: 'IHRA presidency and Holocaust remembrance',
    theme: 'IHRA / Holocaust remembrance',
    match: (t, e) =>
      /\bihra\b/i.test(t+e)
      || /foreign ministers.*combating antisemitism/i.test(t+e)
      || /survivors.*declaration|declaration.*survivors/i.test(t+e)
      || /pontian greek genocide/i.test(t+e)
      || /professor yehuda bauer/i.test(t+e)
      || /conference.*roma genocide/i.test(t+e)
  },
  {
    name: 'Islamic extremism and jihadist threats',
    theme: 'Jihadist extremism',
    match: (t, e) =>
      /isis.*(weekly|spokesman|attack christian|eid.*donation)/i.test(t+e)
      || /islamic state.*(spokesman|calls for.*attack|glorif|predict)/i.test(t+e)
      || /iums.*fatwa.*jihad.*duty/i.test(t+e)
      || /neo.nazi.*(telegram|ai|accelerationist)/i.test(t+e)
      || /texas islamic conference.*islam rule world/i.test(t+e)
      || /terrorgram.*neo.nazi/i.test(t+e)
      || /islamization.*syria.*al.sharaa/i.test(t+e)
      || /iskp.*monero.*eid/i.test(t+e)
      || /american communist.*death to america.*isfahan/i.test(t+e)
      || /posters.*pro.islamic state.*threaten.*holiday/i.test(t+e)
      || /12 christians.*sudan.*drone.*mb/i.test(t+e)
      || /jihadi drones.*isis.*hamas/i.test(t+e)
  },
  {
    name: 'Iran regime influence and regional Islamist networks',
    theme: 'Iran regional influence / Islamism',
    match: (t, e) =>
      /iran.*leadership.*messianic/i.test(t+e)
      || /iranian.*regime.*convinced.*threatens.*trump/i.test(t+e)
      || /support iran.*islamic revolution.*frankfurt/i.test(t+e)
      || /mrs.*muslim brotherhood.*sheikha moza/i.test(t+e)
      || /muslim brotherhood.*(oust|campaign.*egypt|sisi.*fall)/i.test(t+e)
      || /turkey.*islamic nato.*saudi.*pakistan/i.test(t+e)
      || /egypt.*badr 2026.*military exercise.*deterrence.*israel/i.test(t+e)
      || /iranian majlis.*speaker.*qalibaf/i.test(t+e)
      || /people.*fighters.*sunni.*iran.*discriminat/i.test(t+e)
      || /afghan.*geopolitical.*us hegemony.*decline/i.test(t+e)
      || /pakistan.*fears.*memri.*balochistan/i.test(t+e)
      || /shinqiti.*qatar.*western.*salvation.*islam/i.test(t+e)
  },
  {
    name: 'Israeli innovation and society',
    theme: 'Israeli innovation / society',
    match: (t, e) =>
      /israeli.*(startup|doctor|tech|innovation|gene.*therapy|robot|ai)/i.test(t+e)
      || /gene injection.*brain therapy.*infant/i.test(t+e)
      || /vedic.*math.*startup/i.test(t+e)
      || /bee.*population.*robot/i.test(t+e)
      || /red heifer.*ritual/i.test(t+e)
      || /3.*800.*year.*old.*textile.*judean|biblical.*textile/i.test(t+e)
      || /bar mitzvahs.*orphans.*colel chabad/i.test(t+e)
      || /arab.israeli.*transgender.*fashion/i.test(t+e)
      || /music.*jewish.arab.*dance/i.test(t+e)
      || /injured soldier.*independence day.*address/i.test(t+e)
      || /walls.*jerusalem.*yom haatzmaut/i.test(t+e)
      || /hasidic singer.*dedi graucher/i.test(t+e)
      || /repair the world.*serve 250/i.test(t+e)
      || /kabbalah.*yivo.*exhibit/i.test(t+e)
      || /heat wave.*idf.*air conditioning/i.test(t+e)
      || /golan.*development.*netanyahu/i.test(t+e)
      || /samaria.*wastewater.*gush dan/i.test(t+e)
      || /historic.*jews.*joseph.*tomb/i.test(t+e)
      || /netanyahu.*congratulates.*modi.*longest.serving/i.test(t+e)
  },
  {
    name: 'MASHAV international development aid and cooperation',
    theme: 'Israeli development aid / MASHAV',
    match: (t, e) =>
      /mashav/i.test(t+e)
      || /agricultural training.*kenya|kenya.*training/i.test(t+e)
      || /irrigation systems design/i.test(t)
      || /small ruminant farming/i.test(t)
      || /social entrepreneurship.*french/i.test(t)
      || /sustainable community development/i.test(t)
      || /avocado.*crop.*ethiopia/i.test(t)
      || /golda.*cooking/i.test(t)
      || /combating gender.based violence.*mashav/i.test(t+e)
      || /innovative approaches.*early childhood/i.test(t)
      || /flood relief.*zamora/i.test(t)
      || /kenyan alumni.*kimana model farm/i.test(t)
  },
  {
    name: 'Israeli government statements and diplomatic meetings',
    theme: 'Israeli government / diplomacy',
    match: (_t, _e) => true, // catch-all for remaining PMO / MFA items
  },
];

async function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: loadAuth() });
}

async function ensureStoryClustersTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = new Set(meta.data.sheets.map(s => s.properties.title));
  if (!existing.has('Story Clusters')) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: 'Story Clusters' } } }] },
    });
  }
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Story Clusters'!1:1",
  });
  const firstRow = (res.data.values || [[]])[0] || [];
  if (firstRow.length === 0) {
    const clusterHeaders = [
      'clusterName','theme','itemCount','sources','urls','rawItems',
      'createdAt','status','riskLevel','productionReadiness',
    ];
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: "'Story Clusters'!A1",
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [clusterHeaders] },
    });
    console.log('Created Story Clusters tab with headers');
  }
}

async function updateRawNewsStatus(sheets, rowNums) {
  if (!rowNums.length) return;
  // Batch update status column (col L = index 12, 1-based) to "clustered"
  const data = rowNums.map(rowNum => ({
    range: `'Raw News'!L${rowNum}`,
    values: [['clustered']],
  }));
  // Chunk into batches of 100
  for (let i = 0; i < data.length; i += 100) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: data.slice(i, i + 100) },
    });
  }
  console.log(`Marked ${rowNums.length} Raw News rows as clustered`);
}

async function main() {
  const items = JSON.parse(fs.readFileSync('/tmp/unclustered-items.json', 'utf8'));
  console.log(`Loaded ${items.length} items to cluster`);

  // Separate boilerplate from substantive
  const substantive = items.filter(i => !isBoilerplate(i));
  const boilerplate = items.filter(i => isBoilerplate(i));
  console.log(`  Substantive: ${substantive.length}, Boilerplate/nav: ${boilerplate.length}`);

  // Assign each substantive item to a cluster
  const clusterMap = {};
  CLUSTER_DEFS.forEach(cd => { clusterMap[cd.name] = { ...cd, items: [] }; });

  for (const item of substantive) {
    for (const cd of CLUSTER_DEFS) {
      if (cd.match(item.title || '', item.excerpt || '')) {
        clusterMap[cd.name].items.push(item);
        break;
      }
    }
  }

  // Print summary
  let totalClustered = 0;
  for (const [name, cd] of Object.entries(clusterMap)) {
    if (cd.items.length > 0) {
      console.log(`  [${cd.items.length}] ${name}`);
      totalClustered += cd.items.length;
    }
  }
  console.log(`  Total clustered: ${totalClustered}`);

  // Boilerplate items go into a single "navigation/boilerplate" cluster
  // (we still mark them clustered so they don't recur)
  const allItemsToMark = [...substantive, ...boilerplate];
  const allRowNums = allItemsToMark.map(i => i.rowNum);

  // Build cluster rows for Story Clusters tab
  const clusterRows = [];
  for (const [, cd] of Object.entries(clusterMap)) {
    if (cd.items.length === 0) continue;
    const uniqueSources = [...new Set(cd.items.map(i => i.sourceName))].join(', ');
    const urls = cd.items.map(i => i.url).join('|');
    const rawItemsList = cd.items.map(i => ({
      sourceName: i.sourceName,
      title: i.title,
      url: i.url,
      publishedAt: i.publishedAt,
    }));
    let rawItemsJson = JSON.stringify(rawItemsList);
    // Sheets cell limit is 50,000 chars; truncate gracefully if needed
    if (rawItemsJson.length > 45000) {
      rawItemsJson = rawItemsJson.substring(0, 45000) + '... (truncated)]';
    }
    clusterRows.push([
      cd.name,           // clusterName
      cd.theme,          // theme
      cd.items.length,   // itemCount
      uniqueSources,     // sources
      urls,              // urls
      rawItemsJson,      // rawItems
      NOW,               // createdAt
      'pending_review',  // status
      '',                // riskLevel
      '',                // productionReadiness
    ]);
  }
  console.log(`Building ${clusterRows.length} cluster rows for Story Clusters tab`);

  const sheets = await getSheetsClient();
  await ensureStoryClustersTab(sheets);

  // Append cluster rows
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Story Clusters'!A1",
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: clusterRows },
  });
  console.log(`Appended ${clusterRows.length} clusters to Story Clusters tab`);

  // Mark all items (substantive + boilerplate) as clustered in Raw News
  await updateRawNewsStatus(sheets, allRowNums);

  console.log('Done!');
}

main().catch(e => { console.error('[ERROR]', e.message); process.exit(1); });
