#!/usr/bin/env node
'use strict';
/**
 * helpers/story-clusterer.js
 *
 * Groups raw news items into tight, video-sized story candidates.
 * Each cluster represents ONE specific story — one event, one framing conflict,
 * one policy dispute. Never a general topic bucket.
 *
 * Usage:
 *   node helpers/story-clusterer.js [--days N] [--dry-run] [--no-clear]
 *
 *   --days N    : Look back N days for Raw News items (default: 7)
 *   --dry-run   : Print clusters without writing to sheets
 *   --no-clear  : Append to existing Story Clusters data instead of replacing it
 *
 * Cluster size rules:
 *   - Target 2–12 items per cluster
 *   - Warn (but still write) if a cluster has > 15 items
 *   - Skip single-item clusters unless videoPotential >= 4
 *
 * Story Clusters tab schema:
 *   clusterId, createdAt, clusterName, clusterType,
 *   eventSummary, framingConflict, missingContext,
 *   suggestedVideoAngle, possibleCatMetaphor,
 *   mainSources, sourceCount, relatedRawNewsKeys,
 *   videoPotential, riskLevel, productionReadiness,
 *   status, notes
 */

const { google } = require('googleapis');

const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || '1w1Z1Jy3fhdeJ-ziQuuTn3bnTJ7LeETDWyp76Cs-nSLs';

const CLUSTER_HEADERS = [
  'clusterId', 'createdAt', 'clusterName', 'clusterType',
  'eventSummary', 'framingConflict', 'missingContext',
  'suggestedVideoAngle', 'possibleCatMetaphor',
  'mainSources', 'sourceCount', 'relatedRawNewsKeys',
  'videoPotential', 'riskLevel', 'productionReadiness',
  'status', 'notes',
];

// ─────────────────────────────────────────────────────────────────────────────
// STORY FRAME DEFINITIONS
//
// Each frame = one video-sized story candidate.
// matchFn(item) must return true ONLY if the item covers the SAME specific
// event, dispute, or framing conflict as the frame — not just a shared keyword.
//
// Priority order: first matching frame wins per item.
// Update these frames each news cycle as story angles change.
// ─────────────────────────────────────────────────────────────────────────────
const STORY_FRAMES = [

  // ── IRAN DEAL — SUBCLUSTERS BY SPECIFIC ANGLE ────────────────────

  {
    id: 'SC-001',
    clusterName: 'IAF Iran strike halted one hour before takeoff',
    clusterType: 'single_event',
    eventSummary: 'The Israeli Air Force had a broad, major strike on Iran fully prepared and was halted approximately one hour before takeoff. Senior IDF commanders publicly confirmed the operation existed and was called off, reportedly as the US-Iran deal was being finalized.',
    framingConflict: 'Israeli military sources treat this as an operational readiness story and a sign of restraint. Iranian media frames it as the US stopping Israel from attacking Iran. Western media largely omits Israeli independent military reach in the narrative.',
    missingContext: 'Was the halt ordered by Netanyahu, the IDF Chief, or US pressure? What were the specific targets? What was Iran\'s air-defense status at that moment? What would the Iranian response have been?',
    suggestedVideoAngle: 'Israel was one hour from striking Iran. Here is what we know about the operation that never happened — and why it matters for the region.',
    possibleCatMetaphor: 'The cat was crouched, claws out, ready to pounce — then the owner grabbed its collar at the last second. The cat is still watching.',
    videoPotential: 5,
    riskLevel: 'medium',
    productionReadiness: 'ready_for_review',
    notes: 'Multiple corroborating sources (IAF Commander quote, Israel Hayom). Strong production angle. Verify exact timeline and who ordered the halt.',
    matchFn: (item) => /hour.*before.*take.?off|take.?off.*hour.*before|broad strike.*iran.*halt|halt.*broad strike|iaf commander reveals|we were stopped.*hour|stopped.*hour.*before|air force.*was ready.*broad|halted.*an hour|ready for.*broad.*strike|ready.*for.*strike.*iran/i.test(_text(item)),
  },

  {
    id: 'SC-002',
    clusterName: 'US and Iran each claim opposite outcomes from the same deal',
    clusterType: 'media_framing_conflict',
    eventSummary: 'After the US-Iran deal announcement, both sides issued contradictory victory claims. Iran said the US accepted all Iranian proposals; the US said Iran agreed to curb its nuclear program. FDD noted both sides are taking "victory laps," meaning the deal language is ambiguous enough for both readings.',
    framingConflict: 'Iran state media: "We won, US capitulated." Trump: "Iran surrendered, greatest deal ever." FDD: "Both victory laps mean neither side got what they needed." Gulf press: "Iran emerged stronger from a war it did not lose."',
    missingContext: 'The full MoU text has not been officially released. A leaked 14-point draft contains ambiguous language supporting both readings. The narrative war itself signals how weak the enforcement mechanism is.',
    suggestedVideoAngle: 'When both sides declare victory on the exact same deal — what did the MoU actually say? Breaking down what each side signed and what each side is telling its own people.',
    possibleCatMetaphor: 'Two cats fought over the same fish. Each one walked away telling its friends it got the bigger piece. The fish is still on the floor.',
    videoPotential: 5,
    riskLevel: 'low',
    productionReadiness: 'ready_for_review',
    notes: 'Anchor: FDD "victory lap" piece + MEMRI analysis of MoU + Iranian journalist Hossein Pak quote. Cross-source well. Strong media framing angle.',
    matchFn: (item) => /victory.*lap.*iran|iran.*victory.*lap|narrative war.*iran|iran.*narrative war|iran.*denies.*agre|iran.*never.*agreed|iran.*claims.*us.*accepted|us.*accepted.*iran.*propos|iran.*boasts.*victory|iran.*won.*war.*us|both.*taking.*victory|each.*victory.*lap|iran.*won.*negotiat|editor.*omani.*iran.*won/i.test(_text(item)),
  },

  {
    id: 'SC-003',
    clusterName: 'FDD and analysts: the MoU is not a peace deal — media framing is wrong',
    clusterType: 'media_framing_conflict',
    eventSummary: 'Major outlets branded the US-Iran memorandum of understanding a "peace deal," while FDD and policy analysts argued an MoU carries no legal enforcement mechanism and cannot be equated with a treaty or binding agreement. FDD published the piece "An MOU is not a peace deal."',
    framingConflict: 'Mainstream media: historic peace deal, major Trump achievement. FDD: an MoU is a statement of intent with no enforcement — framing it as peace misleads the public on what was actually agreed. Israeli analysts: lack of details is the story.',
    missingContext: 'What is the legal difference between an MoU and a treaty? What enforcement mechanism exists if Iran violates it? No verification protocol has been publicly disclosed.',
    suggestedVideoAngle: 'Everyone is calling it a peace deal. It is not a peace deal. Here is the legal difference — and why it changes how you should read everything that follows.',
    possibleCatMetaphor: 'Cat agreed in principle to stop scratching — nothing in writing, no enforcement. Media headline: Cat Signs Historic Peace Treaty.',
    videoPotential: 4,
    riskLevel: 'low',
    productionReadiness: 'ready_for_review',
    notes: 'Anchor: FDD "An MOU is not a peace deal." Pair with MEMRI analysis of MoU text. High media literacy angle. Strong companion to SC-002.',
    matchFn: (item) => /mou.*not.*peace|an mou is not|peace.*deal.*not.*mou|mou.*is not|memorandum.*not.*peace|lack.*details.*deal|14.{0,5}point.*draft|published.*copy.*mou|iranian journalist.*draft|draft.*agreement.*call.*for|what.*know.*about.*it/i.test(_text(item)),
  },

  {
    id: 'SC-004',
    clusterName: "MoU says 'ceasefire on all fronts including Lebanon' — Huckabee says Hezbollah not in the deal",
    clusterType: 'policy_debate',
    eventSummary: "The published US-Iran MoU text explicitly includes 'end of war on all fronts including Lebanon.' US Ambassador Huckabee stated Hezbollah is not linked to the deal. FDD published 'The ceasefire war exposes Iran's attempt to fold Lebanon into the Iran ceasefire.' Israel rejected linking Lebanon to the deal.",
    framingConflict: "The MoU text mentions Lebanon. US officials say Hezbollah is a separate track. FDD: Iran is deliberately using 'all fronts' language to fold Lebanon in as leverage. Israel: we will not accept Lebanon ceasefire as part of this deal.",
    missingContext: "Does 'ceasefire on all fronts' legally bind Iran to stop arming Hezbollah? Does it mean Israel cannot respond to Hezbollah attacks without technically violating the deal? What is the US interpretation vs. Iran's official reading?",
    suggestedVideoAngle: "The Iran deal text says 'ceasefire on all fronts including Lebanon.' The US says Hezbollah is not included. Both cannot be true. Here is what is actually happening.",
    possibleCatMetaphor: "You signed a lease saying no pets. The fine print says 'applies to all occupants including the basement.' Your roommate already has a cat in the basement.",
    videoPotential: 4,
    riskLevel: 'medium',
    productionReadiness: 'needs_fact_check',
    notes: 'Must cite the exact MoU text. i24NEWS "published copy" article is key primary source. Huckabee denial is well documented. "Trading Away Lebanon" (FDD) is the analytical anchor.',
    matchFn: (item) => /lebanon.*iran.*deal|iran.*deal.*lebanon|huckabee.*hezbollah.*link|hezbollah.*not.*link.*deal|huckabee.*iran.*hezbollah|ceasefire.*all.*fronts.*lebanon|lebanon.*ceasefire.*all.*fronts|ceasefire.*war.*iran.*lebanon|trading.*away.*lebanon|washington.*bargain.*beirut|is.*lebanon.*part.*deal|lebanon.*part.*iran|israel.*withdrawal.*not.*condition|israel.*rejects.*iran.*demand.*link.*lebanon/i.test(_text(item)),
  },

  {
    id: 'SC-005',
    clusterName: 'Iran gets immediate oil export relief and frozen funds in the deal',
    clusterType: 'policy_debate',
    eventSummary: 'Under the US-Iran deal, oil sanctions are being lifted immediately, potentially generating over $100 billion in Iranian oil exports within two years. Trump separately approved a secret Qatar-Iran cash transfer releasing frozen funds. Iran also regains commercial control of Hormuz passage.',
    framingConflict: 'Trump: "The oil flows and peace comes." FDD and Israeli analysts: Iran gets concrete, immediate economic gains while nuclear rollback is phased, vague, and unverifiable. Critics: the US is paying Iran upfront for commitments Iran may never honor.',
    missingContext: 'Iran was already selling discounted oil to China. What is the actual marginal economic gain from sanction relief? Who verifies nuclear compliance before oil revenue flows? The Qatar cash deal details remain classified.',
    suggestedVideoAngle: "Iran gets the oil money first. The nuclear rollback comes later — maybe. Here is why the economic timeline of this deal is the most important detail nobody is talking about.",
    possibleCatMetaphor: "You give the cat the treat first, then ask it to sit. The cat ate the treat and walked away.",
    videoPotential: 4,
    riskLevel: 'medium',
    productionReadiness: 'needs_fact_check',
    notes: '$100B projection needs cross-verification. Qatar cash deal sourced as "secret" — check sourcing chain carefully. Hormuz reopening is confirmed in MoU text.',
    matchFn: (item) => /oil.*sanction.*iran|iran.*oil.*sanction|oil.*relief.*iran|iran.*oil.*relief|100.*billion.*iran|iran.*\$100|\$100.*billion.*iran|qatar.*iran.*cash|iran.*cash.*qatar|oil.*export.*iran.*deal|iran.*oil.*export.*deal|immediate.*oil.*iran|iran.*immediate.*oil|let.*oil.*flow|iran.*oil.*lifeline|naval.*blockade.*lift|lift.*naval.*blockade|oil.*prices.*fall.*iran|iran.*deal.*oil.*price/i.test(_text(item)),
  },

  {
    id: 'SC-006',
    clusterName: 'IAEA demands Iran declare uranium stockpile as reports say Iran is fortifying it',
    clusterType: 'policy_debate',
    eventSummary: "The IAEA passed a resolution demanding Iran declare its full uranium stockpile as the US-Iran deal was announced. Reports indicate Iran is actually fortifying its uranium stockpile to make US seizure harder. The deal reportedly uses 'no nuclear weapons' rather than 'no enrichment' — a far weaker commitment. FDD: 'Dilution is not the solution.'",
    framingConflict: "Trump: 'Iran agreed to never have nuclear weapons.' Iran: the deal only covers current hostilities, not long-term nuclear policy. IAEA: transparency on Iran's stockpile remains unresolved. Israeli defense establishment: Iran will exploit the deal to continue nuclear development.",
    missingContext: "What verification mechanism was agreed? 'No nuclear weapons' vs. 'no enrichment' is a critical semantic distinction. What happens to the existing enriched uranium stockpile? Can Iran resume enrichment after a waiting period?",
    suggestedVideoAngle: "'Iran agreed to no nuclear weapons.' But Iran is still enriching uranium — and is reportedly hiding stockpiles. What exactly did the US secure on the nuclear track?",
    possibleCatMetaphor: 'Cat agreed not to bite you today. It is sharpening its claws behind the couch.',
    videoPotential: 4,
    riskLevel: 'high',
    productionReadiness: 'needs_fact_check',
    notes: 'CRITICAL: Claim about Iran fortifying stockpile requires source verification before production — extraordinary claim. IAEA resolution and "no nuclear weapons" phrasing are confirmed anchors.',
    matchFn: (item) => /iaea|uranium.*stockpile|stockpile.*uranium|iran.*fortif.*uranium|uranium.*fortif|nuclear.*curb.*iran|iran.*nuclear.*curb|dilution.*uranium|uranium.*dilut|iaea.*resolution|iran.*declare.*uranium|uranium.*seizure|nuclear.*weapon.*iran.*deal|deal.*iran.*nuclear.*weapon|iran.*exploit.*nuclear|concern.*iran.*nuclear|iran.*nuclear.*threat|iran.*never.*have.*nuclear/i.test(_text(item)),
  },

  {
    id: 'SC-007',
    clusterName: "Trump publicly attacks Netanyahu: 'No f***ing judgment' — questions his political future",
    clusterType: 'single_event',
    eventSummary: "In an extraordinary public breach, Trump made multiple personal attacks on Prime Minister Netanyahu over Iran deal opposition and Lebanon strategy. He reportedly said Netanyahu 'has no f***ing judgment,' called him 'difficult,' wondered aloud if Netanyahu 'even wants to continue,' and said 'Without me there would be no Israel.' Trump also threatened to purge Iran-deal critics from his inner circle.",
    framingConflict: "Israeli right: Trump is undermining an ally mid-war. Israeli center: Netanyahu's unilateral moves provoked this. US analysis: Trump is angry because Israel's Beirut strikes nearly derailed the Iran deal. Netanyahu: 'We agree more than we disagree.'",
    missingContext: "A US president publicly attacking an allied PM this directly is historically unusual. Was this deliberate pressure to force Netanyahu's compliance, or genuine frustration? What did Netanyahu's team communicate privately in response?",
    suggestedVideoAngle: "When the US president says an ally has 'no judgment' — repeatedly, in public — what does it mean for the US-Israel relationship and Israel's security?",
    possibleCatMetaphor: "Owner publicly yells at the cat on live TV: 'Stop knocking things off the shelf!' Cat stares into the distance and says nothing.",
    videoPotential: 5,
    riskLevel: 'low',
    productionReadiness: 'ready_for_review',
    notes: 'Multiple direct quotes well-sourced across Israel Hayom, Arutz Sheva, i24NEWS. Very high audience interest. Immediate clear hook.',
    matchFn: (item) => /trump.*netanyahu|netanyahu.*trump|f.*ing judgment|trump slams.*netanyahu|trump.*difficult.*netanyahu|casts doubt.*netanyahu|bibi.*wants.*continue|without me.*no israel|trump.*purge.*deal.*opponent|trump.*targets.*netanyahu|trump.*thinks.*bibi/i.test(_text(item)),
  },

  {
    id: 'SC-008',
    clusterName: "Israel's right-wing blasts the Iran deal — Netanyahu says Israel 'will not be bound by it'",
    clusterType: 'domestic_politics',
    eventSummary: "Israeli coalition partners Smotrich and Ben Gvir, along with former IDF Chief Eisenkot and others, publicly condemned the US-Iran deal as dangerous and urged Netanyahu to resist it. Netanyahu is defending the deal while asserting Israel is 'not bound' by it. Reports say Trump threatened to purge deal opponents within his own administration.",
    framingConflict: "Netanyahu camp: the deal is the best available outcome, Israel will coordinate but is not legally bound. Right-wing opposition: Israel just surrendered its deterrence. Eisenkot: the deal endangers Israeli security.",
    missingContext: "What does 'Israel is not bound by the deal' actually mean in practice — legally and militarily? If Israel acts against the deal, what are the US consequences? Can Israel sustain pressure on Iran without US support?",
    suggestedVideoAngle: "Israel says it is not bound by the Iran deal. What happens when it acts against it? An honest look at Israel's actual leverage — and its limits.",
    possibleCatMetaphor: "Family cat signed a peace treaty with the neighborhood dog. Cat says it did not agree and will scratch the dog anyway. Owner is very nervous.",
    videoPotential: 3,
    riskLevel: 'low',
    productionReadiness: 'ready_for_review',
    notes: 'Good domestic politics companion to SC-007. Lower urgency individually but strong as part of an Iran deal series.',
    matchFn: (item) => /smotrich.*iran.*deal|smotrich.*agreement.*bad|smotrich.*iran|eisenkot.*iran|ben.{0,5}gvir.*iran.*deal|iran.*deal.*draws.*fire|blast.*netanyahu.*over.*iran|israeli.*anger.*iran.*deal|israel.*not.*bound.*iran|iran.*deal.*israel.*political|iran deal.*opponents.*israel|iran.*deal.*dangerous.*israel|israel.*political.*spectrum.*iran/i.test(_text(item)),
  },

  {
    id: 'SC-009',
    clusterName: 'US moves 20% of aerial refueling jets away from Israel amid deal talks',
    clusterType: 'single_event',
    eventSummary: "The US reportedly moved approximately 20% of its aerial refueling aircraft from an Israeli airport during the Iran deal negotiations. This is strategically significant because refueling jets extend the range of Israeli warplanes — including for potential strikes on Iran. Separately, the US secretly moved 200 naval ships through the Strait of Hormuz under Iranian surveillance during the crisis.",
    framingConflict: "US: routine repositioning. Israeli analysts: this is a direct constraint on Israel's ability to independently strike Iran, timed to the deal. Not covered by mainstream media as a strategic signal.",
    missingContext: "Which Israeli airport? Were the jets a key enabler of the planned (then halted) IAF Iran strike? Is this permanent or temporary? Is it connected to the deal or coincidental? Connect to SC-001.",
    suggestedVideoAngle: "The US quietly moved refueling jets away from Israel right as it was negotiating with Iran. This is not a logistics story — it is about whether Israel can still independently strike Iran.",
    possibleCatMetaphor: "Owner quietly moved the cat's climbing tree away from the window. Cat can no longer reach the bird feeder. Nobody officially explained why.",
    videoPotential: 4,
    riskLevel: 'medium',
    productionReadiness: 'needs_fact_check',
    notes: 'High strategic significance if confirmed. Verify JNS sourcing and which Israeli base. Cross-ref with SC-001 (IAF strike halted). The 200 ships figure needs independent confirmation.',
    matchFn: (item) => /refueling.*jets.*israel|jets.*israel.*airport|20.*percent.*refueling|us.*move.*refueling|us.*moved.*jets.*israel|200.*ships.*hormuz|ships.*hormuz.*iran|us.*secret.*hormuz|hormuz.*secret.*us|us.*naval.*hormuz/i.test(_text(item)),
  },

  {
    id: 'SC-010',
    clusterName: "Trump arrives at G7 with Iran deal secured — G7 endorses, Netanyahu skips",
    clusterType: 'diplomacy',
    eventSummary: "Trump traveled to the G7 summit with the Iran deal as his signature achievement. G7 leaders formally endorsed the framework. Netanyahu was notably absent — he did not attend while Trump met with Arab leaders to discuss the deal structure. The G7 endorsement also covered increased Ukraine support.",
    framingConflict: "Trump and G7 frame the deal as a global diplomatic success. Israeli observers note Netanyahu was excluded from the key diplomatic moment. FDD: G7 endorsement adds no verification or enforcement to an already-weak MoU.",
    missingContext: "Did the G7 endorse specific MoU terms or just the general framework? What did Netanyahu's absence signal — a snub, or that Israel was effectively sidelined? Which Arab leaders were consulted, and what were their conditions?",
    suggestedVideoAngle: "Trump came to the G7 with an Iran deal. The world cheered. Israel was not in the room. What the G7 endorsement means — and does not mean.",
    possibleCatMetaphor: "Owner announces a new house policy. All the neighbors agree it is great. The cat was not consulted and did not attend the meeting.",
    videoPotential: 3,
    riskLevel: 'low',
    productionReadiness: 'ready_for_review',
    notes: 'Important diplomatic context for the deal story arc. Best used as a companion to SC-007 and SC-008.',
    matchFn: (item) => /g7.*iran|iran.*g7|trump.*g7.*deal|g7.*endors.*iran|netanyahu.*skip.*g7|g7.*summit.*iran/i.test(_text(item)),
  },

  // ── HEZBOLLAH / LEBANON ───────────────────────────────────────────

  {
    id: 'SC-011',
    clusterName: "Hezbollah fires rockets and drones at Israel despite 'all fronts' ceasefire in deal",
    clusterType: 'single_event',
    eventSummary: "Despite the US-Iran deal announcing a ceasefire 'on all fronts,' Hezbollah fired rockets and drones at Israeli territory. The IDF intercepted multiple launches. Red alert sirens sounded in Eilat. Iran also launched drones toward the Strait of Hormuz overnight after the deal was announced. The IAF destroyed a Hezbollah launcher in Southern Lebanon.",
    framingConflict: "Western media covered the deal signing as bringing quiet. Israeli media covered the ongoing attacks. Hezbollah did not formally acknowledge being covered by the deal. Iranian state media blamed Israel's 'violations' for ongoing fire.",
    missingContext: "Is Hezbollah acting independently from Iran, or with Iranian authorization? Did Iran signal to Hezbollah to continue firing as leverage to enforce deal compliance from Israel? These ongoing attacks directly contradict the deal's 'ceasefire on all fronts' claim.",
    suggestedVideoAngle: "The deal was signed. The rockets kept flying. How Hezbollah's continued attacks are already exposing the gap between the Iran deal and reality on the ground.",
    possibleCatMetaphor: "Owner signed a 'no scratching' agreement on behalf of all the cats. The cat in the basement did not get the memo.",
    videoPotential: 5,
    riskLevel: 'low',
    productionReadiness: 'ready_for_review',
    notes: 'High news value. Directly contradicts the deal narrative. Multiple Israeli sources confirm attacks post-announcement. Pair with SC-004 (Lebanon in deal) for maximum impact.',
    matchFn: (item) => /rocket.*despite.*deal|despite.*deal.*rocket|drone.*despite.*deal|despite.*deal.*drone|hezbollah.*fire.*rocket|hezbollah.*fired|red alert.*eilat|eilat.*red alert|missile.*lebanon.*strike.*israel|iaf.*intercept.*rocket|rocket.*southern.*lebanon|iran.*drone.*hormuz.*overnight|iran.*launches.*drone.*despite.*deal|ceasefire.*hold\?|fire.*despite.*ceasefire|hezbollah.*attack.*despite/i.test(_text(item)),
  },

  {
    id: 'SC-012',
    clusterName: "Israel strikes Beirut's Dahiyeh during deal talks — Trump says 'shouldn't have happened'",
    clusterType: 'single_event',
    eventSummary: "Israel struck Hezbollah targets in Beirut's Dahiyeh district while the US-Iran deal was being finalized. Trump publicly said the strike 'shouldn't have happened' and reportedly told Netanyahu 'What the **** are you doing?' FDD reported the strikes could complicate the final deal. Israel framed them as a response to drone attacks.",
    framingConflict: "Israel: legitimate response to prior drone attacks. Trump: Israel destabilized the deal at a critical moment. FDD: the strikes exposed that Lebanon is being traded away — Israel was demonstrating it won't accept that. Iranian media: proof Israel violates any ceasefire.",
    missingContext: "What drone attacks immediately preceded the Israeli strikes? Was the Dahiyeh timing a deliberate Netanyahu signal that Israel won't be bound by the deal before it was signed? What US-Israel communication occurred in those hours?",
    suggestedVideoAngle: "Israel bombed Beirut's Dahiyeh while Trump was finalizing the Iran deal. What happened in those hours — and what it tells us about US-Israel coordination breaking down.",
    possibleCatMetaphor: "Cat knocks the expensive vase off the shelf right as guests arrive for dinner. Owner apologizes to the guests. The cat does not.",
    videoPotential: 4,
    riskLevel: 'low',
    productionReadiness: 'ready_for_review',
    notes: "Trump and Netanyahu statements both well-sourced. Cross-reference timing: which came first, strikes or deal announcement? Pair with SC-007 (Trump attacks Netanyahu).",
    matchFn: (item) => /dahiyeh|israel.*strike.*beirut|strike.*beirut.*iran|beirut.*strike.*iran.*deal|trump.*beirut.*shouldn|shouldn.*happened.*iran.*deal|trump.*close.*to.*iran.*deal|trump rejects.*israel.*strike|israel.*responds.*drone.*beirut|trump.*israel.*right.*defend.*but|israel.*strike.*shouldn/i.test(_text(item)),
  },

  // ── GAZA ─────────────────────────────────────────────────────────

  {
    id: 'SC-013',
    clusterName: "IDF eliminates Hamas commanders while releasing Hamas co-founder — the same week",
    clusterType: 'single_event',
    eventSummary: "In the same period, the IDF confirmed eliminating two Hamas commanders involved in October 7 and two Hamas financial officials in Gaza — while releasing Hamas co-founder Hassan Yousef after 2.5 years in Israeli detention. The IDF also killed Hezbollah commander Ali Daqduq, who built Iran-backed militias in Iraq.",
    framingConflict: "IDF frames eliminations as operational progress, releases as unrelated. Arab media frames eliminations as escalation while ignoring the release. The simultaneous elimination-and-release dynamic is not explained by either side and is largely absent from media coverage.",
    missingContext: "Why was Hassan Yousef released now, specifically during active ceasefire talks and an Iran deal signing? Is there a quiet exchange arrangement? Are the Gaza financial officials linked to the stalled Cairo talks?",
    suggestedVideoAngle: "The same week Israel killed Hamas commanders, it released a senior Hamas co-founder. Neither side is explaining the connection. What is actually happening in Gaza?",
    possibleCatMetaphor: "Cat catches two mice — then lets a third, bigger mouse go free, acting like nothing happened.",
    videoPotential: 4,
    riskLevel: 'medium',
    productionReadiness: 'needs_fact_check',
    notes: 'Hook: juxtaposition of eliminations + Yousef release. Verify timeline overlap and whether these events are connected or coincidental.',
    matchFn: (item) => /hassan yousef|hamas.*co.{0,3}founder.*releas|co.{0,3}founder.*hamas.*releas|hamas.*financial.*official|financial.*official.*hamas|oct\.?\s*7.*commander.*eliminat|eliminat.*hamas.*commander|eliminat.*two.*hamas|two.*hamas.*commander|daqduq|daqdouq/i.test(_text(item)),
  },

  {
    id: 'SC-014',
    clusterName: 'Gaza ceasefire talks stall in Cairo over Hamas disarmament demand',
    clusterType: 'single_event',
    eventSummary: "Gaza ceasefire negotiations in Cairo have stalled. The central sticking point is Israel's demand for Hamas disarmament, which Hamas categorically refuses. This is a separate diplomatic track from the broader US-Iran deal ceasefire, which creates public confusion about the overall ceasefire picture.",
    framingConflict: "Israel: no sustainable ceasefire without Hamas disarmament. Hamas: disarmament is a red line — it ends the resistance. Western media often omits the disarmament demand and frames the breakdown as Israeli intransigence or 'both sides' failing to agree.",
    missingContext: "Has Egypt proposed any middle-ground formulas on weapons? What is Qatar's position? Why is this Gaza track collapsing at the exact moment a broader Iran deal ceasefire was announced?",
    suggestedVideoAngle: "Gaza ceasefire talks just collapsed in Cairo — and most coverage is not telling you why. The Hamas disarmament demand is the story.",
    possibleCatMetaphor: "Two cats negotiating over the food bowl. One demands the other remove its claws as a precondition. The clawed cat says that is a non-starter. Talks stall.",
    videoPotential: 3,
    riskLevel: 'low',
    productionReadiness: 'needs_more_sources',
    notes: 'Important but limited sourcing (mainly i24NEWS). Needs additional voices on what specifically broke down in Cairo and what Egypt proposed.',
    matchFn: (item) => /cairo.*stall|stall.*cairo|ceasefire.*talks.*stall|stall.*ceasefire.*talk|hamas.*disarmament|disarmament.*hamas|ceasefire.*cairo|cairo.*ceasefire.*talk/i.test(_text(item)),
  },

  // ── SOMALILAND ────────────────────────────────────────────────────

  {
    id: 'SC-015',
    clusterName: "Somaliland's historic first state visit to Israel — and Al-Shabab threatens revolt",
    clusterType: 'diplomacy',
    eventSummary: "Somaliland's president made the first-ever state visit to Israel, formalizing diplomatic relations. President Herzog hosted him in Jerusalem. Israel's defense minister revealed longstanding covert security cooperation. Sa'ar confirmed a secret preparatory meeting. Al-Shabab called on Somaliland's Muslim population to revolt in response.",
    framingConflict: "Israel: successful normalization with a strategically placed Horn of Africa entity. Somali Federal Government: the tie-up is illegal since Somaliland is internationally unrecognized. Al-Shabab: religious betrayal warranting revolt. Arab media: another Arab/Muslim partner normalizing with Israel.",
    missingContext: "Why did Israel prioritize Somaliland now — Red Sea access, port rights, counterterrorism intelligence? How does this connect to the Abraham Accords strategy? How credible is the Al-Shabab revolt threat?",
    suggestedVideoAngle: "Israel just normalized with a country that does not officially exist. Here is why Somaliland matters — and why Al-Shabab is now threatening revolt over it.",
    possibleCatMetaphor: "The stray cat nobody officially owns just got a name, a collar, and a feeding schedule. The neighborhood cats are furious.",
    videoPotential: 4,
    riskLevel: 'low',
    productionReadiness: 'ready_for_review',
    notes: 'Underreported story with strong geopolitical angle. Al-Shabab reaction adds conflict and urgency. Verify: is the revolt call an official Al-Shabab communiqué or a statement by affiliated clerics?',
    matchFn: (item) => /somaliland/i.test(_text(item)),
  },

  // ── DOMESTIC ISRAEL ───────────────────────────────────────────────

  {
    id: 'SC-016',
    clusterName: 'Haredi draft protests escalate during wartime: highways blocked, home front emergency extended',
    clusterType: 'domestic_politics',
    eventSummary: "Ultra-Orthodox (haredi) anti-draft protests escalated with blockades on major Israeli highways including Bar Ilan Street in Jerusalem. The government extended the home front state of emergency. Home Front Command limited gatherings to 5,000 people. The protests are happening as Israel simultaneously fights on multiple fronts.",
    framingConflict: "Haredi leadership: compulsory IDF service violates religious rights and the established way of life. Israeli mainstream and IDF families: in a war, everyone must serve. Coalition: the government cannot afford to lose haredi parties, even during active combat.",
    missingContext: "How large are the protests relative to the total haredi population? Are haredi political leaders actively encouraging the road blockades? What is the current legal status of the yeshiva student draft exemption?",
    suggestedVideoAngle: "While Israel fights on multiple fronts, ultra-Orthodox protesters are blocking highways to avoid being drafted into the army. Inside the domestic crisis nobody outside Israel is covering.",
    possibleCatMetaphor: "Some cats refuse to help guard the house. They say guarding is not their job. The house is currently on fire.",
    videoPotential: 3,
    riskLevel: 'low',
    productionReadiness: 'ready_for_review',
    notes: 'Strong contrast angle (wartime + anti-draft protests). Good visual story. Lower international interest but important context for Israel-focused audience.',
    matchFn: (item) => /haredi|anti.{0,5}draft|bar ilan|orthodox.*protest|draft.*protest|home front.*command|home front.*emergency|emergency.*home front|orthodox.*block.*highway|highway.*block.*israel|haredi.*escalat/i.test(_text(item)),
  },

  // ── SECURITY CONTEXT ──────────────────────────────────────────────

  {
    id: 'SC-017',
    clusterName: "Houthis threaten to resume attacks on Israel despite Iran deal — call US 'brought to its knees'",
    clusterType: 'security_context',
    eventSummary: "Senior Houthi officials declared they will resume attacks on Israel and framed the US-Iran deal as a Houthi and Iranian victory. Houthi propaganda stated 'the US has been brought to its knees.' The Houthis explicitly say they are not bound by any ceasefire they did not negotiate or sign.",
    framingConflict: "Iran deal sold as achieving regional quiet. Houthis — an Iranian proxy — are publicly refusing to comply and are celebrating the deal as an Iranian win, not a concession. Media coverage of the deal largely ignores this contradiction.",
    missingContext: "Houthis have been under sustained US military pressure including strikes near Hormuz. Are they operationally capable of threatening Israel after those strikes? Is this genuine threat or face-saving performance?",
    suggestedVideoAngle: "The Iran deal was supposed to bring quiet on all fronts. The Houthis say they did not get the memo — and are threatening to keep attacking Israel anyway.",
    possibleCatMetaphor: "Owner signed peace treaty on behalf of all the cats. The cats in the back room were not consulted. They said so, loudly.",
    videoPotential: 3,
    riskLevel: 'medium',
    productionReadiness: 'needs_more_sources',
    notes: 'MEMRI-sourced. Verify translation accuracy and that quotes represent official Houthi leadership positions, not fringe voices. Check against Houthi operational capacity after US strikes.',
    matchFn: (item) => /houthi/i.test(_text(item)),
  },

  {
    id: 'SC-018',
    clusterName: "Iran-backed Iraqi militias celebrate Iran deal while releasing attack footage and rejecting disarmament",
    clusterType: 'security_context',
    eventSummary: "Iran-backed militias in Iraq, including the Sayyid al-Shuhada Brigades, publicly celebrated the US-Iran deal as proof of Iranian and Houthi victory, while simultaneously releasing drone and missile attack footage and explicitly rejecting disarmament. A militia leader attended the Russian Embassy in Baghdad.",
    framingConflict: "Deal supporters claim Iran can deliver proxy compliance. Iranian-backed militias in their own statements celebrate the deal AND affirm continued armed resistance AND reject disarmament. The gap between the deal's promise and proxy behavior is in their own words.",
    missingContext: "Does the US-Iran deal include any proxy disarmament requirement? If not, Iran's proxies continue operating with zero accountability under the deal. Who enforces compliance and how?",
    suggestedVideoAngle: "Iran signed a ceasefire deal. Its Iraqi militias are celebrating by releasing attack videos and saying they will keep fighting. Nobody is stopping them.",
    possibleCatMetaphor: "Owner signed a 'no biting' agreement. The cat's kittens were not part of the agreement and are still biting everyone. Owner says kittens are technically independent.",
    videoPotential: 3,
    riskLevel: 'medium',
    productionReadiness: 'needs_fact_check',
    notes: 'MEMRI-sourced. Verify militia quotes are genuine and accurately translated. Strong factual contrast angle if verified — the contradiction is in their own statements.',
    matchFn: (item) => /sayyid.*al.{0,5}shuhada|kataib|iran.{0,10}back.*militia.*celebrat|iraq.*militia.*reject.*disarm|iran.{0,10}back.*iraq.*reject|hacker.*irgc.*facilitat|militia.*celebrat.*iran.*deal|iran-backed.*militia.*iraq|iraq.*militia.*iran.*deal/i.test(_text(item)),
  },

  // ── MEDIA FRAMING / ACCOUNTABILITY ───────────────────────────────

  {
    id: 'SC-019',
    clusterName: 'UNRWA fires 70 more Gaza staff over Hamas ties — running total passes 100',
    clusterType: 'media_framing_conflict',
    eventSummary: "UNRWA fired 70 Gaza staff following a US aid watchdog probe finding Hamas links. HonestReporting previously documented 101 UNRWA employees exposed as Hamas operatives or affiliates. Each batch of firings is reported as a one-off accountability story; the cumulative pattern is rarely aggregated.",
    framingConflict: "UNRWA: internal accountability is working, firings prove our system functions. Pro-Israel analysts: the cumulative count (100+) proves systemic infiltration, not isolated edge cases. Media: each wave covered as a standalone story, never connecting the total or asking whether UNRWA leadership knew.",
    missingContext: "What percentage of UNRWA's Gaza workforce does 100+ represent? What specific Hamas roles did these employees hold? Did UNRWA management know? Will cumulative firings affect US or EU funding decisions?",
    suggestedVideoAngle: "UNRWA just fired 70 more staff for Hamas ties. The running total is now over 100. At what point is this a systemic problem rather than an accountability success story?",
    possibleCatMetaphor: "You fired the cat for scratching the couch. Then hired another cat. It also scratched the couch. You are proud of how quickly you responded.",
    videoPotential: 4,
    riskLevel: 'medium',
    productionReadiness: 'needs_fact_check',
    notes: "Verify: HonestReporting's '101' and the new '70' — are these additive or overlapping? The cumulative framing is the hook. Cross-reference UNRWA funding implications.",
    matchFn: (item) => /unrwa/i.test(_text(item)),
  },

  {
    id: 'SC-020',
    clusterName: 'EU mulls trade sanctions on Israel over West Bank — Czechia threatens to veto',
    clusterType: 'policy_debate',
    eventSummary: "The EU is considering targeting trade with Israel over Judea and Samaria settlements. The EU's foreign policy chief reportedly likened Israel's treatment of Palestinians to apartheid. Czechia announced it will block EU sanctions targeting Ben-Gvir, calling them a 'political gift.' Israeli defense industry booths were blocked at the Eurosatory arms show in France.",
    framingConflict: "EU leadership frames sanctions as human rights enforcement. Israel frames it as discriminatory targeting of a democracy at war. Czechia's veto threat reveals deep EU internal divisions on Israel policy — the EU cannot act unanimously.",
    missingContext: "What specific trade would be targeted — settlement goods only, or broader Israeli exports? What is the required vote threshold in the EU Council? Can Czechia and Hungary block it indefinitely? What triggered the Eurosatory exclusion now?",
    suggestedVideoAngle: "The EU wants to sanction Israel over the West Bank. One country is blocking it. Here is why Europe can never agree on Israel — and what it means for Israeli exports.",
    possibleCatMetaphor: "The cat committee voted to ban the cat from the couch. One cat voted against. The vote fails. The cat is still on the couch.",
    videoPotential: 3,
    riskLevel: 'low',
    productionReadiness: 'needs_more_sources',
    notes: "Kallas 'apartheid' quote requires sourcing verification and full context. Eurosatory exclusion is well-documented. Needs more detail on specific trade targets.",
    matchFn: (item) => /eu.*mull.*israel|eu.*target.*trade.*israel|eu.*sanction.*israel|eu.*judea.*samaria|kallas.*israel|apartheid.*israel|eu.*west.*bank|czechia.*sanction|czech.*block.*sanction|eurosatory.*israel|israel.*eurosatory|ben.{0,5}gvir.*sanction.*eu/i.test(_text(item)),
  },

];
// ─────────────────────────────────────────────────────────────────────────────

function _text(item) {
  return ((item.title || '') + ' ' + (item.excerpt || '') + ' ' + (item.contentSnippet || '')).toLowerCase();
}

function isJunk(item) {
  const t = (item.title || '').trim();
  return !t ||
    /^Home \d+$/.test(t) ||
    /^www\./.test(t) ||
    /Archives/.test(t) ||
    t === 'Home | English' ||
    t === '- www.israelhayom.com';
}

function truncate(str, max = 49000) {
  return str.length > max ? str.substring(0, max - 15) + '[...TRUNCATED]' : str;
}

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_BASE64;
  const json = raw || Buffer.from(b64, 'base64').toString('utf8');
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(json),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function readRawNews(sheets, daysBack) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Raw News'!A:L",
  });
  const rows = res.data.values || [];
  if (rows.length <= 1) return [];

  const headers = rows[0];
  return rows.slice(1)
    .map((row, idx) => {
      const obj = { _rowIndex: idx + 2 };
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    })
    .filter(item => {
      if (isJunk(item)) return false;
      if (!item.publishedAt) return false;
      const d = new Date(item.publishedAt);
      return !isNaN(d) && d >= cutoff;
    });
}

async function ensureStoryClustersTab(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existing = new Set(meta.data.sheets.map(s => s.properties.title));
  if (!existing.has('Story Clusters')) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: 'Story Clusters' } } }] },
    });
    console.error('Created Story Clusters tab');
  }
}

async function resetStoryClusters(sheets) {
  // Get current row count
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Story Clusters'!A:A",
  });
  const rowCount = (res.data.values || []).length;
  if (rowCount > 1) {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'Story Clusters'!A2:Z${Math.max(rowCount + 20, 200)}`,
    });
    console.error(`Cleared ${rowCount - 1} old cluster rows`);
  }
  // Write new schema headers
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Story Clusters'!A1",
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [CLUSTER_HEADERS] },
  });
  console.error('Updated Story Clusters headers to new schema');
}

function applyStoryFrames(items) {
  const clusters = STORY_FRAMES.map(f => ({ frame: f, items: [] }));
  const unmatched = [];

  for (const item of items) {
    let matched = false;
    for (const cluster of clusters) {
      if (cluster.frame.matchFn(item)) {
        cluster.items.push(item);
        matched = true;
        break; // first match wins
      }
    }
    if (!matched) unmatched.push(item);
  }
  return { clusters, unmatched };
}

function buildClusterRow(frame, items, now) {
  const uniqueSources = [...new Set(items.map(i => i.sourceName))];
  const relatedKeys = items.map(i => i.dedupeKey).filter(Boolean).join(',');
  return {
    clusterId:             frame.id,
    createdAt:             now,
    clusterName:           frame.clusterName,
    clusterType:           frame.clusterType,
    eventSummary:          frame.eventSummary,
    framingConflict:       frame.framingConflict,
    missingContext:        frame.missingContext,
    suggestedVideoAngle:   frame.suggestedVideoAngle,
    possibleCatMetaphor:   frame.possibleCatMetaphor,
    mainSources:           uniqueSources.join(', '),
    sourceCount:           String(uniqueSources.length),
    relatedRawNewsKeys:    truncate(relatedKeys),
    videoPotential:        String(frame.videoPotential),
    riskLevel:             frame.riskLevel,
    productionReadiness:   frame.productionReadiness,
    status:                'pending_review',
    notes:                 frame.notes || '',
  };
}

async function writeClusterRows(sheets, clusterData) {
  if (clusterData.length === 0) { console.error('No clusters to write'); return; }
  const rows = clusterData.map(cd => CLUSTER_HEADERS.map(h => String(cd[h] || '')));
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: "'Story Clusters'!A1",
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
  console.error(`Wrote ${rows.length} cluster rows`);
}

async function markRawNewsClustered(sheets, rowIndices) {
  if (rowIndices.length === 0) return;
  const data = rowIndices.map(idx => ({
    range: `'Raw News'!L${idx}`,
    values: [['clustered']],
  }));
  const chunkSize = 500;
  for (let i = 0; i < data.length; i += chunkSize) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'USER_ENTERED', data: data.slice(i, i + chunkSize) },
    });
  }
  console.error(`Marked ${rowIndices.length} Raw News rows as "clustered"`);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun  = args.includes('--dry-run');
  const noClear = args.includes('--no-clear');
  const daysArg = args.find(a => /^--days=\d+$/.test(a));
  const daysBack = daysArg ? parseInt(daysArg.split('=')[1]) : 7;

  console.error(`story-clusterer | days=${daysBack} dry-run=${dryRun} no-clear=${noClear}`);

  const auth   = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // 1. Read recent raw news
  console.error('Reading Raw News...');
  const items = await readRawNews(sheets, daysBack);
  console.error(`Found ${items.length} clean recent items (last ${daysBack} days)`);

  // 2. Apply story frames
  const { clusters, unmatched } = applyStoryFrames(items);
  const now = new Date().toISOString();

  // 3. Filter: skip empty frames; skip single-item low-value clusters; warn on oversized
  const MIN_SINGLE_VP = 4; // minimum videoPotential to keep a single-item cluster
  const MAX_CLUSTER_SIZE = 15;

  const validClusters = [];
  const skipped = [];

  for (const { frame, items: ci } of clusters) {
    if (ci.length === 0) continue;
    if (ci.length === 1 && frame.videoPotential < MIN_SINGLE_VP) {
      skipped.push({ reason: 'single-item low-value', frame, items: ci });
      continue;
    }
    if (ci.length > MAX_CLUSTER_SIZE) {
      console.error(`WARNING ${frame.id} has ${ci.length} items (> ${MAX_CLUSTER_SIZE}) — consider splitting`);
    }
    validClusters.push({ frame, items: ci });
  }

  // 4. Print summary
  console.error('\n=== CLUSTER SUMMARY ===');
  validClusters.forEach(({ frame, items: ci }) => {
    const vp   = `VP:${frame.videoPotential}`;
    const prod = frame.productionReadiness.padEnd(22);
    const risk = frame.riskLevel.padEnd(8);
    console.error(`  [${frame.id}] ${vp} ${risk} ${prod} [${ci.length} items] ${frame.clusterName}`);
    ci.forEach(i => console.error(`    - [${i.sourceName}] ${i.title.substring(0, 90)}`));
  });
  if (skipped.length > 0) {
    console.error(`\nSKIPPED (${skipped.length} single-item low-value):`);
    skipped.forEach(({ frame, items: ci }) =>
      console.error(`  - ${frame.id}: ${ci[0].title.substring(0, 70)}`));
  }
  console.error(`\nUNMATCHED: ${unmatched.length} items`);
  if (unmatched.length > 0) {
    unmatched.forEach(i =>
      console.error(`  - [${i.sourceName}] ${i.title.substring(0, 80)}`));
  }
  console.error(`\nTotals: ${validClusters.length} clusters | ${validClusters.reduce((s, c) => s + c.items.length, 0)} items matched`);

  if (dryRun) {
    console.error('\n[DRY RUN] No changes written to Google Sheets.');
    return;
  }

  // 5. Write to Google Sheets
  await ensureStoryClustersTab(sheets);
  if (!noClear) await resetStoryClusters(sheets);

  const clusterData = validClusters.map(({ frame, items: ci }) => buildClusterRow(frame, ci, now));
  await writeClusterRows(sheets, clusterData);

  // 6. Mark matched Raw News rows as "clustered"
  const matchedIndices = validClusters.flatMap(({ items: ci }) => ci.map(i => i._rowIndex));
  await markRawNewsClustered(sheets, matchedIndices);

  console.error('\nStory clusterer complete.');
  console.log(JSON.stringify({
    clustersWritten: validClusters.length,
    itemsMatched: matchedIndices.length,
    itemsUnmatched: unmatched.length,
    itemsSkipped: skipped.length,
  }));
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
