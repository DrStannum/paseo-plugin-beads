// @ts-check
/**
 * A standalone preview of the chart drawing layer (shared/charts/scene.ts +
 * client/charts/palette.ts), outside the Paseo app: every scene is turned
 * into markup with sceneToSvgMarkup — the very path the native renderer
 * takes — laid out in cards that mimic the panel's, and screenshotted in both
 * themes with the global Playwright.
 *
 *   node tests/charts-preview.mjs [outDir]     # default /tmp/beads-charts-preview
 *
 * This checks the geometry and the markup by eye; it is not the panel. The
 * real screenshots come from tests/shot.mjs once the views use these charts.
 * Synthetic fixture only (tests/fixture/data.mjs).
 */
process.env.TZ = 'UTC';

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
// @ts-ignore -- global install, no declarations
import { chromium } from '/usr/local/lib/node_modules/playwright/index.mjs';
// @ts-ignore -- plain JS fixture
import { FIXTURE, TEAM_NOW } from './fixture/data.mjs';
import {
  aggregateCuts, aggregateFlow, aggregatePeople, cohortTable, cutMax, etaOf, flowRunning, lineScene, pairedBarsScene,
  rollingMean, sceneToSvgMarkup, seriesBarsScene, smoothingWindow, sparklineScene, stackScene, stepDelta, tableScale,
  tipWhen, tempoLabel, barPercent, cohortWash, fmtEtaDate,
} from '../shared/charts/index.ts';
import { bucketToken, chartColors, colorResolver, labelSlots, mix } from '../client/charts/palette.ts';
import { STRINGS } from '../client/i18n/strings.ts';

const OUT = process.argv[2] || '/tmp/beads-charts-preview';
mkdirSync(OUT, { recursive: true });

/** Paseo's own theme colors (web-ui bundle, 0.15.4): light and the default dark. */
const THEMES = {
  light: {
    surface0: '#ffffff', surface1: '#fafafa', surface2: '#f4f4f5', border: '#e4e4e7', foreground: '#1a1a1e',
    foregroundMuted: '#71717a', accent: '#20744A', accentForeground: '#ffffff',
    statusSuccess: '#3e704a', statusWarning: '#7b5d39', statusDanger: '#9d433b',
  },
  dark: {
    surface0: '#181B1A', surface1: '#1E2120', surface2: '#272A29', border: '#252B2A', foreground: '#fafafa',
    foregroundMuted: '#A1A5A4', accent: '#20744A', accentForeground: '#ffffff',
    statusSuccess: '#6cb17b', statusWarning: '#c09664', statusDanger: '#d8847b',
  },
};

const ROWS = [...FIXTURE.tree.issues, ...FIXTURE.team];
const NOW = Date.parse(TEAM_NOW);
const W = 860; // plot width inside a card

/** @param {string} s */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * @param {'light'|'dark'} themeName @param {'en'|'ru'} lang
 */
function page(themeName, lang) {
  const t = STRINGS[lang];
  const colors = chartColors(THEMES[themeName]);
  const color = colorResolver(colors);
  /** @param {any} scene */
  const svg = (scene) => {
    const m = sceneToSvgMarkup(scene, color);
    if (!m.fits) throw new Error(`${scene.aria}: ${m.bytes} bytes`);
    return m.svg;
  };
  /** @param {{label: string, color: string, value?: number|string}[]} items */
  const legend = (items) => `<div class="legend">${items.map((it) =>
    `<span class="leg"><span class="sw" style="background:${color(it.color)}"></span>${esc(it.label)}${it.value != null ? `<b>${esc(String(it.value))}</b>` : ''}</span>`).join('')}</div>`;
  /** @param {string} title @param {string} aside @param {string} body */
  const card = (title, aside, body) =>
    `<div class="card"><div class="ch"><span class="ct">${esc(title)}</span><span class="aside">${esc(aside)}</span></div>${body}</div>`;

  const flow = aggregateFlow(ROWS, 90, NOW);
  const pts = flow.points;
  const starts = pts.map((p) => p.start);
  const step = flow.step;
  const stepCap = step === 'day' ? t.chartStepDay : step === 'week' ? t.chartStepWeek : t.chartStepMonth;
  const running = flowRunning(flow);
  const base = { starts, step, width: W, locale: t.locale };
  /** @param {number[]} values @param {number} i */
  const tipFor = (values, i) => {
    const d = stepDelta(values, i);
    const when = tipWhen(starts[i], step, t.locale);
    return d.first ? t.tipFirst(when, d.value) : t.tipOf(when, d.value);
  };
  const days = (/** @type {number} */ v) => t.flowDays(Math.round(v));
  /** @param {number} i @param {{name: string, value: number|null, fmt: (v: number) => string}[]} parts */
  const stepTip = (i, parts) => {
    const when = tipWhen(starts[i], step, t.locale);
    if (parts.every((p) => p.value == null)) return t.tempoTip(when, t.tipNothing);
    return t.tempoTip(when, parts.map((p) => t.tempoTipPart(p.name, p.value == null ? t.tipNothing : p.fmt(p.value))).join(' · '));
  };

  const blocks = [];

  // KPI tiles + ETA
  const tot = flow.totals;
  const tone = tot.net > 0 ? 'bad' : tot.net < 0 ? 'good' : 'flat';
  const tiles = [
    [t.flowKpiCreated, String(tot.created)], [t.flowKpiClosed, String(tot.closed)],
    [t.flowKpiNet, `${tot.net > 0 ? '+' : ''}${tot.net}`, tone, tot.net > 0 ? t.flowNetGrew : tot.net < 0 ? t.flowNetShrank : t.flowNetFlat],
    [t.flowKpiOpen, String(tot.openNow)], [t.flowKpiWip, String(tot.wipNow)],
    [t.flowKpiLead, tot.medianLead == null ? '—' : days(tot.medianLead)],
  ];
  blocks.push(`<div class="tiles">${tiles.map(([l, v, tn, note]) =>
    `<div class="tile"><div class="th">${esc(l)}</div><div class="tn" style="color:${tn === 'bad' ? colors.critical : tn === 'good' ? colors.good : colors.ink}">${esc(v)}</div>${note ? `<div class="note">${esc(note)}</div>` : ''}</div>`).join('')}</div>`);
  const eta = etaOf(flow);
  const etaText = eta.kind === 'clear' ? t.flowEtaClear : eta.kind === 'never' ? t.flowEtaNever : t.flowEtaValue(eta.steps, eta.step, fmtEtaDate(eta.at, t.locale));
  const etaNote = eta.kind === 'clear' ? t.flowEtaClearWhy : eta.kind === 'never' ? t.flowEtaNeverWhy(eta.net) : t.flowEtaBasis(eta.open, eta.rate, eta.step);
  blocks.push(`<div class="eta"><span class="th">${esc(t.flowEtaTitle)}</span><span class="etan" style="color:${eta.kind === 'never' ? colors.critical : colors.ink}">${esc(etaText)}</span><span class="tag" style="background:${mix(colors.warning, 16, colors.card)}">${esc(t.flowEtaMark)}</span><div class="note" style="flex-basis:100%">${esc(etaNote)}</div></div>`);

  // Pace
  const win = smoothingWindow(step);
  const created = pts.map((p) => p.created);
  const closed = pts.map((p) => p.closed);
  blocks.push(card(t.tempoTitle, t.tempoSmoothed(win, step),
    legend([{ label: t.tempoRaisingLine, color: 'muted' }, { label: t.tempoClosingLine, color: 'good' }]) +
    svg(lineScene({
      ...base, aria: t.tempoAria(pts.length), height: 180, running, runningLabel: t.tempoRunning,
      series: [{ values: rollingMean(created, win), color: 'muted' }, { values: rollingMean(closed, win), color: 'good' }],
      tip: (i) => t.tempoTip(tipWhen(starts[i], step, t.locale), `${t.tempoTipPart(t.tempoRaisingLine, created[i])} · ${t.tempoTipPart(t.tempoClosingLine, closed[i])}`),
    }))));

  // Opened and closed
  blocks.push(card(t.flowThroughput, stepCap,
    legend([{ label: t.flowOpened, color: 'muted', value: tot.created }, { label: t.flowClosed, color: 'good', value: tot.closed }]) +
    svg(pairedBarsScene({
      ...base, aria: t.flowThroughputAria(tot.created, tot.closed),
      left: { values: created, color: 'muted', tip: (i) => tipFor(created, i), key: 'opened' },
      right: { values: closed, color: 'good', tip: (i) => tipFor(closed, i), key: 'closed' },
    }))));

  // CFD
  const last = pts[pts.length - 1];
  blocks.push(card(t.flowCfd, stepCap,
    legend([{ label: t.flowDone, color: 'good', value: last.done }, { label: t.flowWip, color: 'accent', value: last.wip }, { label: t.flowWaiting, color: 'muted', value: last.waiting }]) +
    svg(stackScene({
      ...base, aria: t.flowScopeAria(tot.scope, last.done, last.wip, last.waiting), surface: 'card',
      layers: [{ values: pts.map((p) => p.done), color: 'good' }, { values: pts.map((p) => p.wip), color: 'accent' }, { values: pts.map((p) => p.waiting), color: 'muted' }],
    }))));

  // Waiting and working (gaps)
  blocks.push(card(t.flowTimesTitle, `${stepCap} · ${t.flowUnitDays}`,
    legend([{ label: t.flowTimesWait, color: 'muted' }, { label: t.flowTimesWork, color: 'accent' }]) +
    svg(lineScene({
      ...base, aria: t.flowTimesAria(pts.length), running, runningLabel: t.tempoRunning,
      series: [{ values: pts.map((p) => p.pickup), color: 'muted' }, { values: pts.map((p) => p.work), color: 'accent' }],
      tip: (i) => stepTip(i, [{ name: t.flowTimesWait, value: pts[i].pickup, fmt: days }, { name: t.flowTimesWork, value: pts[i].work, fmt: days }]),
    }))));

  // Predictability (band)
  blocks.push(card(t.flowPredTitle, `${stepCap} · ${t.flowUnitDays}`,
    legend([{ label: t.flowPredMedian, color: 'accent' }, { label: t.flowPredP85, color: 'accentSoft' }]) +
    svg(lineScene({
      ...base, aria: t.flowPredAria(pts.length), running, runningLabel: t.tempoRunning,
      series: [{ values: pts.map((p) => p.lead), color: 'accent', band: true }, { values: pts.map((p) => p.leadP85), color: 'accentSoft' }],
      tip: (i) => stepTip(i, [{ name: t.flowPredMedian, value: pts[i].lead, fmt: days }, { name: t.flowPredP85, value: pts[i].leadP85, fmt: days }]),
    }))));

  // Bugs share, fixed 100
  const pct = (/** @type {number} */ v) => t.flowPct(Math.round(v));
  blocks.push(card(t.flowBugsTitle, `${stepCap} · ${t.flowUnitShare}`,
    legend([{ label: t.flowBugsIn, color: 'muted' }, { label: t.flowBugsOut, color: 'good' }]) +
    svg(lineScene({
      ...base, aria: 'bugs', max: 100, fmt: pct, running, runningLabel: t.tempoRunning,
      series: [{ values: pts.map((p) => p.bugShareIn), color: 'muted' }, { values: pts.map((p) => p.bugShareOut), color: 'good' }],
      tip: (i) => stepTip(i, [{ name: t.flowBugsIn, value: pts[i].bugShareIn, fmt: pct }]),
    }))));

  // Cohorts (View-based in the client; HTML stand-in here)
  const coh = cohortTable(flow);
  const cohHead = [t.flowCohStep, t.flowCohRaised, ...[1, 2, 4].map((n) => t.flowCohWithin(n)), t.flowCohSoFar];
  blocks.push(card(t.flowCohTitle, stepCap, `<table class="coh"><tr>${cohHead.map((h, i) => `<th style="text-align:${i ? 'right' : 'left'}">${esc(h)}</th>`).join('')}</tr>${coh.map((r) =>
    `<tr><td class="when">${esc(tempoLabel(r.start, step, t.locale))}</td><td class="n">${r.raised}</td>${r.cells.map((c) => c.state === 'known'
      ? `<td class="cell" style="background:${mix(colors.good, cohortWash(c.share), colors.card)}">${esc(t.flowPct(c.share))}</td>`
      : '<td class="cell young">—</td>').join('')}</tr>`).join('')}</table>`));

  // Person: series bars + sparkline table rows
  const ppl = aggregatePeople(ROWS, 90, NOW);
  const sc = tableScale(ppl.people, (p) => p.closed);
  const first = ppl.people[0];
  blocks.push(card(t.pplTheirClosings, stepCap, svg(seriesBarsScene({
    starts: ppl.bounds, step: ppl.step, width: W, locale: t.locale, aria: t.pplClosingsAria(first.closed),
    series: { values: first.series, color: 'good', tip: (i) => `${i}` },
  }))));
  blocks.push(card(t.chartTabPeople, '', `<table class="ppl">${ppl.people.slice(0, 6).map((p) =>
    `<tr><td>${esc(p.name || t.chartUnassigned)}</td><td class="n">${p.closed}</td><td><div class="meter" style="background:${colors.grid}"><div style="width:${Math.round(p.closed / sc.meter * 100)}%;background:${colors.good}"></div></div></td><td>${
      svg(sparklineScene({ series: p.series, max: sc.spark, aria: t.pplTrendAria(p.closed), width: 120 }))}</td></tr>`).join('')}</table>`));

  // Breakdowns (View-based in the client; HTML stand-in)
  const cuts = aggregateCuts(FIXTURE.tree.issues);
  const slots = labelSlots(FIXTURE.tree.issues.flatMap((/** @type {any} */ r) => r.labels || []));
  const cutTitle = { assignee: t.fPerson, status: t.fStatus, priority: t.fPriority, readiness: t.fReadiness, type: t.fType, labels: t.fLabel };
  /** @param {string} key @param {any} b */
  const bucketLabel = (key, b) => b.kind === 'other' ? t.chartOther : b.kind === 'empty' ? (key === 'labels' ? t.chartNoLabels : t.chartUnassigned)
    : b.kind === 'unset' ? t.eUnset : key === 'status' ? t[`st_${b.key}`] || b.key : key === 'type' ? t[`ty_${b.key.replace(/-/g, '_')}`] || b.key
      : key === 'priority' ? t[`pri_${b.key}`] : key === 'readiness' ? (b.key === 'ready' ? t.onlyReady : b.key === 'blocked' ? t.onlyBlocked : t.chartOther) : b.key;
  blocks.push(`<div class="grid">${cuts.map((c) => `<div class="card"><div class="ct">${esc(cutTitle[c.key])}</div>${c.overCounts ? `<div class="note">${esc(t.chartTagsOverlap)}</div>` : ''}${
    c.buckets.map((b) => `<div class="row"><span class="lbl">${esc(bucketLabel(c.key, b))}</span><span class="track" style="background:${colors.grid}"><span class="bar" style="width:${barPercent(b.count, cutMax(c))}%;background:${color(bucketToken(c.key, b.key, b.kind, slots))}"></span></span><span class="n">${b.count}</span></div>`).join('')}</div>`).join('')}</div>`);

  // Edge cases: empty, a single step, huge values with gaps
  const one = [Date.UTC(2026, 7, 31)];
  blocks.push(card('edge: empty / single step / huge + gaps', '', [
    svg(lineScene({ starts: [], step: 'week', width: W, locale: t.locale, aria: 'empty', series: [{ values: [], color: 'accent' }], tip: () => '' })),
    svg(pairedBarsScene({ starts: one, step: 'day', width: W, locale: t.locale, aria: 'one', left: { values: [3], color: 'muted', tip: () => '' }, right: { values: [5], color: 'good', tip: () => '' } })),
    svg(stackScene({ starts: one, step: 'day', width: W, locale: t.locale, aria: 'one', surface: 'card', layers: [{ values: [4], color: 'good' }, { values: [2], color: 'accent' }, { values: [3], color: 'muted' }] })),
    svg(lineScene({
      starts: starts.slice(0, 10), step, width: W, locale: t.locale, aria: 'huge', running: true, runningLabel: t.tempoRunning,
      series: [{ values: [1e6, null, 2.5e6, 3e6, null, null, 4.2e6, null, 1e5, 9.9e6], color: 'accent' }], tip: () => '',
    })),
  ].join('')));

  const c = colors;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:18px;background:${c.page};color:${c.ink};font:14px -apple-system,system-ui,Segoe UI,Roboto,sans-serif}
  .card{background:${c.card};border:1px solid ${c.border};border-radius:10px;padding:12px 14px 14px;margin-bottom:14px}
  .ch{display:flex;justify-content:space-between;align-items:baseline}
  .ct,.th{font-size:.72rem;color:${c.muted};text-transform:uppercase;letter-spacing:.04em}
  .aside{font-size:.7rem;color:${c.muted}}
  .legend{display:flex;gap:12px;margin:6px 0 10px}.leg{display:inline-flex;gap:6px;align-items:center;font-size:.76rem;color:${c.ink2}}
  .leg b{color:${c.ink};font-weight:600}.sw{width:10px;height:10px;border-radius:3px;display:inline-block}
  svg{display:block}
  .tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px}
  .tile{background:${c.card};border:1px solid ${c.border};border-radius:10px;padding:10px 12px 12px}
  .tn{font-size:1.5rem;font-weight:650}.note{font-size:.72rem;color:${c.muted};margin-top:2px}
  .eta{display:flex;gap:10px;flex-wrap:wrap;align-items:baseline;background:${c.card};border:1px solid ${c.border};border-radius:10px;padding:10px 12px;margin-bottom:14px}
  .etan{font-weight:650}.tag{font-size:.66rem;text-transform:uppercase;letter-spacing:.06em;border:1px solid ${c.border};border-radius:999px;padding:1px 8px;color:${c.ink2}}
  .coh{border-spacing:2px;font-size:.78rem;width:100%}.coh th{font-size:.66rem;color:${c.muted};text-transform:uppercase;font-weight:500}
  .coh td{padding:5px 6px}.cell{text-align:right;border-radius:6px;background:${c.raised}}.young{background:transparent;color:${c.muted}}
  .when{color:${c.ink2}}.n{text-align:right;color:${c.muted}}
  .ppl{width:100%;font-size:.82rem}.meter{height:6px;width:140px;border-radius:9px;overflow:hidden}.meter div{height:100%;border-radius:9px}
  .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  .row{display:flex;gap:8px;align-items:center;padding:3px 0}.lbl{width:108px;font-size:.78rem;color:${c.ink2};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .track{flex:1;height:10px;border-radius:4px;overflow:hidden}.bar{display:block;height:100%;border-radius:0 4px 4px 0}
  </style></head><body>${blocks.join('\n')}</body></html>`;
}

const browser = await chromium.launch();
const files = [];
try {
  for (const [theme, lang] of /** @type {const} */ ([['dark', 'en'], ['light', 'ru']])) {
    const html = page(theme, lang);
    const file = path.join(OUT, `charts-${theme}-${lang}.html`);
    writeFileSync(file, html);
    const pg = await browser.newPage({ viewport: { width: 940, height: 900 }, deviceScaleFactor: 1 });
    await pg.goto(`file://${file}`);
    const png = path.join(OUT, `charts-${theme}-${lang}.png`);
    await pg.screenshot({ path: png, fullPage: true });
    files.push(png);
    await pg.close();
  }
} finally {
  await browser.close();
}
for (const f of files) console.log(f);
