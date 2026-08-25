# Handover notes

## Provenance

This pipeline was drafted while working on `alanjunzhu/digital-democracy` (the
US Congress tracker) as an answer to "what would this be in a Canadian
context". It is not a port of that codebase — the US project's centrepiece is
STOCK Act trade analysis, which has no Canadian equivalent (see README). Only
the Astro/static-site patterns are expected to carry over, if and when a UI is
built on top of this spine.

## Open questions for the first live run

The build environment where this was written blocked egress to `lobbycanada.gc.ca`,
`open.canada.ca`, `parl.ca` and `ourcommons.ca`, so no live file has ever been
read. The resolution logic is verified against fixtures; these four numbers are
not known yet, and each one changes the product.

1. **What fraction of DPOH rows name an MP at all**, versus ministerial staff or
   a bare role? That ratio caps how member-centric the site can be. If most
   logged access is with staff, the unit of the product is the *minister's
   office*, not the MP.
2. **How many registrations cite a bill number explicitly?** If it is a small
   share, the high-precision `citation` join is thin, and the timeline has to
   lean on the weaker subject-category join — which changes what can honestly
   be claimed on the page from evidence to context.
3. **What is the real median filing lag?** If it is short, the "the public found
   out after the vote" framing is weaker than assumed and should be dropped
   rather than stretched.
4. **Do the OCL files use one DPOH row per communication, or a delimited list in
   a single cell?** The schema assumes one row per official. If it is delimited,
   `ingestCsv` needs a splitter before resolution, and the coverage numbers from
   `npm run resolve` will be wrong until it does.

All four are answered in one pass by:

```bash
npm run stats -- --comms data/raw/communications.csv --dpoh data/raw/communication_dpoh.csv
```

which prints them and writes `data/out/ratio-report.json`. Run `npm run probe`
first, though — if the column mapping is wrong, `stats` will refuse to run
rather than report confident numbers off the wrong columns.

Rough decision thresholds, set in advance so the numbers are not rationalized
after the fact:

- **Q1 under ~40% naming a sitting member** — the product is about ministers'
  offices, not MPs, and `office_holding` becomes the next thing to build.
- **Q2 under ~5% citing a bill** — the citation join is too thin to carry the
  timeline; either drop the per-bill framing or accept the weaker category join
  and label it as context on the page.
- **Q3 median under ~10 days** — drop the "public found out later" angle.
- **Q4 flagged as packed** — stop and write the splitter; every other number
  above is wrong until then.

## Offices: built, roster empty

Role rows — 'Chief of Staff, Office of the Minister of Finance', 'Directrice
des politiques, Cabinet du premier ministre' — used to end at `not_a_person`
and drop out of the product. They now canonicalize to an **office key**
(`src/normalize/roles.mjs`) and resolve against a dated roster
(`src/match/office.mjs`), so the access is attributed to a chair even when the
individual in the room is never named.

What the resolver returns for these rows:

| status | meaning |
|---|---|
| `resolved` | the filing named the office *holder* (minister, parl. sec., deputy) and the roster says who that was on the date |
| `office` | the chair is known, the individual is not — every staff row, plus a chair recorded with no person |
| `ambiguous_office` | more than one holding covers that date; the roster needs fixing, nothing is guessed |
| `not_a_person` | unchanged: no office key, or no holding covering the date |

`office` rows are excluded from `pct_resolved_of_named_persons` — they named
nobody, so they cannot count for or against identifying a person. The new
`pct_attributed` is the number that says whether the site can be built: how
much of the file lands *somewhere*, person or chair.

**The roster is empty and must be transcribed by hand.** The Privy Council
publishes ministry lists and appointment Orders in Council, but not as a bulk
file, and this environment still has no egress to `*.gc.ca` — so inventing
appointment dates was the one thing not worth doing. Format and sources are in
the `_readme` of `data/overrides/office-holders.json`; `npm run offices`
validates it and refuses to leave overlapping intervals unreported. With an
empty roster every role row reports `unmatched` and behaviour is exactly as
before: the feature is opt-in by data.

The first real run should therefore be: `npm run resolve`, read
`resolution-report.json → offices.top_unmatched_office_keys`, and transcribe
roster rows in that frequency order. French portfolio phrases that appear there
get an alias (built-ins in `roles.mjs`, data-specific ones in the roster file's
`aliases`) rather than a looser match.

## All four questions are answered

Run against the real bulk export (380,400 communications, 2008-07-02 to
2026-08-20; 581,694 DPOH rows). Thresholds were written down before the numbers
were known, and two of the four triggered.

### Q1 — who is actually named? **26.4% name a sitting member.** Threshold ~40%: **triggered.**

| class | rows | |
|---|---|---|
| staff | 355,038 | 61% |
| MP / parliamentary secretary | 146,883 | **26.4%** |
| minister | 35,293 | 6% |
| senator | 17,403 | 3% |
| unclassified title | 20,044 | 3.4% |
| no person named at all | 98 | — |

Almost every row names a *person* — only 98 of 581,694 are role-only — but the
person is usually a public servant or exempt staffer, not a member. So the
recorded decision stands: **the unit of the product is the office, not the
MP**, and `office_holding` is what makes those 355k staff rows mean anything.
The office resolver is built; the roster it needs is still empty.

### Q2 — how many cite a bill? **3.4% of those with subject text; 0.64% of all.** Threshold ~5%: **triggered.**

Only 72,297 of 380,400 communications carry any subject text at all, so the
denominator has to be stated: 2,451 communications cite a bill number, which is
3.4% of the ones that say anything and **0.64% of the whole file**. 114
distinct bills; most cited C-5 (282), C-27 (255), C-282 (192), C-234 (167).

The extractor is not the limit — 3.44% mention 'bill' or 'projet de loi' at all
and we catch 3.39% of those; the rest name an Act, not a number. The
consequence recorded in advance applies: **the citation join cannot carry a
general per-bill timeline.** It carries real per-bill pages for those ~114
bills, and everything else has to lean on the subject-code join, labelled as
context rather than evidence. The 99.4% is itself the finding: the public
record mostly does not say which bill lobbying is about.

### Q3 — the filing lag. **Median 26 days.** Threshold ~10 days: **not triggered.**

p75 35 days, p90 42 days. A meeting held the week before clause-by-clause is
routinely public only a month later, so the disclosure-lag framing holds and
should be kept. (Max 5,748 days is a genuine outlier in the historical file,
not a parsing artefact — the export goes back to 2008.)

### Q4 — row shape. **One row per official.** No splitter needed.

1.53 DPOH rows per communication, max 99. The schema assumption holds, so every
number above stands.

## First resolution run, and why its number is a floor

Resolving all 581,694 DPOH rows against the roster CI had loaded:

| status | rows | |
|---|---|---|
| not_a_person | 372,539 | staff and senators — correct, not a failure |
| unresolved | 186,504 | |
| resolved | 22,294 | |
| ambiguous | 357 | 0.06% — the never-guess rule almost never has to fire |

`pct_resolved_of_named_persons` came out at **10.7%**, and that number is
misleading in a specific, fixable way: the run had loaded **only the 45th
Parliament's roster** (346 members, elected 2025) while the lobbying file goes
back to **2008-07-02**. Seventeen years of communications had nobody to match
against, so they came back `unresolved` — a missing roster reported as a
matching failure. The temporal rule worked exactly as designed; it was fed one
Parliament and asked about seven.

`fetch:members` now takes `--parliaments 39,40,41,42,43,44,45`, merges them into
`members-all.json`, and warns if two Parliaments return identical rosters —
which would mean the source is ignoring the parameter and every historical
answer is really today's House wearing a different date.

Two things that are already worth noting from this run:

- **357 ambiguous out of 581,694.** The rule that a shared surname must never
  be guessed costs almost nothing in practice.
- **`pct_attributed` 3.8%** is low for the same reason it was always going to
  be: 372,539 staff rows have no office roster to attach to yet. That is the
  single highest-value thing left to build, and Q1 is why.

## What the files themselves taught us

- **The DPOH names are structured, not free text.** The export has
  `DPOH_LAST_NM_TCPD` / `DPOH_FIRST_NM_PRENOM_TCPD` / `DPOH_TITLE_TITRE_TCPD`,
  so the resolver never has to guess where a name ends and a title begins.
  `dpoh_raw` is composed as 'Surname, Given' — comma order is the one thing the
  file states outright.
- **The exports are Windows-1252.** Reading them as UTF-8 does not throw, it
  just replaces every accent, which would have silently broken French name
  matching.
- **Titles are typed by hand.** 'Member of Parliment' (sic) appears 1,000
  times, 'M.P.' 378, 'Member of the House of Commons' 410. Tolerating those
  moved 6,000 rows out of 'unclassified'.
- **Two date columns**, `SUBMISSION_DATE_SOUMISSION` and
  `POSTED_DATE_PUBLICATION`: when the registrant filed, and when the public
  could see it. Q3 uses the second.

## What the live runs settled

Running the pipeline on a GitHub runner (`.github/workflows/pipeline.yml`)
answered several things that fixtures could not:

- **ourcommons.ca**: 346 members for the 45th Parliament. The XML tag names in
  `fetch-members.mjs` are correct.
- **LEGISinfo**: 185 bills for 45-1. The URL and the top-level field names are
  correct; the *stage* shape was not — the first run produced 0 stage events.
  LEGISinfo carries stages both as scalar fields whose key names the stage
  (`PassedHouseFirstReadingDateTime`) and as nested stage objects. Reading both
  gives 661 stage events for the same 185 bills.
- **The OCL catalogue** publishes exactly two resources for Monthly
  Communication Reports: one zip and an XLS data dictionary. There is no
  separate DPOH resource — the primary and secondary files are both inside the
  zip, which is why archive members are identified by their headers.
- **The OCL media host refuses CI runners** (403 to every client tried). The
  four questions below therefore still need the zip mirrored to a release on
  this repo, or `OCL_ZIP_URL` pointed somewhere reachable. See the README.

## Not yet built

- **Real appointment dates.** The office roster is derived from the filings, so
  every holding is an observation window rather than a term of office. Privy
  Council records would fix this; they are not published as a bulk file.
  Curated rows always beat derived ones, so this is transcription work, not
  code.
- **166 contested office windows** — two people named in the same office at
  once, because a handover happened mid-month. They resolve as ambiguous, which
  is correct but not informative.
- **The subject-code join.** SMT-xx codes are matched but not yet used on the
  site; `Codes_SubjectMatterTypesExport.csv` turns them into words, which would
  give the 99.4% of communications that name no bill something honest to say.
- Deputy-minister and departmental staff offices are keyed off the department
  name, which is not a portfolio; those keys only match a roster row carrying
  the same institution string.

## Built since this file was last a to-do list

The three items that used to sit here are done, and the record of how they went
is above: the UI exists and is bilingual from the first page, and the coverage
number that was supposed to decide what it was for did exactly that — 26.4%
naming an MP is why the site is organised around offices rather than members.

## The meeting archive (this change)

581,694 official-rows reduce to 399,936 meetings that resolve to an office.
That will not fit in HTML, so the archive is written where the record actually
is: the top 50 offices hold 349,092 of those meetings — 87% — and get every
one of them, one JSON file per office (`data/out/office-meetings/<slug>.json`)
and one HTML page per year, cut at 500 rows. Everything below that keeps the
recent window it already had, and the page says so rather than looking
complete.

Two things the rendered page caught that the tests did not:

- Page 1 of 3 printed "3 meetings" — the rows on the page, which a reader
  would have read as the size of the year. It now prints the year's total,
  the page number, and the row range.
- The filter's placeholder repeated its own label. It shows an example now.

The filter is deliberately dumb: substring match over `row.textContent`, no
index, no fetch. 500 rows is small enough that it is instant, and it means a
reader with JavaScript off loses nothing but the narrowing.

## The archive never shipped, and the run went green anyway

The first version of the archive wrote `data/out/office-meetings/<slug>.json`
through a helper that only ever created `data/out`. Writing into a
subdirectory threw ENOENT, `resolve` died on the spot — before its own
coverage report — and because that step is `continue-on-error` (so a crash
there still leaves the site and the reports attached to the run) the job
finished green. The site then rebuilt from the *previous* run's JSON, which
had no archive in it, and the published site looked exactly as it had the day
before. The only visible trace was a site build that took one second.

Two fixes: the helper now creates the file's own directory, and the pipeline
fails if `resolve` did not leave its reports behind. A step allowed to fail
needs something downstream that notices.

## Who is doing the asking

The office pages answer 'who came to see this office'. The question a reader
asks first is the other one: this organisation — who do they actually see?
That is now its own tree, built in `resolve` in two passes: a cheap count over
the communications to find which of the 8,726 organisation names are big
enough to publish, then a detailed pass that keeps meetings only for those.
Keeping every meeting for every name at once is what would put the process
into swap.

Three decisions inside it, each of which showed up as a visible defect first:

- **A person is a name at an office, not a name.** The record carries no
  identifier for public servants. Two 'Smith, John' at the same department
  cannot be told apart, and the page says so rather than implying an identity
  the filings do not support.
- **Job titles are rolled up.** Marian Campbell Jarvis filed as 'Assistant
  Deputy Minister' 52 times and 'ADM' 24 times; keyed by title she was two
  people, each undercounted. The page shows the title filed most often and
  says how many others there were. Guy Gallant's page lists eight, including
  'Cheif of Staff' — the record's own spelling, kept.
- **Two offices can carry the same label.** A department and its deputy
  minister's office both file as 'Natural Resources Canada (NRCan)', so a
  client page printed the same name twice with different counts, which reads
  as a bug. The part of the office key that is not already in the label is
  now spelled out: 'Natural Resources Canada (NRCan) — Deputy Minister'.

## What a bill page owes a reader

It used to open with a number and a chart. It now opens with what the bill is
— type, sponsor, introduced, how far it got, and a link to read it on
LEGISinfo — then why it is on this site at all, phrased as the count it is:
'282 filed meetings named this bill, from 5 organisations. That is what puts
it here — not how important anyone thinks it is.' Importance is not something
this pipeline can measure, and saying so is cheaper than implying otherwise.

'What those meetings were about' is the OCL's own subject categories, joined
through `Communication_SubjectMattersExport` and the code lookup. It is the
registrants' categorisation of their own meetings, which is the only kind
available.

The index is ordered by most recent activity. Ordering by volume buried
whatever Parliament is doing now under a finished bill from 2013.

LEGISinfo renames its fields between releases, so every new field is read
through an alias list and a bill page simply says less when a field is
missing. A run that finds none of them still builds.

