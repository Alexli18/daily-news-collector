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

// ── Same boilerplate filter as do-clustering.js ──────────────────────────────
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
  'Lebanon News & Analysis Research Archive','A Picture Of Victory','Menahem Milson',
  'MEMRI TV Clips: Hamas & Muslim Brotherhood LInked MAB Director',
  'Sami Hamdi\'s Father: Don\'t Judge Him Based on One Video',
  'As MEMRI Marks 30 Years, Exciting Changes Ahead',
  'Special Announcement: MEMRI Welcomes Himdad Mustafa As Special Advisor To Kurdish Studies Project',
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
  if (item.title.startsWith('Benjamin Netanyahu - Curriculum Vitae')) return true;
  if (item.title.startsWith('MEMRI Founder And President Yigal Carmon In Interview')) return true;
  return BOILERPLATE_RE.some(p => p.test(item.title));
}

// ── Same cluster definitions (match functions) ───────────────────────────────
const CLUSTER_DEFS = [
  {
    id: 'SC-021',
    name: 'Iran nuclear deal and US-Iran negotiations',
    clusterType: 'policy_debate',
    videoPotential: 'high',
    riskLevel: 'medium',
    eventSummary: 'The US and Iran reached a Memorandum of Understanding on Iran\'s nuclear programme. Both sides issued contradictory victory statements. FDD analysts argued the MoU carries no legal enforcement and is not a "peace deal." Iran received immediate oil export relief; Trump publicly pressured Netanyahu. Gulf states remain divided.',
    framingConflict: 'Iran state media: US capitulated. Trump: greatest deal ever. FDD: ambiguous MoU with no enforcement. Israeli analysts: lack of verified details is the real story. Israeli right wing: Israel will not be bound by it.',
    missingContext: 'Full MoU text not publicly released. Verification mechanism unclear. Whether Iran\'s uranium stockpile declarations are covered is disputed. Whether Israel was consulted before signing is unknown.',
    suggestedVideoAngle: 'Both Iran and the US declared victory on the exact same document. Here\'s what they each claim it says — and what that tells you about the deal\'s real strength.',
    possibleCatMetaphor: 'Two cats fought over the same fish. Each walked away telling its friends it won the bigger piece. The fish is still on the floor.',
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
      || /no choice but diplomacy/i.test(t+e),
  },
  {
    id: 'SC-022',
    name: 'Iran missile strikes on Israel and IDF counter-strikes',
    clusterType: 'military_operation',
    videoPotential: 'high',
    riskLevel: 'high',
    eventSummary: 'Iran launched ballistic missiles and cluster munitions at Israel. The IDF struck strategic Iranian nuclear infrastructure in response. Ben Gurion Airport remained open but Home Front guidelines were tightened. An interceptor missile malfunction was confirmed. Satellite imagery showed possible damage to Ramat David airbase. Ministers clashed in cabinet over the scale of the Israeli response.',
    framingConflict: 'Iranian state media: 84 Israeli violations justify the strikes. IDF: Iran launched an unprovoked attack. Israeli right: the response was insufficient. Opposition: attack exposed Netanyahu\'s strategic failures. Western outlets largely focused on escalation risk over Iranian aggression.',
    missingContext: 'Exact targets of IDF strikes in Iran not confirmed. Extent of damage to Ramat David not independently verified. Whether the interceptor malfunction was a technical failure or cyber-related is unknown. Casualty figures on both sides withheld.',
    suggestedVideoAngle: 'Iran fired cluster munitions at Israel. Israel hit a nuclear facility. Here\'s the timeline of one night that changed the rules of engagement between the two countries.',
    possibleCatMetaphor: 'One cat threw something at the other\'s house. The second cat broke the first cat\'s fence in response. Both cats are now watching each other from opposite ends of the garden.',
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
      || /closed.*crossings.*iranian.*missile/i.test(t+e),
  },
  {
    id: 'SC-023',
    name: 'Israel-Lebanon ceasefire and Hezbollah',
    clusterType: 'policy_debate',
    videoPotential: 'high',
    riskLevel: 'high',
    eventSummary: 'A ceasefire agreement between Israel and Lebanon was announced, with key clauses disputed. IDF took operational control of Beaufort Ridge and revealed underground Hezbollah tunnels. Two Israeli soldiers were killed by Hezbollah drones. UN personnel were killed in a Hezbollah attack. Israel faces a reported obligation to withdraw from Lebanon within two months. Northern residents remain on edge after a cross-border infiltration.',
    framingConflict: 'IDF: Hezbollah attacked first despite the ceasefire. Lebanese government: IDF presence at Beaufort Ridge violates the agreement. Egypt is pushing a limited security arrangement that would leave Hezbollah armed. Iran: ceasefire covers "all fronts including Lebanon." Israel: Lebanon track is separate.',
    missingContext: 'Exact ceasefire clause text not fully published. Whether the IDF\'s Beaufort Ridge position is legally within ceasefire terms is disputed. Timeline for Israeli withdrawal not confirmed by Israeli side.',
    suggestedVideoAngle: 'The ceasefire said it covered Lebanon. Israel says it doesn\'t. Hezbollah fired drones anyway. Here is what is actually happening on Israel\'s northern border right now.',
    possibleCatMetaphor: 'Two cats signed a truce about the couch. One cat kept scratching from the armrest, claiming the armrest was never part of the deal.',
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
      || /key clauses.*lebanon ceasefire/i.test(t+e),
  },
  {
    id: 'SC-024',
    name: 'Gaza operations and Hamas',
    clusterType: 'military_operation',
    videoPotential: 'high',
    riskLevel: 'high',
    eventSummary: 'The IDF eliminated recently appointed Hamas military leader Mohammad Odeh, a Nukhba deputy commander involved in October 7 abductions, and additional Hamas and Islamic Jihad commanders in northern Gaza. Israel halted humanitarian aid and closed Gaza crossings following an Iranian missile attack. A Kurdish doctor described torture under Hamas detention. Hamas officials publicly denied wrongdoing while internal PA voices condemned Hamas executions as ISIS-like. Trump stated the Gaza ceasefire remains in effect.',
    framingConflict: 'IDF frames eliminations as targeted counterterrorism. Hamas frames them as assassinations of political figures. Trump says the ceasefire holds; Israeli actions on crossings suggest otherwise. PA voices condemn Hamas but have no enforcement power in Gaza.',
    missingContext: 'Whether closing Gaza crossings triggered ceasefire violation claims is not clarified. Hostage status and count not addressed in current coverage. Civilian impact of crossing closure not quantified.',
    suggestedVideoAngle: 'Israel eliminated the new Hamas military chief less than a week after his appointment. Here\'s who he was, what he did on October 7, and what his killing means for Gaza.',
    possibleCatMetaphor: 'The mice appointed a new general. The cat found out on day three. The cat was not impressed.',
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
      || /first hostages return home/i.test(t),
  },
  {
    id: 'SC-025',
    name: 'Mossad leadership transition and Iran regime change strategy',
    clusterType: 'single_event',
    videoPotential: 'high',
    riskLevel: 'medium',
    eventSummary: 'Roman Gofman was approved as the next Mossad chief, replacing David Barnea. At Barnea\'s farewell ceremony, Netanyahu stated the "foundations of the terrorist regime in Iran have cracked — it will never return to what it was." The outgoing Mossad chief stated the campaign will be complete only when the extremist regime is replaced. A report alleged a joint Mossad-CIA covert operation armed Kurdish militias to topple the Iranian regime.',
    framingConflict: 'Netanyahu framed the transition as a victory lap on Iran. Israeli opposition questioned timing given active operations. The Mossad-CIA Kurdish report was not officially confirmed by either government.',
    missingContext: 'Gofman\'s background and priorities not publicly disclosed. Whether the Kurdish militia operation is ongoing or complete is unknown. The CIA has not commented.',
    suggestedVideoAngle: 'Israel\'s spy chief just handed over to a new chief — and on his way out, said the mission isn\'t done until the Iranian regime falls. Here\'s what that means.',
    possibleCatMetaphor: 'The cat that had been watching the dog for two years just handed the shift to a new cat. On its way out it said: the dog hasn\'t learned its lesson yet.',
    match: (t, e) =>
      /mossad.*(chief|director|head|command|appointment|barnea|gofman|change of command)/i.test(t+e)
      || /roman gofman|david barnea/i.test(t+e)
      || /mossad.*cia.*kurd.*iran|kurd.*militia.*topple.*iran/i.test(t+e)
      || /hussein yazdanpana/i.test(t+e)
      || /extremist regime.*replaced|campaign.*completed.*regime.*replaced/i.test(t+e)
      || /mossad.*announcement.*command/i.test(t+e)
      || /foundations.*terrorist regime.*iran.*cracked/i.test(t+e),
  },
  {
    id: 'SC-026',
    name: 'US-Israel relations and Trump-Netanyahu diplomacy',
    clusterType: 'diplomacy',
    videoPotential: 'high',
    riskLevel: 'medium',
    eventSummary: 'Trump publicly criticised Netanyahu during Iran deal negotiations, reportedly asking "what the f*** are you doing?" and stating Netanyahu "will do whatever I want." Senator Graham sent Trump a message urging understanding of who Iran is. Ambassador Huckabee tied Israel\'s heritage to America\'s founding. The NYT reported Israel allegedly surveilled senior US officials including Witkoff. Israel denied the report; HonestReporting challenged the sourcing.',
    framingConflict: 'Trump allies: Netanyahu is obstructing a good deal. Israeli right: the US is pressuring Israel to accept a bad deal. HonestReporting: the espionage story relies on anonymous sources and is designed to damage the relationship. NYT: Israel crossed a red line by targeting US officials.',
    missingContext: 'Whether Trump\'s public criticism is tactical pressure or reflects genuine frustration is unclear. The espionage report has not been confirmed by any named US official. Netanyahu\'s private communications with Trump not disclosed.',
    suggestedVideoAngle: 'Trump said Netanyahu "will do whatever I want." Netanyahu called the Gaza ceasefire "still in effect" hours after closing Gaza crossings. Here\'s what\'s actually happening inside the US-Israel relationship right now.',
    possibleCatMetaphor: 'The big cat told the smaller cat it was in charge of the fish. The smaller cat nodded — then hid a sardine under the rug. The big cat noticed.',
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
      || /israel.*conflict.*trump|no choice.*risk.*open conflict.*trump/i.test(t+e),
  },
  {
    id: 'SC-027',
    name: 'IDF military capabilities and operations briefings',
    clusterType: 'single_event',
    videoPotential: 'medium',
    riskLevel: 'low',
    eventSummary: 'Israel\'s Air Force received its first KC-46 Gideon refueling aircraft in a ceremony led by the Chief of General Staff and Air Force commander, significantly extending Israel\'s long-range strike capability. IDF held press briefings on June 7 and 8 updating the security situation. A background piece covered Operation Arnon\'s two-year anniversary. The first female soldier to pass an elite IDF unit training course was reported.',
    framingConflict: 'IDF framing: this is a historic capability leap for the IAF. Context: the KC-46 acquisition is directly linked to Israel\'s ability to strike Iran independently, which is relevant to ongoing US pressure not to act.',
    missingContext: 'Number of KC-46s in the first delivery not stated. Whether the aircraft have already been used operationally is not confirmed.',
    suggestedVideoAngle: 'Israel just got a plane that lets it hit targets 5,000 km away without refueling. This is what that means — and why the timing matters.',
    possibleCatMetaphor: 'The cat got longer legs. Suddenly the top shelf is no longer safe.',
    match: (t, e) =>
      /kc.46|pegasus.*tanker|refueling aircraft|gideon.*aircraft/i.test(t+e)
      || /idf.*press briefing|press briefing.*idf spokesperson/i.test(t+e)
      || /operation.*arnon|background.*operation.*arnon/i.test(t+e)
      || /3 soldiers.*3 faiths|soldiers.*faiths.*purpose/i.test(t+e)
      || /israel.*air superiority/i.test(t+e)
      || /women.*female soldier.*elite.*unit/i.test(t+e)
      || /military.*police.*investigation.*killing.*infant.*hebron/i.test(t+e),
  },
  {
    id: 'SC-028',
    name: 'Antisemitism and anti-Israel actions in Western countries',
    clusterType: 'security_context',
    videoPotential: 'high',
    riskLevel: 'medium',
    eventSummary: 'Hatzolah ambulances were torched in an antisemitic arson attack in London\'s Golders Green. A woman was attacked on the New York subway with the phrase "Jews eat children" shouted at her. A pro-Palestinian protest targeted a London synagogue; the community pushed back. Pro-Palestinian activists attempted to install a statue of convicted terrorist Marwan Barghouti in London. A UN envoy told Germany to "forget the Holocaust" and mocked a mother of an October 7 victim.',
    framingConflict: 'Community groups frame these as linked, escalating antisemitism. Mainstream media tends to treat each incident individually without aggregating the trend. The UN envoy story was widely condemned in Israel but received limited coverage in major Western outlets.',
    missingContext: 'Whether London Police have suspects in the Golders Green arson is not reported. The UN envoy\'s name and mandate are not specified in available coverage. Barghouti statue attempt — legal status of the installation is unclear.',
    suggestedVideoAngle: 'Ambulances torched. A statue of a convicted terrorist installed in London. A UN official told a Holocaust survivor\'s mother to get over it. This is what antisemitism looked like in one week.',
    possibleCatMetaphor: 'The cat did not understand why the other cats kept drawing X\'s on its bowl. Each X was called a separate incident.',
    match: (t, e) =>
      /antisemit/i.test(t+e)
      || /hatzolah.*torch|arson.*london.*golders/i.test(t+e)
      || /jews eat children|subway.*attack.*jew/i.test(t+e)
      || /un envoy.*germany.*holocaust|forget.*holocaust/i.test(t+e)
      || /un envoy.*mocks.*mother.*oct.*7/i.test(t+e)
      || /barghouti.*statue|statue.*terrorist.*london/i.test(t+e)
      || /london.*synagogue.*protest|anti.israel.*synagogue/i.test(t+e)
      || /emoji guide.*antisemitism/i.test(t+e)
      || /danon.*hostage.*pin.*holocaust.*ceremony/i.test(t+e),
  },
  {
    id: 'SC-029',
    name: 'Israel diplomatic tensions with Europe and ICC',
    clusterType: 'policy_debate',
    videoPotential: 'medium',
    riskLevel: 'medium',
    eventSummary: 'The Netherlands officially designated Israel a "security threat." Slovenia barred an Israir flight in an EU open-skies dispute; Israel announced it will open its first-ever embassy in Slovenia. The EU condemned Israel\'s proposed death penalty bill for terrorists. Italy opened an investigation into Defense Minister Ben-Gvir over the Gaza flotilla, alleging torture and kidnapping. ICC Chief Prosecutor Karim Khan was suspended following a sexual misconduct investigation.',
    framingConflict: 'European governments frame these moves as proportionate human rights responses. Israel: these are discriminatory, politically motivated actions targeting a democracy at war. Czechia and Hungary block broader EU sanctions. Khan\'s suspension raises questions about the credibility of the ICC case against Israeli leaders.',
    missingContext: 'The legal basis for the Netherlands\' "security threat" designation is not specified. The Italian investigation\'s evidentiary basis is not public. Whether Khan\'s suspension affects the ICC arrest warrant process is not addressed.',
    suggestedVideoAngle: 'The Netherlands called Israel a security threat. Italy opened a criminal case against an Israeli minister. And the ICC\'s own chief prosecutor is now suspended on misconduct charges. What is actually happening to international law right now.',
    possibleCatMetaphor: 'The cats put the dog on trial. The judge cat was then arrested. The trial continues.',
    match: (t, e) =>
      /netherlands.*security threat/i.test(t+e)
      || /slovenia.*(israir|bar.*flight)|eu.*open.skies/i.test(t+e)
      || /eu.*israel.*death penalty|death penalty.*eu.*double standards/i.test(t+e)
      || /italy.*ben.gvir.*flotilla/i.test(t+e)
      || /icc.*(suspend|chief.*prosecutor|karim khan)/i.test(t+e)
      || /tommy robinson.*arrest.*counterterrorism/i.test(t+e)
      || /israeli ministers slam.*romanian/i.test(t+e),
  },
  {
    id: 'SC-030',
    name: 'West Bank security operations and settler-Palestinian tensions',
    clusterType: 'security_context',
    videoPotential: 'medium',
    riskLevel: 'high',
    eventSummary: 'A large-scale IDF counterterrorism operation was launched in Hebron. A Master Sergeant reservist was killed in a terror attack in central Israel. Israeli settlers clashed with Palestinians in Huwara. The IDF opened a military police investigation into the killing of a Palestinian infant in Hebron. The Knesset approved a resolution affirming Israeli sovereignty in Judea and Samaria. Jews were for the first time permitted to access Joseph\'s Tomb during daylight hours.',
    framingConflict: 'IDF frames operations as targeted counterterrorism responses. Palestinian and international media focus on settler violence and the infant killing investigation. The sovereignty resolution is framed as annexation by critics and as a reaffirmation of existing law by Israeli government.',
    missingContext: 'Circumstances of the infant killing in Hebron pending investigation — no findings yet. The terror attack perpetrator\'s affiliation not confirmed. Huwara clashes — which party initiated not independently verified.',
    suggestedVideoAngle: 'The Knesset voted to affirm Israeli sovereignty over the West Bank. The same week, a Palestinian infant was killed and an investigation was opened. Here\'s what life in the West Bank actually looks like in June 2026.',
    possibleCatMetaphor: 'The cat planted a flag in the corner of the yard. The other animals said the corner was disputed. The cat said it was always theirs. Everyone is now watching the corner very carefully.',
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
      || /egypt.*diploma.*suicide bombing.*israel/i.test(t+e),
  },
  {
    id: 'SC-031',
    name: 'Israeli domestic politics and Knesset',
    clusterType: 'domestic_politics',
    videoPotential: 'medium',
    riskLevel: 'low',
    eventSummary: 'A Knesset dissolution bill passed its first reading, signalling possible early elections. Minister Dudi Amsalem suffered a heart attack. 10 of 11 cadets dismissed from an elite IDF unit were national-religious, sparking political controversy. 6,651 Israelis voluntarily requested to terminate residency status. Netanyahu appointed a new head of the National Security Council. The IDF Chief of Staff publicly removed a "Moshiach" patch from a soldier\'s arm, generating culture-war commentary.',
    framingConflict: 'Coalition: dismissals of cadets are a matter of unit standards. Opposition and religious-nationalist parties: systematic discrimination against religious soldiers. Dissolution bill: coalition frames it as a political tool; opposition frames it as a desperate maneuver.',
    missingContext: 'Amsalem\'s condition and political implications for coalition stability not updated. The NSC appointment criteria and candidate background not specified in available coverage.',
    suggestedVideoAngle: 'Ten out of eleven dismissed elite cadets were national-religious. The IDF chief ripped a Messiah patch off a soldier. Here\'s what\'s happening inside the Israeli military\'s culture war.',
    possibleCatMetaphor: 'The cats in the army argued about which cats were real army cats. The general cat ripped a badge off one cat\'s collar and said "not on my watch."',
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
      || /knesset.*approves.*resolution.*sovereignty/i.test(t+e),
  },
  {
    id: 'SC-032',
    name: 'Media bias and information war against Israel',
    clusterType: 'media_framing_conflict',
    videoPotential: 'medium',
    riskLevel: 'low',
    eventSummary: 'HonestReporting documented CNN\'s pattern of granting access to terror-affiliated figures while promoting anti-Israel narratives. Drop Site News was shown to sanitize Hamas and Hezbollah terminology for Western audiences. The Gaza flotilla\'s global coverage was contrasted with silence on Libya\'s border situation. Al-Jazeera and major Qatari media outlets continued to serve as propaganda platforms for the Iranian regime despite Iranian attacks on Arab countries. CAIR\'s executive director was filmed saying he was happy on October 7.',
    framingConflict: 'Western media organisations present their coverage as neutral reporting. HonestReporting, CAMERA and MEMRI document specific patterns of framing, omission and access that systematically favour hostile actors. Social media amplifies these narratives faster than corrections.',
    missingContext: 'CNN has not publicly responded to HonestReporting\'s specific claims. Drop Site News has not issued a correction. CAIR\'s statement context (was it edited?) is disputed.',
    suggestedVideoAngle: 'CNN gave a platform to a Hamas-linked figure. Drop Site News described a Hezbollah commander as a "resistance fighter." A CAIR director said he was happy on October 7. Here\'s what the information war against Israel actually looks like.',
    possibleCatMetaphor: 'The cat watched the dog eat its food. The newspaper reported: "Cat and dog share a meal in heartwarming display of friendship."',
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
      || /aliyah.*honestreporing/i.test(t+e),
  },
  {
    id: 'SC-033',
    name: 'Strait of Hormuz tensions and US-Iran naval standoff',
    clusterType: 'military_operation',
    videoPotential: 'medium',
    riskLevel: 'high',
    eventSummary: 'US forces shot down two Iranian attack drones threatening Hormuz traffic. A US Army Apache helicopter went down near the Strait of Hormuz with the crew rescued. Three tanker strikes killed Indian sailors in the first confirmed blockade casualties off Oman. The US reportedly will allow Iran to sell oil once the Strait reopens as part of the deal terms.',
    framingConflict: 'US military frames the drone shootdowns as defensive action. Iran frames them as US aggression against sovereign Iranian forces. The tanker strikes involve third-country nationals, which risks broadening the conflict internationally.',
    missingContext: 'Whether the Apache crash was combat-related or mechanical is not confirmed. Nationalities of the tanker crews and which flag the vessels flew are not specified. Whether Iran officially claimed the tanker strikes is not reported.',
    suggestedVideoAngle: 'Indian sailors died off Oman when tankers were hit in what the US is calling an Iranian blockade. US forces shot down Iranian drones the same week. Here\'s what\'s happening at the world\'s most important shipping chokepoint.',
    possibleCatMetaphor: 'Two cats were fighting over who controls the hallway. Everyone else trying to get to the kitchen had to pick a side.',
    match: (t, e) =>
      /hormuz/i.test(t+e)
      || /three tankers.*three strikes.*indian sailors/i.test(t+e)
      || /apache.*helicopter.*strait/i.test(t+e)
      || /us.*forces.*shot down.*iranian.*drone.*hormuz/i.test(t+e),
  },
  {
    id: 'SC-034',
    name: 'IHRA presidency and Holocaust remembrance',
    clusterType: 'diplomacy',
    videoPotential: 'low',
    riskLevel: 'low',
    eventSummary: 'Israel assumed the IHRA (International Holocaust Remembrance Alliance) presidency from the United Kingdom in a formal handover ceremony. A Foreign Ministers\' Conference on Combating Antisemitism was held. The Survivors\' Declaration was published. MEMRI documented the Pontian Greek Genocide centenary and the lack of Turkish accountability. The ICJ and ICC both appear in MFA documentation on Israeli legal responses.',
    framingConflict: 'Israel frames the IHRA presidency as a moment to strengthen global antisemitism norms during active conflict. Critics argue the timing and context make the IHRA chairmanship politically inconvenient for allies. The UN envoy\'s Holocaust comments (see antisemitism cluster) directly undercut the IHRA agenda.',
    missingContext: 'IHRA presidency term length and specific agenda priorities for Israel\'s term not reported. Which countries attended the antisemitism conference not specified.',
    suggestedVideoAngle: 'Israel just took over as chair of the world\'s main Holocaust remembrance body — the same week a UN official told Germany to "forget the Holocaust." Here\'s what that contradiction tells you about 2026.',
    possibleCatMetaphor: 'The cat was made president of the mice\'s memory committee. The mice said they were very grateful. Then one mouse told the audience to stop talking about the cat.',
    match: (t, e) =>
      /\bihra\b/i.test(t+e)
      || /foreign ministers.*combating antisemitism/i.test(t+e)
      || /survivors.*declaration|declaration.*survivors/i.test(t+e)
      || /pontian greek genocide/i.test(t+e)
      || /professor yehuda bauer/i.test(t+e)
      || /conference.*roma genocide/i.test(t+e),
  },
  {
    id: 'SC-035',
    name: 'Islamic extremism and jihadist threats',
    clusterType: 'security_context',
    videoPotential: 'medium',
    riskLevel: 'high',
    eventSummary: 'ISIS released its first statement in months calling for attacks on "Crusader and Jewish targets everywhere," prioritising jihad against Syria\'s new regime and glorifying African affiliates. IUMS issued a fatwa declaring armed jihad against Israel a duty for all Muslims. An accelerationist neo-Nazi network was documented using AI to spread content on Telegram. ISIS\'s Khurasan Province solicited cryptocurrency donations for Eid. A Christian massacre in Sudan was linked to MB-backed forces. A Hamas-sponsored conference discussed how to manage Jews after "Israel\'s disappearance."',
    framingConflict: 'MEMRI documents these statements with full translations as serious incitement. Western security agencies rarely respond publicly to individual MEMRI releases. Social media platforms have inconsistent enforcement.',
    missingContext: 'Whether ISIS\'s new statement indicates a genuine operational escalation or is rhetorical posturing is not assessed. IUMS\'s member states and financial backers not listed.',
    suggestedVideoAngle: 'ISIS released a new statement this week. A Muslim scholars\' body issued a fatwa making jihad against Israel obligatory. Neo-Nazis are using AI on Telegram. Here\'s what the extremism landscape looks like right now.',
    possibleCatMetaphor: 'Multiple dogs from different neighbourhoods all barked at the same fence on the same day. The fence is still standing. But the barking is getting louder.',
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
      || /jihadi drones.*isis.*hamas/i.test(t+e),
  },
  {
    id: 'SC-036',
    name: 'Iran regime influence and regional Islamist networks',
    clusterType: 'security_context',
    videoPotential: 'medium',
    riskLevel: 'medium',
    eventSummary: 'Egypt conducted its "Badr 2026" military exercise as a show of force signalling deterrence of Israel. Turkish moves toward membership in the Saudi-Pakistan defence pact raised concern about an emerging "Islamic NATO." Iranian embassies recruited diaspora Iranians for a "sacrifice for Iran" campaign in Germany, UK, Australia and other Western countries. The Muslim Brotherhood launched an online campaign to oust Egypt\'s President Sisi. A Qatari professor called for a Western "cultural revolution" toward Islam. MEMRI analysed the geopolitical decline of US hegemony as seen from Afghanistan.',
    framingConflict: 'MEMRI frames these developments as a coordinated regional Islamist network expanding influence. Gulf states and Turkey present their defence cooperation as sovereign security decisions. Iran frames diaspora recruitment as patriotic volunteering.',
    missingContext: 'The scale of Iranian diaspora recruitment (how many responded) is not known. Whether Turkey has formally applied to the Saudi-Pakistan pact is unclear. Egypt\'s Badr 2026 exercise size and specific Israel-facing component not detailed.',
    suggestedVideoAngle: 'Egypt ran a military exercise aimed at Israel. Turkish officials are talking about an Islamic NATO. Iranian embassies are recruiting volunteers in Germany and London. Here\'s what the regional Islamist network looks like in 2026.',
    possibleCatMetaphor: 'Multiple cats from different blocks held a meeting in the alley. Nobody posted the agenda online. The neighbourhood dog is paying attention.',
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
      || /shinqiti.*qatar.*western.*salvation.*islam/i.test(t+e),
  },
  {
    id: 'SC-037',
    name: 'Israeli innovation and society',
    clusterType: 'human_interest',
    videoPotential: 'medium',
    riskLevel: 'low',
    eventSummary: 'Israeli doctors performed the world\'s first gene injection brain therapy on an infant. An Israeli startup deployed AI and robotics to combat global bee population decline. An Israeli math startup Vedic targets students who believe they are "bad at math." A 3,800-year-old red textile dyed with Biblical scarlet was discovered in Judean Desert caves. The walls of Jerusalem\'s Old City were lit up for Israel\'s 78th Independence Day. A Red Heifer ritual rehearsal ceremony was held. The Samaria region\'s communities were connected to a major wastewater treatment plant.',
    framingConflict: 'Israeli government and pro-Israel media frame these as evidence of Israel\'s resilience and innovation under conflict. Critics rarely address this coverage. Some international outlets omit Israeli innovation stories entirely.',
    missingContext: 'The gene therapy infant\'s outcome and follow-up not reported. The archaeological textile\'s significance disputed by different scholarly camps.',
    suggestedVideoAngle: 'Israel performed the world\'s first gene injection brain therapy on a baby — the same week it was firing missiles at Iran. Here\'s what innovation looks like in a country at war.',
    possibleCatMetaphor: 'While the cats were arguing about the fence, one cat invented a better cat door. Nobody wrote about the cat door.',
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
      || /netanyahu.*congratulates.*modi.*longest.serving/i.test(t+e),
  },
  {
    id: 'SC-038',
    name: 'MASHAV international development aid and cooperation',
    clusterType: 'diplomacy',
    videoPotential: 'low',
    riskLevel: 'low',
    eventSummary: 'Israel\'s MASHAV development aid programme continued running agricultural training courses in Kenya, Ethiopia, Paraguay and other countries. A Kenyan alumni team launched the Kimana Model Farm based on Israeli techniques. MASHAV celebrated ambassadorial honours. Courses covered topics including irrigation design, small ruminant farming, entrepreneurship, and early childhood education.',
    framingConflict: 'Israeli government: MASHAV demonstrates Israel\'s positive global contribution beyond the conflict. Most international media does not cover MASHAV at all. Critics of Israel rarely acknowledge this development work.',
    missingContext: 'Many items in this cluster are course listings and archival pages rather than current news events — they represent the MASHAV website feed rather than new activity.',
    suggestedVideoAngle: 'While the world talks about what Israel destroys, here\'s what it builds — development programs in 160 countries that most people have never heard of.',
    possibleCatMetaphor: 'The cat taught the other animals in the neighbourhood how to grow vegetables. Nobody covered it because the cat was also in a fight with another cat.',
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
      || /kenyan alumni.*kimana model farm/i.test(t),
  },
  {
    id: 'SC-039',
    name: 'Israeli government statements and diplomatic meetings',
    clusterType: 'diplomacy',
    videoPotential: 'low',
    riskLevel: 'low',
    eventSummary: 'This cluster contains generic Israeli government statements, PMO announcements, and diplomatic meeting readouts that were collected from RSS feeds but do not carry standalone news value. Includes historical PMO archive entries (Ben-Gurion era), bilateral meeting readouts (Japan, Albania, Srpska), joint ministry announcements, and Ministry of Foreign Affairs informational pages that did not match a specific topical cluster.',
    framingConflict: 'Not applicable — these are official government publications without framing conflict.',
    missingContext: 'Many items are from archival pages or boilerplate PMO feed entries with no dateline or specific news event.',
    suggestedVideoAngle: 'Not recommended for video production — archival or low-news-value content.',
    possibleCatMetaphor: 'Not applicable.',
    match: (_t, _e) => true, // catch-all
  },
];

async function main() {
  const items = JSON.parse(fs.readFileSync('/tmp/unclustered-items.json', 'utf8'));

  // Re-run clustering to get items per cluster
  const clusterMap = {};
  CLUSTER_DEFS.forEach(cd => { clusterMap[cd.id] = { ...cd, items: [] }; });

  for (const item of items) {
    for (const cd of CLUSTER_DEFS) {
      if (cd.match(item.title || '', item.excerpt || '')) {
        clusterMap[cd.id].items.push(item);
        break;
      }
    }
  }

  // Build rows aligned to the EXISTING column schema:
  // clusterId | createdAt | clusterName | clusterType | eventSummary | framingConflict |
  // missingContext | suggestedVideoAngle | possibleCatMetaphor | mainSources |
  // sourceCount | relatedRawNewsKeys | videoPotential | riskLevel | productionReadiness | status | notes | scriptId | scriptGeneratedAt
  const rows = CLUSTER_DEFS.map(cd => {
    const clusterItems = clusterMap[cd.id].items;
    const uniqueSources = [...new Set(clusterItems.map(i => i.sourceName))];
    const dedupKeys = clusterItems.map(i => i.dedupeKey).filter(Boolean).join('|');
    // Truncate relatedRawNewsKeys to fit cell limit
    const keysField = dedupKeys.length > 45000 ? dedupKeys.substring(0, 45000) + '...' : dedupKeys;
    return [
      cd.id,                          // clusterId
      NOW,                            // createdAt
      cd.name,                        // clusterName
      cd.clusterType,                 // clusterType
      cd.eventSummary,                // eventSummary
      cd.framingConflict,             // framingConflict
      cd.missingContext,              // missingContext
      cd.suggestedVideoAngle,         // suggestedVideoAngle
      cd.possibleCatMetaphor,         // possibleCatMetaphor
      uniqueSources.join(', '),       // mainSources
      uniqueSources.length,           // sourceCount
      keysField,                      // relatedRawNewsKeys
      cd.videoPotential,              // videoPotential
      cd.riskLevel,                   // riskLevel
      '',                             // productionReadiness
      'pending_review',               // status
      `${clusterItems.length} items`, // notes
      '',                             // scriptId
      '',                             // scriptGeneratedAt
    ];
  });

  console.log(`Built ${rows.length} rows to overwrite rows 21-39`);
  rows.forEach((r, i) => console.log(`  Row ${i+21}: ${r[0]} | ${r[2]} | items=${r[16]}`));

  const auth = loadAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Overwrite rows 21–39 (A21:S39) with correctly aligned data
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Story Clusters'!A21:S39",
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });

  console.log('Overwritten rows 21–39 with correct column alignment. Done.');
}

main().catch(e => { console.error('[ERROR]', e.message, e.stack); process.exit(1); });
