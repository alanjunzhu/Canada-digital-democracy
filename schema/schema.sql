-- lobby-to-law canonical schema (SQLite dialect; portable to DuckDB/Postgres).
--
-- Design notes that matter:
--  * Everything with a name is time-scoped. An MP is not a person, it is a
--    person holding a seat between two dates. A minister is a person holding a
--    portfolio between two dates. Lobbying reports are filed against whoever
--    held the role ON THE COMMUNICATION DATE, so every join is a temporal join.
--  * Nothing is silently matched. Every link carries a method and a confidence,
--    and unresolved rows are kept, not dropped, so coverage is measurable.

-- ---------------------------------------------------------------- people ----

CREATE TABLE person (
  person_id     TEXT PRIMARY KEY,      -- stable internal id
  display_name  TEXT NOT NULL,         -- 'Jean-Yves Thériault' (accents preserved)
  given_name    TEXT,
  surname       TEXT,
  ourcommons_id TEXT,                  -- House of Commons person id, when known
  UNIQUE (ourcommons_id)
);

-- A seat held in the House of Commons for an interval.
CREATE TABLE mp_term (
  mp_term_id   TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL REFERENCES person(person_id),
  parliament   INTEGER NOT NULL,       -- e.g. 45
  riding       TEXT NOT NULL,
  province     TEXT,
  caucus       TEXT,                   -- party at the time; MPs do cross the floor
  start_date   TEXT NOT NULL,          -- ISO 8601
  end_date     TEXT                    -- NULL = currently sitting
);
CREATE INDEX idx_mp_term_person ON mp_term(person_id);
CREATE INDEX idx_mp_term_dates  ON mp_term(start_date, end_date);

-- Ministerial / parliamentary-secretary appointments. Lobbying reports very
-- often name a ROLE ('Chief of Staff, Office of the Minister of Finance')
-- rather than the MP, so roles need their own timeline.
CREATE TABLE office_holding (
  holding_id  TEXT PRIMARY KEY,
  person_id   TEXT REFERENCES person(person_id),  -- NULL for unfilled/unknown staff
  title       TEXT NOT NULL,           -- 'Minister of Finance'
  institution TEXT,                    -- 'Department of Finance Canada'
  is_staff    INTEGER NOT NULL DEFAULT 0,
  start_date  TEXT NOT NULL,
  end_date    TEXT
);

-- ------------------------------------------------------------- lobbying ----

CREATE TABLE registration (
  registration_id   TEXT PRIMARY KEY,  -- OCL registration number
  client_name       TEXT,              -- who is paying
  registrant_name   TEXT,              -- who is lobbying
  registrant_type   TEXT,              -- consultant / in-house corp / in-house org
  effective_date    TEXT,
  end_date          TEXT
);

-- Free-text subject details attached to a registration. This is where explicit
-- bill citations ('Bill C-69') live, and is the highest-precision path from a
-- lobbying record to a piece of legislation.
CREATE TABLE registration_subject (
  registration_id TEXT NOT NULL REFERENCES registration(registration_id),
  category        TEXT,                -- controlled vocabulary, e.g. 'Taxation and Finance'
  details         TEXT                 -- free text
);

CREATE TABLE communication (
  communication_id TEXT PRIMARY KEY,
  registration_id  TEXT REFERENCES registration(registration_id),
  comm_date        TEXT NOT NULL,      -- date of the oral, arranged communication
  posted_date      TEXT,               -- when it was filed; filing lag is itself a finding
  institution      TEXT,               -- 'House of Commons', 'Finance Canada (FIN)'
  subject_raw      TEXT
);
CREATE INDEX idx_comm_date ON communication(comm_date);

-- One row per DPOH named on a communication (the one-to-many the OCL splits
-- into secondary files). dpoh_raw is preserved verbatim, forever: it is the
-- evidence, and the resolver's output is only an interpretation of it.
CREATE TABLE communication_dpoh (
  communication_id TEXT NOT NULL REFERENCES communication(communication_id),
  dpoh_raw         TEXT NOT NULL,
  dpoh_title_raw   TEXT,
  PRIMARY KEY (communication_id, dpoh_raw)
);

-- Resolver output. Deliberately a separate table so it can be recomputed and
-- diffed without touching ingested evidence.
CREATE TABLE dpoh_link (
  communication_id TEXT NOT NULL,
  dpoh_raw         TEXT NOT NULL,
  person_id        TEXT REFERENCES person(person_id),
  holding_id       TEXT REFERENCES office_holding(holding_id),
  status           TEXT NOT NULL,      -- resolved | ambiguous | unresolved | not_a_person
  method           TEXT,               -- exact | nickname | initial | override | role
  confidence       REAL,
  candidate_count  INTEGER,
  PRIMARY KEY (communication_id, dpoh_raw)
);

-- ------------------------------------------------------------ legislation ----

CREATE TABLE bill (
  bill_id      TEXT PRIMARY KEY,       -- '45-1/C-69' — ALWAYS session-scoped
  parliament   INTEGER NOT NULL,
  session      INTEGER NOT NULL,
  number       TEXT NOT NULL,          -- 'C-69'
  chamber      TEXT NOT NULL,          -- Commons | Senate
  short_title  TEXT,
  long_title   TEXT,
  sponsor_person_id TEXT REFERENCES person(person_id)
);

CREATE TABLE bill_event (
  bill_event_id TEXT PRIMARY KEY,
  bill_id       TEXT NOT NULL REFERENCES bill(bill_id),
  stage         TEXT NOT NULL,         -- first_reading | second_reading | committee_referral
                                       -- | committee_report | third_reading | royal_assent
  chamber       TEXT,
  event_date    TEXT NOT NULL
);
CREATE INDEX idx_bill_event_date ON bill_event(bill_id, event_date);

-- ------------------------------------------------------------- the join ----

-- A lobbying record connected to a bill, with how we know.
--   'citation'  = a bill number was written in the registration subject text
--                 (high precision, session-scoped)
--   'category'  = subject-matter category + time window overlap (low precision,
--                 shown as context only, never as a claim)
CREATE TABLE comm_bill_link (
  communication_id TEXT NOT NULL REFERENCES communication(communication_id),
  bill_id          TEXT NOT NULL REFERENCES bill(bill_id),
  method           TEXT NOT NULL,      -- citation | category
  confidence       REAL,
  PRIMARY KEY (communication_id, bill_id, method)
);

-- Materialized answer to the flagship question: for each bill stage, which
-- communications happened in the N days before it, and with whom.
CREATE VIEW v_pre_stage_access AS
SELECT
  be.bill_id,
  be.stage,
  be.event_date,
  c.communication_id,
  c.comm_date,
  julianday(be.event_date) - julianday(c.comm_date) AS days_before_stage,
  r.client_name,
  r.registrant_name,
  dl.person_id,
  dl.status AS dpoh_status
FROM bill_event be
JOIN comm_bill_link cbl ON cbl.bill_id = be.bill_id
JOIN communication  c   ON c.communication_id = cbl.communication_id
LEFT JOIN registration r ON r.registration_id = c.registration_id
LEFT JOIN dpoh_link   dl ON dl.communication_id = c.communication_id
WHERE c.comm_date <= be.event_date;
