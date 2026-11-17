// @ts-check
/**
 * The web branch of client/charts/ rendered for real — <Chart> as a DOM
 * <svg>, the cards, tiles, breakdown rows, cohort grid — hovered and
 * screenshotted, outside the Paseo app.
 *
 *   node tests/charts-web-preview.mjs [outDir]   # default /tmp/beads-charts-preview
 *
 * Neither react-dom nor react-native-web is in this project (the host brings
 * them), so this bundles the components with the esbuild Paseo ships against
 * the react/react-dom of another global install, and stands a minimal
 * react-native shim (View/Text/Pressable/ScrollView → divs, onLayout through
 * ResizeObserver) in for react-native-web. It checks the drawing and the
 * hover behaviour, not the host's exact styling; synthetic fixture only.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore -- global install, no declarations
import { chromium } from '/usr/local/lib/node_modules/playwright/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] || '/tmp/beads-charts-preview';
const WORK = path.join(OUT, 'web-src');
mkdirSync(WORK, { recursive: true });

const REACT_HOME = '/usr/local/lib/node_modules/@cloudcli-ai/cloudcli/node_modules';
const require = createRequire('/usr/local/lib/node_modules/@getpaseo/cli/package.json');
const esbuild = require('esbuild');

// ── shims ─────────────────────────────────────────────────────────────
writeFileSync(path.join(WORK, 'rn.jsx'), `
import React, { useEffect, useRef, useState } from 'react';
const PX = new Set(['opacity','flexGrow','flexShrink','zIndex','fontWeight','lineHeightUnitless','shadowOpacity']);
function css(style) {
  const s = Array.isArray(style) ? Object.assign({}, ...style.flat(9).filter(Boolean)) : (style || {});
  const o = {};
  for (const [k, v] of Object.entries(s)) {
    if (v == null) continue;
    if (k === 'paddingHorizontal') { o.paddingLeft = o.paddingRight = px(v); continue; }
    if (k === 'paddingVertical') { o.paddingTop = o.paddingBottom = px(v); continue; }
    if (k === 'marginHorizontal') { o.marginLeft = o.marginRight = px(v); continue; }
    if (k === 'marginVertical') { o.marginTop = o.marginBottom = px(v); continue; }
    if (k === 'fontVariant') { o.fontVariantNumeric = v.join(' '); continue; }
    if (k.startsWith('shadow')) continue;
    if (k === 'borderWidth') { o.borderStyle = 'solid'; }
    o[k] = typeof v === 'number' && !PX.has(k) ? v + 'px' : v;
  }
  return o;
}
const px = (v) => typeof v === 'number' ? v + 'px' : v;
function useLayout(onLayout) {
  const ref = useRef(null);
  useEffect(() => {
    if (!onLayout || !ref.current) return;
    const el = ref.current;
    const fire = () => onLayout({ nativeEvent: { layout: { width: el.offsetWidth, height: el.offsetHeight, x: 0, y: 0 } } });
    fire();
    const ro = new ResizeObserver(fire); ro.observe(el); return () => ro.disconnect();
  }, [onLayout]);
  return ref;
}
const base = { display: 'flex', flexDirection: 'column', position: 'relative', boxSizing: 'border-box', minWidth: 0 };
export function View({ style, children, onLayout, pointerEvents, accessibilityLabel }) {
  const ref = useLayout(onLayout);
  return <div ref={ref} aria-label={accessibilityLabel} style={{ ...base, ...css(style), pointerEvents: pointerEvents === 'none' ? 'none' : undefined }}>{children}</div>;
}
export function Text({ style, children, numberOfLines }) {
  const clip = numberOfLines ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : { whiteSpace: 'pre-line' };
  return <span style={{ display: 'block', ...clip, ...css(style) }}>{children}</span>;
}
export function ScrollView({ children, horizontal }) {
  return <div style={{ overflowX: horizontal ? 'auto' : undefined, display: 'flex', flexDirection: horizontal ? 'row' : 'column' }}>{children}</div>;
}
export function Pressable({ style, children, onPress, onHoverIn, onHoverOut, accessibilityLabel, accessibilityRole }) {
  const [hovered, setH] = useState(false);
  const [pressed, setP] = useState(false);
  const st = typeof style === 'function' ? style({ hovered, pressed }) : style;
  return <div role={accessibilityRole} aria-label={accessibilityLabel} tabIndex={onPress ? 0 : undefined}
    onMouseEnter={() => { setH(true); onHoverIn && onHoverIn(); }} onMouseLeave={() => { setH(false); setP(false); onHoverOut && onHoverOut(); }}
    onMouseDown={() => setP(true)} onMouseUp={() => setP(false)} onClick={onPress}
    style={{ ...base, ...css(st) }}>{typeof children === 'function' ? children({ hovered, pressed }) : children}</div>;
}
export const Platform = { OS: 'web', select: (o) => o.web ?? o.default };
`);
writeFileSync(path.join(WORK, 'ui.jsx'), `
export function Icon() { return null; }
`);
writeFileSync(path.join(WORK, 'client.js'), `
export function useTranslation() { return { locale: window.__LOCALE__, t: (k) => k }; }
export function defineTranslations(x) { return x; }
`);

// ── the demo page ─────────────────────────────────────────────────────
writeFileSync(path.join(WORK, 'demo.jsx'), `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { FIXTURE, TEAM_NOW } from '${ROOT}/tests/fixture/data.mjs';
import { aggregateCuts, aggregateFlow, aggregatePeople, cohortTable, etaOf, flowRunning, lineScene, pairedBarsScene,
  rollingMean, smoothingWindow, stackScene, tableScale, tipWhen } from '${ROOT}/shared/charts/index.ts';
import { Chart } from '${ROOT}/client/charts/Chart.tsx';
import { BreakdownCard, ChartCard, CohortGrid, EtaRow, KpiTiles, Sparkline } from '${ROOT}/client/charts/blocks.tsx';
import { chartColors, labelSlots } from '${ROOT}/client/charts/palette.ts';
import { flowKpiTiles, stepAnd, stepCaption, stepTip, tipFor, daysText } from '${ROOT}/client/charts/text.ts';
import { stringsFor } from '${ROOT}/client/i18n/strings.ts';
import { View, Text } from 'react-native';

const THEMES = ${JSON.stringify({
    light: { surface0: '#ffffff', surface1: '#fafafa', surface2: '#f4f4f5', border: '#e4e4e7', foreground: '#1a1a1e', foregroundMuted: '#71717a', accent: '#20744A', accentForeground: '#ffffff', statusSuccess: '#3e704a', statusWarning: '#7b5d39', statusDanger: '#9d433b' },
    dark: { surface0: '#181B1A', surface1: '#1E2120', surface2: '#272A29', border: '#252B2A', foreground: '#fafafa', foregroundMuted: '#A1A5A4', accent: '#20744A', accentForeground: '#ffffff', statusSuccess: '#6cb17b', statusWarning: '#c09664', statusDanger: '#d8847b' },
  })};

function Demo() {
  const theme = THEMES[window.__THEME__];
  const colors = chartColors(theme);
  const s = stringsFor(window.__LOCALE__);
  const rows = [...FIXTURE.tree.issues, ...FIXTURE.team];
  const now = Date.parse(TEAM_NOW);
  const flow = aggregateFlow(rows, 90, now);
  const pts = flow.points, step = flow.step, starts = pts.map((p) => p.start), running = flowRunning(flow);
  const created = pts.map((p) => p.created), closed = pts.map((p) => p.closed);
  const win = smoothingWindow(step);
  const last = pts[pts.length - 1];
  const days = (v) => daysText(s, v);
  const [filters, setFilters] = React.useState([]);
  const key = (f) => JSON.stringify(f);
  const cuts = aggregateCuts(FIXTURE.tree.issues);
  const slots = labelSlots(FIXTURE.tree.issues.flatMap((r) => r.labels || []));
  const ppl = aggregatePeople(rows, 90, now);
  const sc = tableScale(ppl.people, (p) => p.closed);
  return (
    <View style={{ padding: 16, gap: 14, backgroundColor: colors.page }}>
      <KpiTiles tiles={flowKpiTiles(s, flow.totals)} colors={colors} />
      <EtaRow eta={etaOf(flow)} colors={colors} />
      <ChartCard title={s.tempoTitle} aside={s.tempoSmoothed(win, step)} colors={colors}
        legend={[{ label: s.tempoRaisingLine, color: 'muted' }, { label: s.tempoClosingLine, color: 'good' }]}>
        <Chart colors={colors} scene={(width) => lineScene({ starts, step, width, locale: s.locale, aria: s.tempoAria(pts.length), height: 180,
          running, runningLabel: s.tempoRunning,
          series: [{ values: rollingMean(created, win), color: 'muted' }, { values: rollingMean(closed, win), color: 'good' }],
          tip: (i) => s.tempoTip(tipWhen(starts[i], step, s.locale), s.tempoTipPart(s.tempoRaisingLine, created[i]) + ' · ' + s.tempoTipPart(s.tempoClosingLine, closed[i])) })} />
      </ChartCard>
      <ChartCard title={s.flowThroughput} aside={stepCaption(s, step)} colors={colors}
        legend={[{ label: s.flowOpened, color: 'muted', value: flow.totals.created }, { label: s.flowClosed, color: 'good', value: flow.totals.closed }]}>
        <Chart colors={colors} scene={(width) => pairedBarsScene({ starts, step, width, locale: s.locale, aria: s.flowThroughputAria(flow.totals.created, flow.totals.closed),
          left: { values: created, color: 'muted', tip: (i) => tipFor(s, created, i, starts[i], step), key: 'opened' },
          right: { values: closed, color: 'good', tip: (i) => tipFor(s, closed, i, starts[i], step), key: 'closed' } })} />
      </ChartCard>
      <ChartCard title={s.flowCfd} aside={stepCaption(s, step)} colors={colors}
        legend={[{ label: s.flowDone, color: 'good', value: last.done }, { label: s.flowWip, color: 'accent', value: last.wip }, { label: s.flowWaiting, color: 'muted', value: last.waiting }]}>
        <Chart colors={colors} scene={(width) => stackScene({ starts, step, width, locale: s.locale, surface: 'card', aria: s.flowScopeAria(flow.totals.scope, last.done, last.wip, last.waiting),
          layers: [{ values: pts.map((p) => p.done), color: 'good' }, { values: pts.map((p) => p.wip), color: 'accent' }, { values: pts.map((p) => p.waiting), color: 'muted' }] })} />
      </ChartCard>
      <ChartCard title={s.flowPredTitle} aside={stepAnd(s, step, s.flowUnitDays)} colors={colors} note={s.flowPredGap}
        legend={[{ label: s.flowPredMedian, color: 'accent' }, { label: s.flowPredP85, color: 'accentSoft' }]}>
        <Chart colors={colors} scene={(width) => lineScene({ starts, step, width, locale: s.locale, aria: s.flowPredAria(pts.length), running, runningLabel: s.tempoRunning,
          series: [{ values: pts.map((p) => p.lead), color: 'accent', band: true }, { values: pts.map((p) => p.leadP85), color: 'accentSoft' }],
          tip: (i) => stepTip(s, starts[i], step, [{ name: s.flowPredMedian, value: pts[i].lead, fmt: days }, { name: s.flowPredP85, value: pts[i].leadP85, fmt: days }]) })} />
      </ChartCard>
      <ChartCard title={s.flowCohTitle} aside={stepCaption(s, step)} colors={colors}>
        <CohortGrid rows={cohortTable(flow)} step={step} colors={colors} />
      </ChartCard>
      <ChartCard title={s.chartTabPeople} colors={colors}>
        {ppl.people.slice(0, 4).map((p) => (
          <View key={p.name} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}>
            <Text style={{ width: 180, color: colors.ink, fontSize: 12 }}>{p.name || s.chartUnassigned}</Text>
            <Text style={{ width: 30, color: colors.ink2, fontSize: 12 }}>{p.closed}</Text>
            <Sparkline series={p.series} max={sc.spark} aria={s.pplTrendAria(p.closed)} colors={colors} />
          </View>
        ))}
      </ChartCard>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        {cuts.map((c) => (
          <View key={c.key} style={{ flexGrow: 1, flexBasis: 260 }}>
            <BreakdownCard cut={c} colors={colors} slots={slots}
              isActive={(f) => filters.includes(key(f))}
              onToggle={(f) => setFilters((xs) => xs.includes(key(f)) ? xs.filter((x) => x !== key(f)) : [...xs, key(f)])} />
          </View>
        ))}
      </View>
    </View>
  );
}
createRoot(document.getElementById('root')).render(<Demo />);
`);

await esbuild.build({
  entryPoints: [path.join(WORK, 'demo.jsx')],
  bundle: true,
  outfile: path.join(WORK, 'demo.js'),
  format: 'iife',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: {
    'react-native': path.join(WORK, 'rn.jsx'),
    '@getpaseo/plugin/client/ui': path.join(WORK, 'ui.jsx'),
    '@getpaseo/plugin/client': path.join(WORK, 'client.js'),
    react: path.join(REACT_HOME, 'react'),
    'react-dom': path.join(REACT_HOME, 'react-dom'),
  },
  nodePaths: [REACT_HOME],
  logLevel: 'warning',
});

const browser = await chromium.launch();
const files = [];
try {
  for (const [theme, lang] of [['dark', 'en'], ['light', 'ru']]) {
    const html = path.join(WORK, `demo-${theme}-${lang}.html`);
    writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;font-family:system-ui,sans-serif}</style>
<script>window.__THEME__=${JSON.stringify(theme)};window.__LOCALE__=${JSON.stringify(lang)};</script></head>
<body><div id="root"></div><script src="demo.js"></script></body></html>`);
    const pg = await browser.newPage({ viewport: { width: 940, height: 900 } });
    const errors = [];
    pg.on('pageerror', (/** @type {Error} */ e) => errors.push(e.message));
    pg.on('console', (/** @type {any} */ m) => { if (m.type() === 'error') errors.push(m.text()); });
    await pg.goto(`file://${html}`);
    await pg.waitForSelector('svg rect');
    if (errors.length) throw new Error(errors.join('\n'));
    const full = path.join(OUT, `web-${theme}-${lang}.png`);
    await pg.screenshot({ path: full, fullPage: true });
    files.push(full);
    // Hover: a bar of the paired chart (the second svg), then a strip of the pace.
    const bars = pg.locator('svg').nth(1).locator('rect[opacity]');
    const n = await bars.count();
    await bars.nth(Math.floor(n / 2)).hover();
    await pg.waitForTimeout(150);
    const hover = path.join(OUT, `web-hover-bar-${theme}-${lang}.png`);
    await pg.locator('svg').nth(1).locator('xpath=../..').screenshot({ path: hover });
    files.push(hover);
    const strips = pg.locator('svg').nth(0).locator('rect[fill-opacity]');
    await strips.nth((await strips.count()) - 3).hover();
    await pg.waitForTimeout(150);
    const hover2 = path.join(OUT, `web-hover-line-${theme}-${lang}.png`);
    await pg.locator('svg').nth(0).locator('xpath=../..').screenshot({ path: hover2 });
    files.push(hover2);
    // Press a breakdown bar (status: open) — it should show pressed.
    await pg.getByRole('button').first().click();
    await pg.waitForTimeout(100);
    const pressed = path.join(OUT, `web-pressed-${theme}-${lang}.png`);
    await pg.getByRole('button').first().locator('xpath=../..').screenshot({ path: pressed });
    files.push(pressed);
    await pg.close();
  }
} finally {
  await browser.close();
}
for (const f of files) console.log(f);
