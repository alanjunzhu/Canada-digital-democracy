# Canada digital democracy — *lobby-to-law*

**Who gets to talk to the Canadian government, and how long before the rest of
us find out.**

Under the Lobbying Act, every arranged conversation between a lobbyist and a
designated public office holder has to be filed monthly and published. This
project takes those filings — 380,400 of them, going back to 2008 — resolves
who was actually in the room, joins them to the bills they name, and publishes
the result as a bilingual static site.

It runs on GitHub's servers on a monthly schedule. Nothing runs on a laptop.

## Why this and not a trading tracker

Canada has no STOCK Act. MPs file confidentially with the Conflict of Interest
and Ethics Commissioner, and what becomes public is a Disclosure Summary listing
the *source and nature* of holdings over $10,000 — **no values, no transactions,
no dates**. There is nothing to chart and no timing to analyze. Trying anyway
produces insinuation dressed as data.

What Canada does publish, and the US does not, is **who lobbied whom, by name,
on what date**. That is a timestamped record of access, and it joins cleanly to
the dates bills moved.

## What the data says (measured, not assumed)

| | |
|---|---|
| communications in the record | 380,400 (2008-07-02 → 2026-08-20) |
| official-rows across them | 581,694 |
| name a sitting MP | **26.4%** — most logged access is with staff and public servants |
| name a specific bill | **0.64%** of all communications (3.4% of those carrying any subject text) |
| median wait before publication | **26 days** (p90 42) |
| records matched to a person or an office | **95%** |

Two of those tripped thresholds that were written down in `NOTES.md` *before*
the numbers were known, and both changed what this is:

- Under 40% naming an MP means **the unit of the product is the office**, not
  the member. Hence office pages rather than MP pages.
- Under 5% naming a bill means **the per-bill view cannot be the spine**. It
  exists for the ~130 bills registrants actually name; everything else is
  subject-area context, labelled as context.

## The site

Built by the same run that processes the data, published to GitHub Pages:
<https://alanjunzhu.github.io/Canada-digital-democracy/>

- **Home** — what lobbying is, in plain words, then the four numbers.
- **Offices** — every part of government ranked by meetings logged, with who
  was named in each and when.
- **Bills** — for each bill registrants named: meetings per month, split by
  whether the public could see them yet when the bill took its next step.
- **Method** — what the record cannot tell you, before what it can.

English and French are separate trees, generated together. The pages are static
HTML with inline SVG: no framework, no build step, no runtime JavaScript, and
no dependencies at all — `package.json` has none.

## How it runs

`.github/workflows/pipeline.yml`, monthly on the 5th and on every push to
`main`:

```
tests → mirror → download → probe headers → the four questions
      → members + bills → derive offices → link citations → timelines
      → resolution coverage → build site → publish
```

Every step writes into the run's job summary, and the headline numbers are
printed last so the end of the log is the answer. `data/out/*.json`, the logs,
and the built site are attached as artifacts.

### The one thing CI cannot fetch

`lobbycanada.gc.ca` refuses GitHub's runners outright. Not a header problem —
the run proves it by re-requesting the same URL with four different clients:

```
node-fetch      -> 403
curl            -> 403
curl-default-ua -> 403
wget            -> (refused)
```

Everything else — the Open Government catalogue, LEGISinfo, ourcommons.ca —
answers the runner normally. It is only the OCL's own media host, which appears
to refuse datacentre traffic. No user agent fixes that, and this project is not
going to pretend to be a browser to get around it.

**The way through, about two minutes a month:** download the zip from
<https://lobbycanada.gc.ca/en/open-data/> in a normal browser and attach it to a
release on this repo tagged `ocl-data`. Every run pulls that asset before it
tries the live download, unzips it, and identifies the files by their headers.
The day the host starts serving runners, the mirror stops being used on its own.
Alternatively, point the repository variable `OCL_ZIP_URL` at any URL the runner
can reach.

## Commands

```bash
npm test                 # 111 unit tests, no network

npm run fetch:lobbying   # OCL bulk files via the Open Government catalogue
npm run probe            # real column headers, and the file's encoding, vs. what config expects
npm run stats            # the four questions, in one pass
npm run fetch:members -- --parliaments 39,40,41,42,43,44,45
npm run fetch:bills   -- --sessions 39-1,40-1,41-1,42-1,43-1,44-1,45-1
npm run derive:offices   # build the office roster out of the filings themselves
npm run link             # citations -> session-scoped bills
npm run timeline         # pre-stage access windows
npm run resolve          # entity resolution + coverage report
npm run site             # build the EN/FR static site into ./site
npm run offices          # validate the office roster
npm run probe:members    # which roster endpoint knows the names that failed
```

Commands find their inputs through `data/out/download-manifest.json`, which
records which downloaded CSV is which — decided by reading each file's headers,
not by trusting its name.

## Design rules that are not negotiable

1. **Never guess silently.** A surname shared by two sitting MPs returns
   `ambiguous` with its candidates, not a best guess. Publishing the wrong MP
   beside a lobbying record is the one unrecoverable error here. On the full
   record this costs 0.8% of rows, and it is worth it.
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
   individual stays unnamed and the minister is recorded separately as
   `principal_person_id`. Those are different facts and are never collapsed.
6. **Office holders are observed, not appointed.** The roster is derived from
   the filings, so a holding says 'named as Minister of X in filings dated A to
   B'. It does not say they took office on A. Every derived row carries
   `source: 'observed'` and says so on the page.
7. **Access is not influence.** The record shows who met whom and when. It
   cannot show what was said or whether anyone got what they asked for, and no
   chart on the site is allowed to imply otherwise.
8. **A logged meeting is not wrongdoing.** Lobbying is legal and registering it
   is the system working. Every page footer says so.

## What the files themselves taught us

Things no amount of reading the documentation would have produced:

- **The exports are Windows-1252, not UTF-8.** Decoding as UTF-8 does not throw,
  it silently replaces every accent — `Thériault` stops matching the roster.
- **Officials' names arrive structured**, in separate surname / given / title
  columns, so the resolver never has to guess where a name ends.
- **Titles are typed by hand.** 'Member of Parliment' (sic) appears 1,000 times,
  'M.P.' 378, 'ADM' 2,561.
- **The literal string `null` was the busiest lobbying client in Canada**, 1,712
  times, until ingest started treating it as empty.
- **83% of staff rows name an institution, not a portfolio** — which is why the
  office, not the minister, is the unit that attaches.

## Layout

```
.github/workflows/pipeline.yml   the whole thing, monthly
schema/schema.sql                canonical model
src/config/sources.mjs           endpoints, column aliases, session table
src/lib/csv.mjs                  encoding detection + CSV parsing
src/lib/http.mjs                 retries, streaming download, transport probe
src/fetch/                       OCL bulk, LEGISinfo, ourcommons XML, ingest
src/normalize/names.mjs          diacritics, compounds, particles, nicknames, typos
src/normalize/officials.mjs      DPOH row -> person or role
src/normalize/roles.mjs          role text -> canonical office key (EN/FR)
src/match/resolve.mjs            temporal candidate scoring + coverage report
src/match/office.mjs             office resolution against a dated roster
src/match/derive-offices.mjs     the roster, derived from the filings
src/match/bill-refs.mjs          citation extraction, session scoping
src/match/timeline.mjs           pre-stage access windows + filing lag
src/site/                        the static site: strings (EN/FR), charts, pages
```

## Known gaps

- **The bill join is thin by nature.** 0.64% of communications name a bill. The
  per-bill pages are real for those; nothing else can be presented that way.
- **Office holders are observation windows.** Real appointment dates would come
  from Privy Council records, which are not published as a bulk file. Curated
  rows in `data/overrides/office-holders.json` always beat derived ones, so
  transcribing them improves the site without changing any code.
- **166 office windows are contested** — two people named in the same office at
  once, because a handover happened mid-month. Those resolve as ambiguous.
- **The subject-category join is context, not evidence.** Only `citation` links
  should ever be stated as fact.
