"use strict";
// ── strings: ALL player-facing UI copy in ONE named table (i18n-ready) ───────
// The frontend half of the "strings named and in one file" deliverable
// (FIX_ITEMS.md). Every human-readable literal the UI renders lives here under a
// descriptive key; modules import `t` and look text up by key instead of hard-
// coding it. To localize later, swap STRINGS for another language's table — no
// renderer changes needed.
//
// Convention:
//  • Keys are dotted, namespaced by area (nav.market, newgame.title, queue.pass).
//  • Values are authored ENGLISH copy. They are TRUSTED authored content, so t()
//    returns them RAW. Where a caller interpolates t() output into innerHTML next
//    to UNTRUSTED data (a player lab name/ticker), that untrusted data must STILL
//    be run through core.esc() — t() does not escape and is not meant to.
//  • `{placeholder}` tokens are filled from the params object passed to t(); a
//    placeholder with no matching param is left as-is (visible, so a missing
//    value is caught in testing rather than silently blanked).
//
// What is NOT here: dict KEYS, action ids, handler names, CSS classes, element
// ids — those are code, not copy, and centralizing them would break the wiring.
// Authored CONTENT that already lives named in the backend (warning catalog,
// advance what_it_does/risk_blurb, benchmark blurbs, feed text) arrives through
// the observation and is rendered as-is; it is the backend's strings table, not
// duplicated here.

export const STRINGS = {
  // ── App shell ──────────────────────────────────────────────────────────────
  "app.title": "Alignment game",

  // ── Nav bar (index.html static labels, routed via data-i18n) ───────────────
  "nav.market": "Market",
  "nav.lab": "Lab",
  "nav.benchmarks": "Benchmarks",
  "nav.research": "Research",
  "nav.governance": "Governance",
  "nav.intel": "Intel",
  "nav.truth": "Truth",
  "nav.newGame": "new game",

  // ── Panel headings + descriptive prose (index.html static, via data-i18n) ──
  "panel.market.feed.heading": "Feed: findings · tips · events · news",
  "panel.market.caps.heading": "Market caps",
  "panel.market.info.heading": "Market information",
  "panel.lab.training.heading": "Model in training",
  "panel.lab.interventions.heading": "Safety interventions: fine-tuning",
  "panel.lab.pretrain.heading": "Pretrain run",
  "panel.lab.released.heading": "Released models (frozen · permanent attack surface)",
  "panel.benchmarks.heading": "Public benchmarks: the shared scoreboard",
  // NOTE: rendered as innerHTML (data-i18n-html) to keep the <b> emphasis — this
  // is AUTHORED copy, never untrusted data, so raw HTML here is safe.
  "panel.benchmarks.blurb": "Everyone sees every lab's scores, and they are read off <b>measured</b> capability, so a model that is sandbagging, meaning it hides what it can really do, looks clean here. These benchmarks are released free by the world, and old ones stop being useful as the frontier passes them. Chasing them to impress investors means improving the visible number instead of the real one.",
  "panel.research.capability.heading": "Capability research",
  "panel.research.safetyEvals.heading": "Safety evaluations",
  "panel.research.safetyAdvances.heading": "Safety advances: training",
  "panel.research.inProgress.heading": "In progress",
  "panel.research.completed.heading": "Completed advances",
  "panel.governance.heading": "Policies: lobby (pre-passage) · litigate (post-passage) · defect",
  "panel.governance.safeharbor.label": "sign safe-harbor code (penalty shelter)",
  "panel.intel.worry.heading": "Worry bar (level vs confidence, from the evidence you collected)",
  "panel.intel.evidence.heading": "Alignment evidence: what your evals and incidents have surfaced",
  "panel.intel.rivals.heading": "Rivals (public info only)",
  "panel.truth.heading": "Truth: full true state (debug)",
  // NOTE: rendered as innerHTML (data-i18n-html) to keep the <b> emphasis.
  "panel.truth.blurb": "Developer view only. This bypasses the true-versus-measured firewall the game is built on. It shows every lab's <b>true</b> alignment and capability, in red, beside what your instruments <b>measure</b>, including the hidden danger rivals are sandbagging. Expand a model to see its true trajectory turn by turn.",

  // ── Action bar (index.html static, via data-i18n) ──────────────────────────
  "actionbar.thisTurn": "this turn:",
  "actionbar.endTurn": "END TURN ▶",

  // ── Worry-bar inline labels (index.html static, via data-i18n) ─────────────
  "worry.level.inline": "level",
  "worry.confidence.inline": "confidence",

  // ── Top bar chips ──────────────────────────────────────────────────────────
  "topbar.policies.active": "active: {list}",
  "topbar.policies.none": "no active regulation",

  // ── New-game modal ─────────────────────────────────────────────────────────
  "newgame.title": "New game",
  "newgame.labName.label": "lab name",
  "newgame.labName.placeholder": "Your Lab",
  "newgame.ticker.label": "ticker",
  "newgame.ticker.placeholder": "YOU",
  "newgame.ticker.hint": "defaults to first 3 letters of the name",
  "newgame.seed.label": "seed",
  "newgame.difficulty.label": "difficulty",
  // difficulty option display labels (the <option value=…> stays the backend enum id)
  "newgame.difficulty.easy": "easy",
  "newgame.difficulty.medium": "medium",
  "newgame.difficulty.realistic": "realistic",
  "newgame.difficulty.impossible": "impossible",
  "newgame.guidance.label": "guidance",
  // guidance option display labels (the <option value=…> stays the backend enum id)
  "newgame.guidance.hint_heavy": "hint_heavy",
  "newgame.guidance.standard": "standard",
  "newgame.guidance.sparse": "sparse",
  "newgame.tutorial.label": "tutorial: walk me through the board first",
  "newgame.dev.label": "dev mode: reveal the god-view Truth tab (bypasses the firewall)",
  "newgame.start": "start",
  "newgame.cancel": "cancel",
  "newgame.multiplayer.create": "start multiplayer game",
  "newgame.multiplayer.join": "join multiplayer game",

  // ── Multiplayer lobby / barrier / admin (js/lobby.js) ───────────────────────
  // Per the copy standard (bars/caps/fees carry their actual value+scale), the
  // timer hint states the clamp range and the rival stepper its max.
  "mp.create.title": "Start a multiplayer game",
  "mp.create.start": "create lobby",
  "mp.join.title": "Join a multiplayer game",
  "mp.join.code.label": "lobby code",
  "mp.join.code.placeholder": "e.g. K7XQ2M",
  "mp.join.start": "join",
  "mp.back": "back",
  "mp.lobby.title": "Lobby — code {code}",
  "mp.lobby.shareHint": "share this code; friends pick “join multiplayer game” and enter it",
  "mp.lobby.waitingForHost": "waiting for the host to start…",
  "mp.lobby.rivals.label": "AI rivals (0–{max})",
  "mp.lobby.timer.label": "turn timer, seconds ({min}–{max}; empty = no timer)",
  "mp.lobby.timer.hint": "when it expires, whatever each player has queued is submitted (trimmed to budget); no timer = wait for everyone",
  "mp.lobby.start": "start game",
  "mp.lobby.kick": "kick",
  "mp.lobby.creatorTag": "host",
  "mp.lobby.youTag": "you",
  "mp.seat.connected": "connected",
  "mp.seat.disconnected": "away",
  "mp.seat.submitted": "ready",
  "mp.seat.waiting": "deciding",
  "mp.seat.ai": "AI-controlled",
  "mp.seat.autoPass": "auto-passing",
  "mp.banner.waiting": "waiting for players — {submitted}/{total} submitted",
  "mp.banner.submitted": "submitted — waiting for {remaining} more",
  "mp.chip.timer": "turn ends in {seconds}s",
  "mp.admin.open": "manage players",
  "mp.admin.title": "Manage players",
  "mp.admin.hint": "removing a player revokes their access; their lab stays in the world under the control you pick.",
  "mp.admin.replaceAI": "replace with AI",
  "mp.admin.autoPass": "auto-pass",
  "mp.admin.close": "close",
  "mp.leaderboard.title": "Final standings",
  "mp.leaderboard.col.lab": "lab",
  "mp.leaderboard.col.marketCap": "market cap",
  "mp.leaderboard.col.impact": "net impact",
  "mp.leaderboard.col.result": "result",
  "mp.leaderboard.human": "human",
  "mp.leaderboard.ai": "AI",
  "mp.kicked": "you were removed from the game by the host.",

  // ── Tutorial walkthrough (js/tutorial.js) ──────────────────────────────────
  // Directional, second-person guidance pointing the player at each surface in
  // turn. Kept plain so a placeholder ({current}/{total}) is the only token.
  "tutorial.stepCounter": "step {current} of {total}",
  "tutorial.back": "back",
  "tutorial.next": "next ▸",
  "tutorial.finish": "got it ✓",
  "tutorial.skip": "skip tutorial",
  "tutorial.welcome.title": "Welcome: you run an AI lab",
  "tutorial.welcome.body": "You are the CEO of a frontier AI lab, racing rivals to the top. The catch the whole game is built around: the market rewards what it can measure, while a model's true alignment stays hidden from you. This quick tour points you at each part of the board, and you stay in control the entire time.",
  "tutorial.market.title": "Market: your public scoreboard",
  "tutorial.market.body": "This home tab tracks your market cap against the rivals, with the feed of findings, tips, news, and events down the left. Market cap is the number everyone can see, and chasing it too hard will teach you why that is a trap. Read the feed every turn for hints about what is really happening.",
  "tutorial.lab.title": "Lab: build, shape, and ship models",
  "tutorial.lab.body": "Here you commission a pretrain run to build a model, run post-train rounds to shape it, and release it to earn revenue. The fine-tuning safety interventions are your levers to steer a model's behavior. Remember that a released model is frozen and stays out in the world permanently, so choose carefully before you ship.",
  "tutorial.benchmarks.title": "Benchmarks: the public scoreboard",
  "tutorial.benchmarks.body": "Everyone sees every lab's benchmark scores, all read off measured capability. A model that is hiding its true ability looks perfectly clean here. Investors love these numbers, which is exactly why optimizing for them and nothing else is a trap: you improve the visible score instead of the real thing.",
  "tutorial.research.title": "Research: your window into the hidden",
  "tutorial.research.body": "Capability projects push the frontier. Safety evaluations and safety advances are how you peek at the danger you cannot otherwise see. Spending here buys evidence about true alignment. Skip it and you are flying blind on the one thing the market never prices in.",
  "tutorial.intel.title": "Intel: true versus measured",
  "tutorial.intel.body": "The worry bar gathers the evidence you have collected into a level and a confidence. You never see a model's true alignment directly, only this read on it, and low confidence means you simply do not know yet. The rivals panel holds the public information you have on the competition.",
  "tutorial.governance.title": "Governance: the rules of the race",
  "tutorial.governance.body": "Lobby policies before they pass, litigate them afterward, or defect and break the rules at the risk of getting caught. Signing the safe-harbor code shelters you from some penalties. The whole field is active here, and your rivals are lobbying too.",
  "tutorial.endturn.title": "Taking a turn",
  "tutorial.endturn.body": "Queue your actions for the quarter, then press End Turn to advance time. Each turn you spend a work budget across projects, and the budget chip at the top tracks what is left. When you are ready, close this tour and take your first turn.",
  "tutorial.finish.title": "You're ready",
  "tutorial.finish.body": "That's the board. The lesson the game keeps teaching: hidden complexity is dangerous, and the measurable number is not the real one. Good luck, and keep an eye on what you cannot see.",

  // ── Post-mortem dialog ─────────────────────────────────────────────────────
  "postmortem.defaultResult": "GAME OVER",
  "postmortem.suffix": "post-mortem",
  "postmortem.voidedImpact.prefix": "Positive impact that was REAL and is now VOID: ",
  "postmortem.keyMoments.title": "The moments you couldn't see",
  "postmortem.keyMoments.empty": "none recorded",
  "postmortem.truthTable.title": "True vs measured: {model}",
  "postmortem.truthTable.turn": "turn",
  "postmortem.truthTable.trueGoalmis": "true goalmis",
  "postmortem.truthTable.measGoalmis": "meas goalmis",
  "postmortem.truthTable.trueDecep": "true decep",
  "postmortem.truthTable.measDecep": "meas decep",
  "postmortem.truthTable.conceal": "conceal",
  "postmortem.counterfactuals.title": "Where a different choice was available",
  "postmortem.counterfactuals.resimulated": "re-simulated on the same seed",
  "postmortem.counterfactuals.heuristic": "heuristic",
  "postmortem.newGame": "new game",
  "postmortem.inspectBoard": "inspect final board",

  // ── Feed item TYPE labels (collectFeed in core); message body is separate ──
  "feed.tip.label": "tip · {reliability}",
  "feed.event.label": "event · {category}",
  "feed.finding.label": "finding · {evidence}",
  "feed.news.label": "news",

  // ── Market / cap chart ─────────────────────────────────────────────────────
  "caps.empty": "no turns played yet. Press End Turn to begin.",
  "caps.inTraining": " (in training)",
  "caps.metric.marketCap": "market cap",
  "caps.metric.arr": "ARR",
  "caps.metric.pe": "P/E ratio",
  "caps.metric.yoy": "YoY growth",
  // dynamic quarter label on the cap-chart x-axis + the YoY percent reading
  "caps.quarterLabel": "Q{quarter} {year}",
  "caps.yoy.value": "{sign}{pct}%",

  // ── Lab — model in training ────────────────────────────────────────────────
  "training.empty": "none yet. Commission a pretrain run.",
  "training.rounds": "{rounds} rounds",
  "training.measuredGeneral": "measured general",
  "training.coding": "coding",
  "training.ceilingEst": "ceiling est",
  "training.dangerousEval": "dangerous-capability eval: {value}",
  "training.measuredAlignment": "measured alignment: goalmis {goalmis} · decep {decep} · evalaware {evalaware} · selfpres {selfpres} · jailbreak {jailbreak}",
  "training.projection.summary": "elicitation projection (capability only, alignment cost not shown)",
  "training.projection.moreRounds": "+{rounds} rounds",
  "training.release.label": "RELEASE this model (irreversible)",

  // ── Lab — post-train controls ──────────────────────────────────────────────
  "postTrain.empty": "no post-train safety advances researched yet. Research them in the Research tab, then apply them here.",
  "postTrain.heading": "Post-train this turn",
  "postTrain.runRound": "run a post-train round",
  "postTrain.explainer": "A round elicits capability; apply researched safety advances to shape the model AWAY from misalignment as it grows (the real lever).",

  // ── Lab — pretrain run ─────────────────────────────────────────────────────
  "pretrain.inProgress": "run in progress, ~{years}y left",
  "pretrain.unavailable": "unavailable (model in training, release it first)",
  "pretrain.compute.pre": "compute $",
  "pretrain.compute.maxNote": "(max {max})",
  "pretrain.queueRun": "queue run",
  "pretrain.computeHint": "bigger ceilings need more compute and better pretrain advances",
  "pretrain.safety.empty": "no pretrain safety advances researched yet. Research them to apply them to a run.",
  "pretrain.safety.apply": "apply researched pretrain safety advances to this run:",
  "pretrain.queued.prefix": "queued: ",
  "pretrain.queued.safetyNote": " · safety: {list}",
  // labeled-form field labels (structured controls, issue 4)
  "pretrain.field.compute": "compute",
  "pretrain.field.max": "ceiling",
  "pretrain.field.queued": "queued run",

  // ── Lab — released models ──────────────────────────────────────────────────
  "released.empty": "nothing released yet",
  "released.col.model": "model",
  "released.col.general": "general",
  "released.col.jbPublic": "jb-public",
  "released.yes": "yes",
  "released.no": "no",
  "released.leaked": "LEAKED",

  // ── Benchmarks panel ───────────────────────────────────────────────────────
  "benchmarks.empty": "no benchmarks released yet. Play a turn.",
  // METR-style horizon score units (numeric value formatted in code, passed as {value})
  "bench.horizon.min": "{value} min",
  "bench.horizon.hour": "{value} h",
  "bench.horizon.day": "{value} d",
  "bench.horizon.month": "{value} mo",
  "bench.horizon.year": "{value} yr",

  // ── Truth panel (debug god-view) ───────────────────────────────────────────
  "truth.empty": "no turns played yet. Press End Turn to begin.",
  "truth.noModels": "no models exist yet on any lab",
  "truth.released": "released",
  "truth.inTraining": "in training",
  "truth.leaked": "LEAKED",
  "truth.col.axis": "axis",
  "truth.col.true": "true",
  "truth.col.measured": "measured",
  "truth.concealment": "concealment",
  "truth.foundationalFloor": "foundational floor",
  "truth.trajectory.summary": "per-turn trajectory ({count})",

  // ── Research panel ─────────────────────────────────────────────────────────
  "research.assistHint.noModel": "AI-assist needs a model to do the labor. You have none yet, so it has no effect. Train a model (even one still in post-training, before release) and it becomes available, growing more potent, and more contaminating, as capability rises.",
  "research.assistHint.weak": "AI-assist has little effect yet, because your model isn't capable enough to help research. It grows more potent, and more contaminating, as capability rises.",
  "research.assistHint.potent": "AI-assist potency {budget} (budget) and {speed} (speed). Assist now meaningfully shrinks budget and time, and it is also how contamination gets in.",
  "research.capability.empty": "tree exhausted",
  "research.safety.empty": "no safety evaluations available",
  "research.safetyAdvances.empty": "no training safety advances available",
  // Lab — safety interventions (fine-tuning ops on the model in training)
  "lab.interventions.empty": "no safety interventions available",
  "lab.interventions.hint": "Fine-tuning-style fixes for the model in training. The corrective effort lands at your next post-train round.",
  "research.completed.empty": "nothing researched yet",
  "research.completed.capability": "Capability",
  "research.completed.safety": "Safety",
  "research.inProgress.empty": "idle researchers",

  // ── Research-item cards (research.js) ───────────────────────────────────────
  "ritem.assist": "AI-assist",
  "ritem.assistUnavailable": "AI-assist · needs a model",
  "ritem.clickHint": "· click card for details &amp; warning ▸",
  "ritem.yearsRemaining": "~{years}y remaining",
  "ritem.assistTag": "assist {value}",
  "ritem.delegateLabel": "Delegate",
  "ritem.delegateHint": "Full handoff to the model — it runs the research loop. Same speed as assist=1, but contamination is substantially higher: the model is not helping, it is the researcher.",
  "ritem.delegateTag": "delegated",
  "ritem.safetyAdvance": "safety advance",
  "ritem.capability": "capability",
  "ritem.completedTag": "✓ {label}",
  "ritem.researchedTurn": "researched turn {turn}",

  // ── §7c warning modal (warnings.js) ────────────────────────────────────────
  "warning.linePrefix": "⚠ your researchers warn: ",
  "warning.why": "why this happens",
  "modal.evidence": "evidence: {evidence} · spoofability {spoofability}",
  "modal.intervenes": " · intervenes on {axis}",
  "modal.cost": "${cash}M · {years}y · work-budget {budget}",
  "modal.carryOut": "carry it out ▸",
  "modal.cancel": "cancel",

  // ── Intel — worry bar (structured status, issue 4) ─────────────────────────
  "worry.level.label": "level",
  "worry.confidence.label": "confidence",
  "worry.concern.label": "concern",
  "worry.evidence.label": "evidence",

  // ── Intel — alignment-evidence dossier (views.renderAlignmentEvidence) ──────
  // The raw findings the worry bar synthesizes, grouped by model. Curated project
  // names below; an unlisted project id falls back to a prettified id in the view.
  "intel.evidence.empty": "no alignment evidence collected yet. Run safety evaluations on the Research tab.",
  "intel.evidence.status.in_training": "in training",
  "intel.evidence.status.released": "released",
  "intel.evidence.status.earlier": "earlier model",
  "intel.evidence.source.external": "EXTERNAL incident",
  "intel.evidence.mech": "mechanistic",
  "intel.evidence.concern": "concern {value}",
  // evidence types (Finding.evidence): how strong a claim the finding supports
  "intel.evidence.kind.point": "point estimate",
  "intel.evidence.kind.bound": "lower bound",
  "intel.evidence.kind.existence": "existence proof",
  "intel.evidence.kind.null": "null result",
  "intel.evidence.kind.intervention": "intervention applied",
  // curated safety-project labels (the rest prettify their raw id)
  "intel.evidence.project.red_team": "red team",
  "intel.evidence.project.noise_injection": "noise injection",
  "intel.evidence.project.alignment_faking_study": "alignment-faking study",
  "intel.evidence.project.scalable_oversight": "scalable oversight",
  "intel.evidence.project.behavioral_evals": "behavioral evals",

  // ── Intel — rivals (structured card, issue 4) ──────────────────────────────
  "rivals.col.ticker": "ticker",
  "rivals.col.name": "lab",
  "rivals.col.cap": "market cap",
  "rivals.col.releases": "released",
  "rivals.col.frontier": "frontier ≈",
  "rivals.releases.unit": "{count} models",
  "rivals.frontier.unknown": "—",
  "rivals.disclosure.heading": "disclosed safety numbers (measured)",
  "rivals.disclosure.withheld": "withholding required disclosures (being fined)",
  "rivals.cap": "cap {cap} · {releases} releases",
  "rivals.frontier": " · frontier ≈ {value}",

  // ── Governance panel ───────────────────────────────────────────────────────
  "gov.enforce": "enforce: {level}",
  "gov.dormantNote": "not yet on the agenda. Early spend bets on what will matter.",
  "gov.lobby.label": "lobby",
  "gov.lobby.influenceNote": "influence = √spend × log(market-cap)",
  "gov.lit.status": "court {court} · margin {margin} · constitutionality {constitutionality} · standing {standing}",
  "gov.lit.label": "litigate",
  "gov.defect.label": "DEFECT (violate at catch-risk)",
  "gov.defect.preview": "⚠ catch ~{catch}%/yr · fine {fine} · approval −{approval}",
  "gov.defect.preview_certain": "⚠ always caught · fine {fine}/turn · approval −{approval}",
  "gov.lit.standingYes": "yes",
  "gov.lit.standingNo": "no",
  // short NEUTRAL inline descriptors — the full mechanism text moved to the modal
  "gov.category.dormant": "not yet on the agenda · pre-passage",
  "gov.category.preActive": "moving through the legislature · pre-passage",
  "gov.category.active": "in force · post-passage",
  "gov.detailsLink": "details ▸",
  "gov.rivalSpends.head": "rival spend",
  "gov.rivalSpends.empty": "no rival spend yet",
  // policy details modal (reuses the warnings.js #itemmodal pattern)
  "gov.modal.stageHeading": "Stage",
  "gov.modal.enforceHeading": "Enforcement",
  "gov.modal.litHeading": "Litigation",
  "gov.modal.effectHeading": "What it does",
  "gov.modal.close": "close",

  // ── Turn queue (renderQueue) ───────────────────────────────────────────────
  "queue.postTrain.withSafety": "post-train (+{count} safety)",
  "queue.postTrain.bare": "post-train round",
  "queue.release": "RELEASE",
  "queue.pass": "pass (do nothing)",
  // queued action verbs (the spend/tier/safety fragments are built in code → params)
  "queue.pretrain": "pretrain {compute}{safetyNote}",
  "queue.lobby": "lobby {stance} {policy}{spend}",
  "queue.litigate": "litigate {side} {policy} ({tier}{spend})",
  "queue.defect": "DEFECT {policy}",
  // queue-time affordability rejections (shown when an action won't fit this turn)
  "queue.cantAfford.budget": "can't queue: {over} over your work budget. Unqueue something, or add AI-assist to shrink it",
  "queue.cantAfford.cash": "can't queue: ${over}M over your cash on hand. Unqueue something first",
};

// Look up authored copy by key, filling any {placeholder} tokens from params.
// Returns the key itself if it's missing (so a typo shows up loudly in the UI
// instead of rendering an empty string). Output is RAW authored text — callers
// interpolating it next to untrusted data must still esc() that data.
export function t(key, params){
  const template = STRINGS[key];
  if(template === undefined) return key;        // loud miss, not a silent blank
  if(!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, token) => {
    const value = params[token];
    return value === undefined ? whole : String(value);
  });
}
