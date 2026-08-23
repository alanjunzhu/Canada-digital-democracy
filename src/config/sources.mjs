// Source endpoints and column mappings.
//
// IMPORTANT: the OCL bulk-file column headers below are the one part of this
// sketch that could not be verified against the live file (the build
// environment blocks *.gc.ca and open.canada.ca egress). They are written as
// ALIAS LISTS and validated at ingest: `npm run probe` prints the real headers
// next to what we expect, and ingest refuses to run on a mismatch rather than
// producing a table full of undefineds. Fixing a wrong guess = adding a string
// to a list here.

export const SOURCES = {
  lobbying: {
    // Bulk CSV/ZIP. The OCL media URLs are hash-pathed and rotate, so the
    // supported path is: download from the portal, then
    //   npm run ingest:lobbying -- --from ./data/raw/communications.csv
    portal: 'https://lobbycanada.gc.ca/en/open-data/',
    openGov: 'https://open.canada.ca/data/en/dataset/a34eb330-7136-4f5e-9f5f-3ba41df58b06',
  },
  bills: {
    // LEGISinfo. parlsession is '45-1' style.
    json: (parlsession) => `https://www.parl.ca/legisinfo/en/bills/json?parlsession=${parlsession}`,
  },
  members: {
    // House of Commons open data. Current members:
    currentXml: 'https://www.ourcommons.ca/members/en/search/xml',
    // Historical rosters are per-parliament; verify the exact param on first run.
    byParliamentXml: (parliament) => `https://www.ourcommons.ca/members/en/search/xml?parliament=${parliament}`,
  },
};

// Canonical key -> acceptable header spellings (case/punctuation insensitive).
export const COMMUNICATION_COLUMNS = {
  communication_id: ['COMLOG_ID', 'Communication Log Number', 'Numéro du rapport de communication', 'ID'],
  registration_id: ['REG_ID_ENR', 'Registration Number', 'Registration NUM', 'Numéro d\'enregistrement'],
  comm_date: ['COMM_DATE', 'Communication Date', 'Date of Communication', 'Date de la communication'],
  posted_date: ['POSTED_DATE', 'Date Posted', 'Posted Date', 'Date de publication'],
  institution: ['INSTITUTION_EN', 'Institution', 'Government Institution', 'Institution gouvernementale'],
  subject_raw: ['SUBJECT_MATTER_EN', 'Subject Matter', 'Subject', 'Objet'],
  client_name: ['CLIENT_ORG_CORP_NM_EN', 'Client Name', 'Client', 'Nom du client'],
  registrant_name: ['REGISTRANT_NM', 'Registrant Name', 'Registrant', 'Nom du déclarant'],
};

// The DPOH secondary file (one row per official per communication).
export const DPOH_COLUMNS = {
  communication_id: ['COMLOG_ID', 'Communication Log Number', 'ID'],
  dpoh_raw: ['DPOH_NM', 'DPOH Name', 'Name', 'Nom du TPCD', 'Public Office Holder Name'],
  dpoh_title_raw: ['DPOH_TITLE_EN', 'DPOH Title', 'Title', 'Titre'],
  institution: ['INSTITUTION_EN', 'Institution'],
};

export const SUBJECT_COLUMNS = {
  registration_id: ['REG_ID_ENR', 'Registration Number', 'Registration NUM'],
  category: ['SUBJECT_MATTER_EN', 'Subject Matter', 'Category'],
  details: ['DETAILS_EN', 'Subject Matter Details', 'Details', 'Précisions'],
};

// Parliamentary sessions. Extend as sessions are added; bill-number scoping
// depends on this table being right.
export const SESSIONS = [
  { parliament: 42, session: 1, start_date: '2015-12-03', end_date: '2019-09-11' },
  { parliament: 43, session: 1, start_date: '2019-12-05', end_date: '2020-08-18' },
  { parliament: 43, session: 2, start_date: '2020-09-23', end_date: '2021-08-15' },
  { parliament: 44, session: 1, start_date: '2021-11-22', end_date: '2025-03-23' },
  { parliament: 45, session: 1, start_date: '2025-05-26', end_date: null },
];
