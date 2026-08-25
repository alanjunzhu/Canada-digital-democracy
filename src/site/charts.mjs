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

/**
 * What each stage is, in words a reader who has never heard of a 'reading'
 * can follow. '1R' and 'C→' are what the Commons calls these; they are not
 * what anyone else calls them.
 */
export const STAGE_PLAIN = {
  en: {
    first_reading: 'Introduced',
    second_reading: 'Agreed in principle',
    committee_referral: 'Sent to committee',
    committee_report: 'Back from committee',
    third_reading: 'Final vote in the House',
    royal_assent: 'Became law',
  },
  fr: {
    first_reading: 'Présenté',
    second_reading: 'Adopté en principe',
    committee_referral: 'Renvoyé en comité',
    committee_report: 'Rapport du comité',
    third_reading: 'Vote final aux Communes',
    royal_assent: 'Devenu loi',
  },
};
export const stageName = (stage, lang) => STAGE_PLAIN[lang]?.[stage] || String(stage).replace(/_/g, ' ');

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
 * Meetings per month, split by whether the public could see them yet when the
 * bill next moved — with the bill's own steps marked underneath.
 *
 * This replaced a row-per-meeting timeline. That version was accurate and
 * unreadable: at seventy-odd meetings it became a staircase of near-identical
 * dashes with no takeaway. The question a reader actually has is 'how much
 * happened, when, and how much of it was still hidden' — which is a count over
 * time, so it is drawn as one.
 */
export function meetingsOverTime({ links, stages, t, lang }) {
  const rows = links.filter((l) => l.comm_date);
  if (!rows.length) return '';

  const months = new Map();          // 'YYYY-MM' -> { open, hidden }
  const monthOf = (d) => String(d).slice(0, 7);
  for (const l of rows) {
    const key = monthOf(l.comm_date);
    if (!months.has(key)) months.set(key, { open: 0, hidden: 0 });
    if (stageReachedWhileUnpublished(l, stages)) months.get(key).hidden++;
    else months.get(key).open++;
  }

  // Every month between the first and the last, so a quiet month reads as
  // quiet rather than as missing.
  const keys = [...months.keys()].sort();
  const all = [];
  for (let d = new Date(`${keys[0]}-01T00:00:00Z`), last = new Date(`${keys[keys.length - 1]}-01T00:00:00Z`);
    d <= last; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const k = d.toISOString().slice(0, 7);
    all.push({ key: k, ...(months.get(k) || { open: 0, hidden: 0 }) });
  }

  const width = 860;
  const plotH = 190;
  const padL = 34;
  const padR = 12;
  const padT = 14;
  const stageBand = 34;    // the numbered track only; names go in a list below
  const height = padT + plotH + 26 + stageBand;
  const plotW = width - padL - padR;
  const bw = plotW / all.length;
  const peak = all.reduce((a, m) => Math.max(a, m.open + m.hidden), 0) || 1;
  const yOf = (n) => padT + plotH - (n / peak) * plotH;
  const xOf = (i) => padL + i * bw;

  const gridlines = [0, 0.5, 1].map((f) => {
    const y = padT + plotH - f * plotH;
    return `<g><line x1="${padL}" y1="${y.toFixed(1)}" x2="${width - padR}" y2="${y.toFixed(1)}"
      stroke="${SERIES.rule}" stroke-width="1" />
      <text x="${padL - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="axis-label">${Math.round(f * peak)}</text></g>`;
  }).join('');

  const bars = all.map((m, i) => {
    const total = m.open + m.hidden;
    if (!total) return '';
    const x = xOf(i) + 1.5;
    const w = Math.max(bw - 3, 2);
    const hiddenH = (m.hidden / peak) * plotH;
    const openH = (m.open / peak) * plotH;
    // A 2px gap between the two segments so they never read as one block.
    const hiddenY = yOf(total);
    const openY = yOf(m.open);
    return `<g class="bar">
      <title>${esc(m.key)}: ${num(total, lang)} ${esc(t.chart_meetings)}${m.hidden ? ` — ${num(m.hidden, lang)} ${esc(t.chart_hidden_short)}` : ''}</title>
      ${m.hidden ? `<rect x="${x.toFixed(1)}" y="${hiddenY.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(hiddenH - 2, 1).toFixed(1)}" rx="3" fill="${SERIES.late}" />` : ''}
      ${m.open ? `<rect x="${x.toFixed(1)}" y="${openY.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(openH, 1).toFixed(1)}" rx="3" fill="${SERIES.access}" />` : ''}
    </g>`;
  }).join('\n');

  const monthTicks = all.map((m, i) => (i === 0 || i === all.length - 1 || m.key.endsWith('-01') || i % 3 === 0
    ? `<text x="${(xOf(i) + bw / 2).toFixed(1)}" y="${(padT + plotH + 16).toFixed(1)}" text-anchor="middle" class="axis-label">${esc(m.key)}</text>`
    : '')).join('');

  // The bill's own steps, on their own track under the bars, each with a
  // leader line up to the month it happened in.
  const firstMs = Date.parse(`${all[0].key}-01T00:00:00Z`);
  const lastMs = Date.parse(`${all[all.length - 1].key}-01T00:00:00Z`) + 30 * DAY;
  const xForDate = (d) => padL + ((t2(d) - firstMs) / Math.max(lastMs - firstMs, DAY)) * plotW;
  const trackY = padT + plotH + 40;

  // A stage dated in year 1 is a null the source wrote as a date. It would
  // otherwise anchor the whole axis at the left edge.
  const plausible = (d) => Number.isFinite(t2(d)) && String(d) >= '1900-01-01';
  const sorted = [...stages].filter((s2) => plausible(s2.event_date))
    .sort((a, b) => t2(a.event_date) - t2(b.event_date));
  // A bill can take all six of its steps inside one week — C-5 took five in
  // eleven days — and six labels inside one week is unreadable mush whatever
  // the lane logic. So the track carries numbered dots, and the steps are named
  // in a list under the chart, where they always have room.
  const stageTrack = `<line x1="${padL}" y1="${trackY}" x2="${width - padR}" y2="${trackY}" stroke="${SERIES.rule}" stroke-width="2" />`
    + sorted.map((s2, i) => {
      const x = Math.min(Math.max(xForDate(s2.event_date), padL), width - padR);
      return `<g>
        <title>${esc(stageName(s2.stage, lang))} — ${date(s2.event_date)}</title>
        <line x1="${x.toFixed(1)}" y1="${padT}" x2="${x.toFixed(1)}" y2="${(trackY - 9).toFixed(1)}" stroke="${SERIES.rule}" stroke-width="1" stroke-dasharray="2 4" />
        <circle cx="${x.toFixed(1)}" cy="${trackY}" r="9" fill="var(--panel)" stroke="${SERIES.ink}" stroke-width="2" />
        <text x="${x.toFixed(1)}" y="${(trackY + 4).toFixed(1)}" text-anchor="middle" class="stage-tick">${i + 1}</text>
      </g>`;
    }).join('\n');

  const stageList = sorted.map((s2, i) => `<li><span class="step-n">${i + 1}</span>
    <strong>${esc(stageName(s2.stage, lang))}</strong> <span class="note">${date(s2.event_date)}</span></li>`).join('');

  const hidden = rows.filter((l) => stageReachedWhileUnpublished(l, stages)).length;

  return `<figure class="chart">
  <figcaption><strong>${esc(t.chart_access_title)}</strong>
    <span class="note">${esc(t.chart_access_note)}</span></figcaption>
  <div class="legend">
    <span><i class="swatch" style="background:${SERIES.access}"></i>${esc(t.chart_legend_normal)}</span>
    <span><i class="swatch" style="background:${SERIES.late}"></i>${esc(t.chart_legend_late)}</span>
  </div>
  <svg viewBox="0 0 ${width} ${height}" role="img" width="100%" height="${height}"
       aria-label="${esc(t.chart_access_title)}">
    ${gridlines}
    ${bars}
    ${monthTicks}
    ${stageTrack}
  </svg>
  <ol class="steps">${stageList}</ol>
  ${hidden ? `<p class="caveat"><strong>${num(hidden, lang)} ${esc(t.of)} ${num(rows.length, lang)}</strong> ${esc(t.chart_late_summary)}</p>` : ''}
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
