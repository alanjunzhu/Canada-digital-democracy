// Inline-SVG charts. No library, no runtime JS: a static page that renders the
// same in a browser, a PDF print and a text reader.
//
// The one thing every chart here is careful about: this data shows ACCESS and
// TIMING. It cannot show influence, and no encoding in this file implies it. A
// meeting near a vote is drawn near a vote — the reader draws no conclusion the
// record does not support, because the chart states only what was filed and
// when it became public.

import { esc, num, date } from './render.mjs';

// Validated with the dataviz palette validator against this site's own
// surfaces, light (#ffffff) and dark (#16191d): all six checks pass in both
// modes, worst-pair CVD ΔE 23.8 light / 25.7 dark against a ≥8 target.
export const SERIES = {
  access: 'var(--series-access)',      // blue  — a logged communication
  late: 'var(--series-late)',          // red   — still unpublished when the bill moved
  rule: 'var(--chart-rule)',
  ink: 'var(--text-secondary)',
};

const DAY = 86400000;
const t2 = (d) => (d ? Date.parse(d) : NaN);

/** Stage labels short enough to sit above a rule without colliding. */
const STAGE_ABBR = {
  first_reading: '1R',
  second_reading: '2R',
  committee_referral: 'C→',
  committee_report: 'C←',
  third_reading: '3R',
  royal_assent: 'RA',
};

/**
 * For one communication: the first bill stage that happened AFTER the meeting
 * but BEFORE the meeting was published.
 *
 * This is the whole point of the picture. A meeting held before a vote and
 * published after it was, at the moment the vote happened, not on the public
 * record. That is a fact about disclosure timing, not about anyone's conduct.
 */
export function stageReachedWhileUnpublished(link, stages) {
  const met = t2(link.comm_date);
  const published = t2(link.posted_date);
  if (!Number.isFinite(met) || !Number.isFinite(published)) return null;
  return stages
    .filter((s) => {
      const at = t2(s.event_date);
      return Number.isFinite(at) && at > met && at < published;
    })
    .sort((a, b) => t2(a.event_date) - t2(b.event_date))[0] || null;
}

/**
 * The access timeline: one row per communication, drawn from the day it
 * happened to the day it became public, against the bill's own stage dates.
 */
export function accessTimeline({ links, stages, t, lang, maxRows = 45 }) {
  const rows = [...links]
    .filter((l) => l.comm_date)
    .sort((a, b) => String(a.comm_date).localeCompare(String(b.comm_date)));
  if (!rows.length) return '';

  const shown = rows.slice(0, maxRows);
  const stamps = [
    ...rows.flatMap((l) => [t2(l.comm_date), t2(l.posted_date)]),
    ...stages.map((s) => t2(s.event_date)),
  ].filter(Number.isFinite);
  const min = Math.min(...stamps);
  const max = Math.max(...stamps);
  const span = Math.max(max - min, DAY);

  const padL = 8;
  const padR = 8;
  const padT = 34;
  const rowH = 16;
  const width = 860;
  const height = padT + shown.length * rowH + 34;
  const plotW = width - padL - padR;
  const x = (d) => padL + ((t2(d) - min) / span) * plotW;

  const stageMarks = stages
    .filter((s) => Number.isFinite(t2(s.event_date)))
    .sort((a, b) => t2(a.event_date) - t2(b.event_date))
    .map((s, i) => {
      const px = x(s.event_date);
      // Alternate the label height so adjacent stages do not overprint.
      const ly = i % 2 ? 22 : 12;
      return `<g>
        <line x1="${px.toFixed(1)}" y1="${padT - 6}" x2="${px.toFixed(1)}" y2="${height - 26}"
              stroke="${SERIES.rule}" stroke-width="1" stroke-dasharray="2 3" />
        <text x="${px.toFixed(1)}" y="${ly}" text-anchor="middle" class="stage-tick">${esc(STAGE_ABBR[s.stage] || s.stage)}</text>
        <title>${esc(String(s.stage).replace(/_/g, ' '))} — ${date(s.event_date)}</title>
      </g>`;
    }).join('\n');

  let lateCount = 0;
  const bars = shown.map((l, i) => {
    const y = padT + i * rowH + rowH / 2;
    const x1 = x(l.comm_date);
    const x2 = l.posted_date ? x(l.posted_date) : x1;
    const crossed = stageReachedWhileUnpublished(l, stages);
    if (crossed) lateCount++;
    const colour = crossed ? SERIES.late : SERIES.access;
    const lagDays = l.posted_date
      ? Math.round((t2(l.posted_date) - t2(l.comm_date)) / DAY) : null;

    // A native <title> is the tooltip: no JavaScript, works in print and for
    // screen readers, and cannot break the page if it fails to load.
    const tip = [
      `${date(l.comm_date)} → ${esc(t.chart_published)} ${date(l.posted_date)}`,
      lagDays !== null ? `${lagDays} ${t.days}` : null,
      l.client_name ? `${t.bill_clients}: ${l.client_name}` : null,
      l.official_label ? `${t.bill_officials}: ${l.official_label}` : null,
      crossed ? `⚠ ${t.chart_late_note} (${String(crossed.stage).replace(/_/g, ' ')} ${crossed.event_date})` : null,
    ].filter(Boolean).join('\n');

    return `<g class="bar">
      <title>${esc(tip)}</title>
      <line x1="${x1.toFixed(1)}" y1="${y}" x2="${Math.max(x2, x1 + 2).toFixed(1)}" y2="${y}"
            stroke="${colour}" stroke-width="2" stroke-linecap="round" opacity="0.85" />
      <circle cx="${x1.toFixed(1)}" cy="${y}" r="4" fill="${colour}" stroke="var(--panel)" stroke-width="2" />
      ${crossed ? `<path d="M ${x(crossed.event_date).toFixed(1)} ${y - 5} l 4 8 l -8 0 z" fill="${SERIES.late}" />` : ''}
    </g>`;
  }).join('\n');

  const axis = `<g class="axis">
    <text x="${padL}" y="${height - 8}" class="axis-label">${date(new Date(min).toISOString())}</text>
    <text x="${width - padR}" y="${height - 8}" text-anchor="end" class="axis-label">${date(new Date(max).toISOString())}</text>
  </g>`;

  return `<figure class="chart">
  <figcaption>
    <strong>${esc(t.chart_access_title)}</strong>
    <span class="note">${esc(t.chart_access_note)}</span>
  </figcaption>
  <div class="legend">
    <span><i class="swatch" style="background:${SERIES.access}"></i>${esc(t.chart_legend_normal)}</span>
    <span><i class="swatch late" style="background:${SERIES.late}"></i>▲ ${esc(t.chart_legend_late)}</span>
    <span class="note">1R · 2R · C→ · C← · 3R · RA = ${esc(t.chart_stage_key)}</span>
  </div>
  <svg viewBox="0 0 ${width} ${height}" role="img" width="100%" height="${height}"
       aria-label="${esc(t.chart_access_title)}">
    ${stageMarks}
    ${bars}
    ${axis}
  </svg>
  ${rows.length > shown.length
    ? `<p class="note">${esc(t.chart_truncated)} ${num(shown.length, lang)} / ${num(rows.length, lang)}</p>` : ''}
  ${lateCount ? `<p class="caveat">${num(lateCount, lang)} ${esc(t.chart_late_summary)}</p>` : ''}
</figure>`;
}

/** Filing-lag distribution: one series, so no legend — the title names it. */
export function lagHistogram({ buckets, t, lang }) {
  if (!buckets?.length) return '';
  const width = 860;
  const height = 190;
  const padL = 40;
  const padB = 34;
  const padT = 12;
  const plotW = width - padL - 12;
  const plotH = height - padB - padT;
  const peak = buckets.reduce((a, b) => Math.max(a, b.n), 0) || 1;
  const bw = plotW / buckets.length;

  const bars = buckets.map((b, i) => {
    const h = (b.n / peak) * plotH;
    const bx = padL + i * bw;
    const by = padT + plotH - h;
    return `<g>
      <title>${esc(b.label)} — ${num(b.n, lang)}</title>
      <rect x="${(bx + 1).toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(bw - 2, 1).toFixed(1)}"
            height="${Math.max(h, 1).toFixed(1)}" rx="4" fill="${SERIES.access}" opacity="0.9" />
    </g>`;
  }).join('\n');

  const ticks = buckets.map((b, i) => (i % 2 === 0
    ? `<text x="${(padL + i * bw + bw / 2).toFixed(1)}" y="${height - 14}" text-anchor="middle" class="axis-label">${esc(b.label)}</text>`
    : '')).join('');

  return `<figure class="chart">
  <figcaption><strong>${esc(t.chart_lag_title)}</strong>
    <span class="note">${esc(t.chart_lag_note)}</span></figcaption>
  <svg viewBox="0 0 ${width} ${height}" role="img" width="100%" height="${height}"
       aria-label="${esc(t.chart_lag_title)}">
    <line x1="${padL}" y1="${padT + plotH}" x2="${width - 12}" y2="${padT + plotH}" stroke="${SERIES.rule}" stroke-width="1" />
    ${bars}
    ${ticks}
    <text x="${padL}" y="${height - 2}" class="axis-label">${esc(t.days)}</text>
  </svg>
</figure>`;
}

/** Communications per year for one office. One series, area + line. */
export function yearlySparkline({ years, t, lang }) {
  const entries = Object.entries(years || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length < 2) return '';
  const width = 860;
  const height = 120;
  const padL = 8;
  const padB = 22;
  const padT = 10;
  const plotW = width - padL - 8;
  const plotH = height - padB - padT;
  const peak = entries.reduce((a, [, n]) => Math.max(a, n), 0) || 1;
  const step = plotW / Math.max(entries.length - 1, 1);
  const pt = (i, n) => [padL + i * step, padT + plotH - (n / peak) * plotH];

  const path = entries.map(([, n], i) => `${i ? 'L' : 'M'} ${pt(i, n).map((v) => v.toFixed(1)).join(' ')}`).join(' ');
  const area = `${path} L ${(padL + (entries.length - 1) * step).toFixed(1)} ${(padT + plotH).toFixed(1)} L ${padL} ${(padT + plotH).toFixed(1)} Z`;

  const dots = entries.map(([y, n], i) => {
    const [cx, cy] = pt(i, n);
    return `<g><title>${esc(y)} — ${num(n, lang)}</title>
      <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${SERIES.access}" stroke="var(--panel)" stroke-width="2" /></g>`;
  }).join('');

  const labels = entries.map(([y], i) => (i === 0 || i === entries.length - 1 || i % 4 === 0
    ? `<text x="${pt(i, 0)[0].toFixed(1)}" y="${height - 6}" text-anchor="middle" class="axis-label">${esc(y)}</text>` : '')).join('');

  return `<figure class="chart">
  <figcaption><strong>${esc(t.chart_year_title)}</strong></figcaption>
  <svg viewBox="0 0 ${width} ${height}" role="img" width="100%" height="${height}"
       aria-label="${esc(t.chart_year_title)}">
    <path d="${area}" fill="${SERIES.access}" opacity="0.12" />
    <path d="${path}" fill="none" stroke="${SERIES.access}" stroke-width="2" stroke-linejoin="round" />
    ${dots}${labels}
  </svg>
</figure>`;
}
