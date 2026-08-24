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
//
// VERIFIED against the real Communication_PrimaryExport.csv. The bilingual
// suffixes are not decoration: the OCL names most columns in both languages at
// once ('POSTED_DATE_PUBLICATION'), so guessing the English half alone misses
// them. Older spellings are kept as aliases in case the export changes again.
export const COMMUNICATION_COLUMNS = {
  communication_id: ['COMLOG_ID', 'Communication Log Number', 'ID'],
  comm_date: ['COMM_DATE', 'Communication Date', 'Date of Communication', 'Date de la communication'],
  // Two different dates, and the difference is the finding: SUBMISSION is when
  // the registrant filed, POSTED is when the public could see it.
  posted_date: ['POSTED_DATE_PUBLICATION', 'POSTED_DATE', 'Date Posted', 'Posted Date', 'Date de publication'],
  submission_date: ['SUBMISSION_DATE_SOUMISSION', 'SUBMISSION_DATE', 'Date de soumission'],
  client_name: ['EN_CLIENT_ORG_CORP_NM_AN', 'CLIENT_ORG_CORP_NM_EN', 'Client Name', 'Client'],
  client_name_fr: ['FR_CLIENT_ORG_CORP_NM', 'Nom du client'],
  client_id: ['CLIENT_ORG_CORP_NUM'],
  registrant_surname: ['RGSTRNT_LAST_NM_DCLRNT', 'REGISTRANT_LAST_NM'],
  registrant_given: ['RGSTRNT_1ST_NM_PRENOM_DCLRNT', 'REGISTRANT_FIRST_NM'],
  registrant_id: ['REGISTRANT_NUM_DECLARANT'],
  registration_type: ['REG_TYPE_ENR', 'Registration Type'],
  previous_communication_id: ['PREV_COMLOG_ID_PRECEDNT'],
};

// The DPOH secondary file — one row per official per communication.
//
// VERIFIED, and it overturns an assumption: the officials' names are NOT one
// free-text cell. They arrive as separate surname / given-name / title columns,
// so the resolver does not have to guess where a name ends and a role begins.
// The free-text aliases stay for the registration-side files, which are not
// structured this way.
export const DPOH_COLUMNS = {
  communication_id: ['COMLOG_ID', 'Communication Log Number', 'ID'],
  dpoh_surname: ['DPOH_LAST_NM_TCPD', 'DPOH Last Name'],
  dpoh_given: ['DPOH_FIRST_NM_PRENOM_TCPD', 'DPOH First Name'],
  dpoh_title_raw: ['DPOH_TITLE_TITRE_TCPD', 'DPOH_TITLE_EN', 'DPOH Title', 'Titre'],
  branch: ['BRANCH_UNIT_DIRECTION_SERVICE'],
  institution: ['INSTITUTION', 'INSTITUTION_EN'],
  other_institution: ['OTHER_INSTITUTION_AUTRE'],
};

// The per-communication subject CODES (Communication_SubjectMattersExport.csv),
// and the lookup that turns 'SMT-45' into words. Without the lookup the
// category join is unreadable on a page.
export const COMM_SUBJECT_CODE_COLUMNS = {
  communication_id: ['COMLOG_ID'],
  subject_code: ['SUBJECT_CODE_OBJET'],
  custom_subject: ['CUSTOM_SUBJ_OBJET_PERSO'],
};

export const SUBJECT_CODE_LOOKUP_COLUMNS = {
  subject_code: ['SUBJECT_CODE_OBJET'],
  label_en: ['SMT_EN_DESC'],
  label_fr: ['SMT_FR_DESC'],
};

// The per-COMMUNICATION subject text — Communication_SubjectMatterDetailsExport.csv.
// VERIFIED against the real export: these are the actual headers, not aliases.
// This is the file the bill-citation join runs on, because it ties subject text
// to a communication (and therefore to a date), not just to a registration.
export const COMM_SUBJECT_DETAIL_COLUMNS = {
  communication_id: ['COMLOG_ID'],
  subject_codes: ['SUBJECT_CODE_OBJET'],
  details: ['DESCRIPTION'],
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
