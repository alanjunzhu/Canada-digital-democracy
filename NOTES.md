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

Run `npm run probe` against the downloaded bulk files before trusting anything.

## Not yet built

- `office_holding` is unpopulated — minister and parliamentary-secretary
  appointment dates need a source (Privy Council appointment records). Until
  then, role-named communications cannot be attributed to a person.
- No UI. Deliberately: the coverage number from `npm run resolve` should decide
  what the UI is for.
- No bilingual layer. The source data is bilingual; this pipeline keeps English
  field names, and any UI must be EN/FR from the start.
