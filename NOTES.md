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

- Deputy-minister and departmental staff offices are keyed off the department
  name, which is not a portfolio; those keys only match a roster row carrying
  the same institution string.
- No UI. Deliberately: the coverage number from `npm run resolve` should decide
  what the UI is for.
- No bilingual layer. The source data is bilingual; this pipeline keeps English
  field names, and any UI must be EN/FR from the start.
