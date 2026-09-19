-- TechStack Radar — Phase 2 schema
-- Designed so it can scale to millions of rows:
-- - Composite index on (technology_id, company_id) for fast "who uses X"
-- - first_seen/last_seen columns track data freshness
-- - UNIQUE(company_id, technology_id) makes ingestion idempotent

CREATE TABLE IF NOT EXISTS companies (
    id              SERIAL PRIMARY KEY,
    domain          TEXT UNIQUE NOT NULL,
    industry        TEXT,
    employee_range  TEXT,
    first_seen      TIMESTAMPTZ DEFAULT NOW(),
    last_seen       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS technologies (
    id          SERIAL PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,
    category    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS detections (
    id              BIGSERIAL PRIMARY KEY,
    company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    technology_id   INT NOT NULL REFERENCES technologies(id) ON DELETE CASCADE,
    confidence      NUMERIC(3,2) NOT NULL,
    matched_on      TEXT,
    first_seen      TIMESTAMPTZ DEFAULT NOW(),
    last_seen       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(company_id, technology_id)
);

-- Index for "which companies use technology X" — the primary query pattern
CREATE INDEX IF NOT EXISTS idx_detections_tech_company
    ON detections(technology_id, company_id);

-- Index for "show me company X's full stack"
CREATE INDEX IF NOT EXISTS idx_detections_company
    ON detections(company_id);