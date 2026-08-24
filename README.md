# Canada digital democracy — *lobby-to-law*

A sketch of the data spine for a Canadian federal transparency site: joining the
**Office of the Commissioner of Lobbying's monthly communication reports** to
**federal legislation**, so you can ask *who was in the room in the weeks before
a bill moved*.

This is the pipeline only — schema, ingest, entity resolution, and the timeline
join. There is no UI yet, on purpose: the entity resolution is the part that
decides whether the product is possible, so it gets built and measured first.

## Why this and not a trading tracker

Canada has no STOCK Act. MPs file confidentially with the Conflict of Interest
and Ethics Commissioner, and what becomes public is a Disclosure Summary listing
the *source and nature* of holdings over $10,000 — **no values, no transactions,
no dates**. There is nothing to chart and no timing to analyze. Trying anyway
produces insinuation dressed as data.

What Canada does publish, and the US does not, is **who lobbied whom, by name,
on what date**. Under the Lobbying Act every oral, arranged communication with a
Designated Public Office Holder is filed monthly, naming the lobbyist, the
client, the official, the institution and the subject. That is a timestamped
record of access to power, and it joins cleanly to bill stages.

## The question this answers

For each bill, for each stage (first reading, second reading, committee referral,
committee report, third reading, royal assent): which lobbying communications
happened in the window immediately before it, on behalf of whom, with which
officials — and how long afterwards the public found out.

That last number matters. Communications are filed monthly, so the meeting
before clause-by-clause becomes public well after the vote. The filing lag is
the Canadian analogue of a disclosure lag: it measures how much of the access
happened while nobody could see it.

## Status: what is verified and what is not

| Piece | State |
|---|---|
| Name normalization (accents, compounds, particles, nicknames, initials) | **verified**, 27 unit tests |
| DPOH string parsing (MP vs. minister vs. staff vs. role-only) | **verified** against realistic fixtures |
| Temporal resolution (match against who held the seat *on the date*) | **verified** against fixtures |
| Bill citation extraction + session scoping | **verified** |
| Timeline / pre-stage windows | **verified** |
| Office keys from role strings (EN/FR, staff vs. principal vs. parl. sec.) | **verified**, 8 unit tests |
| Office resolution (which chair, held by whom, on the date) | **verified** against fixtures |
| **The office roster itself** (`data/overrides/office-holders.json`) | **empty** — hand-curated, see below |
| Four-question stats report (`npm run stats`) | **verified** against fixtures |
| Member roster from ourcommons.ca | **verified live in CI** — 346 members returned for the 45th |
| Bill list from LEGISinfo | **verified live in CI** — 185 bills returned for 45-1 |
| Bill stage dates from LEGISinfo | **fixed against the live shape**, re-verified each CI run |
| **OCL bulk CSV column names** | **UNVERIFIED** — the download is what CI is for; see below |

The environment this was written in blocks egress to `lobbycanada.gc.ca`,
`open.canada.ca`, `parl.ca` and `ourcommons.ca`. Every unverified piece is
written as an **alias list** in `src/config/sources.mjs` and validated at
ingest: a mismatch raises a hard error naming the real headers, instead of
silently producing a table of `undefined` that looks like sparse data.

## Where this runs

**On GitHub's runners, not on a laptop.** `.github/workflows/pipeline.yml`
downloads the sources, probes the real column headers, answers the four
questions in `NOTES.md`, and reports resolution coverage — writing all of it
into the run's job summary, with `data/out/*.json` and the logs attached as
artifacts. Trigger it from the Actions tab, or let the monthly schedule run it
(the OCL republishes the bulk files monthly; anything more frequent just
re-downloads the same file).

That is also the only place this code has ever met real data, which is why the
status table above distinguishes *verified against fixtures* from *verified
live in CI*.

## Running it locally instead

```bash
# Fetch the bulk files through the Open Government catalogue. The OCL portal's
# own download links are hash-pathed and rotate every publication, so the
# catalogue's package id is the stable handle.
npm run fetch:lobbying

# Then confirm the column mapping against the real headers.
npm run probe -- --comms data/raw/communications.csv --dpoh data/raw/communication_dpoh.csv
```

`probe` prints the real headers beside what the config expects. Add any missing
spellings to the alias lists, then:

```bash
# The four questions in NOTES.md, in one pass. Run this BEFORE building anything.
npm run stats -- --comms data/raw/communications.csv --dpoh data/raw/communication_dpoh.csv

npm run fetch:members -- --parliament 45
npm run fetch:bills   -- --session 45-1
npm run resolve       -- --dpoh data/raw/communication_dpoh.csv --comms data/raw/communications.csv
```

`resolve` also reads the ministerial roster at `data/overrides/office-holders.json`,
which ships empty. Validate it any time with:

```bash
npm run offices        # prints every office, its intervals, and any overlap or bad date
```

`resolve` writes `data/out/resolution-report.json`, which is the tractability
answer: percent resolved, percent ambiguous, and the 25 most frequent strings
that failed. **Read the failures before building any UI.** If a handful of
repeated strings account for most misses, they go in
`data/overrides/dpoh-aliases.json` and coverage jumps. If the failures are a long
unique tail, the join needs more than name matching.

## Design rules that are not negotiable

1. **Never guess silently.** A surname shared by two sitting MPs returns
   `ambiguous` with its candidates, not a best guess. Publishing the wrong MP
   beside a lobbying record is the one unrecoverable error here.
2. **Time is part of identity.** `Smith, John, MP` in 2019 and in 2026 may be
   different people. Candidates are filtered to those actually holding the seat
   on the communication date; nothing falls back to the current roster.
3. **Bill numbers are session-scoped.** `C-69` in the 44th Parliament is a
   different bill than `C-69` in the 45th. Every citation is scoped by the
   communication's date, or it is not a citation.
4. **Raw evidence is immutable.** `dpoh_raw` is stored verbatim forever;
   resolver output lives in a separate table so it can be recomputed and diffed.
5. **A staff meeting is not a minister's meeting.** A row naming 'Chief of
   Staff, Office of the Minister of Finance' resolves to the *office*: the
   individual stays unnamed (`person_id` null) and the minister is recorded
   separately as `principal_person_id`. 'The minister's office met the
   registrant' and 'the minister met the registrant' are different facts, and
   the pipeline never collapses the first into the second.
6. **A logged meeting is not wrongdoing.** Lobbying is legal and registration is
   the system working. The product shows access and timing; it does not imply a
   finding. Any UI built on this must say so on the page.

## Layout

```
schema/schema.sql          canonical model (person, mp_term, communication,
                           communication_dpoh, dpoh_link, bill, bill_event,
                           comm_bill_link, v_pre_stage_access)
src/normalize/names.mjs    diacritics, compounds, particles, nicknames
src/normalize/officials.mjs DPOH string -> person or role
src/match/resolve.mjs      temporal candidate scoring + coverage report
src/match/bill-refs.mjs    citation extraction, session scoping
src/match/timeline.mjs     pre-stage access windows + filing lag
src/fetch/                 LEGISinfo, ourcommons XML, OCL CSV ingest
src/config/sources.mjs     endpoints, column aliases, session table
```

## Known gaps

- **Ministerial staff are unattributable.** A large share of communications name
  a staffer or a bare role. They are classified as `not_a_person` and roll up
  under the minister's office rather than a person. That is a reporting choice
  worth making visible in the UI.
- **`office_holding` is unpopulated.** Minister and parliamentary-secretary
  appointment dates need a source (Privy Council appointment records); until
  then, role-based communications cannot be attributed to a named person.
- **The `category` link method is weak.** Subject-matter category + time window
  is context, not evidence. Only `citation` links should ever be stated as fact.
- **No bilingual layer.** The data is bilingual; this pipeline keeps English
  field names. Any UI must be EN/FR from the start.
