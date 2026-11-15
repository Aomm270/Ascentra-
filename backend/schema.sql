-- Optional persistence for deployments that need durable query and processing records.
-- Raw IRSA archive files are never copied into this database.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS observations (
    id BIGSERIAL PRIMARY KEY,
    product_id TEXT NOT NULL UNIQUE,
    collection TEXT NOT NULL,
    release TEXT NOT NULL CHECK (release IN ('DR1', 'QR3')),
    access_url TEXT NOT NULL,
    observation_start TIMESTAMPTZ,
    observation_end TIMESTAMPTZ,
    center_ra DOUBLE PRECISION,
    center_dec DOUBLE PRECISION,
    footprint GEOMETRY(POLYGON, 4326),
    wavelength_min_um DOUBLE PRECISION,
    wavelength_max_um DOUBLE PRECISION,
    calibration_level SMALLINT,
    exposure_seconds DOUBLE PRECISION,
    resolution_arcsec DOUBLE PRECISION,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS observations_footprint_gix ON observations USING GIST (footprint);
CREATE INDEX IF NOT EXISTS observations_time_idx ON observations (observation_start, observation_end);
CREATE INDEX IF NOT EXISTS observations_release_band_idx ON observations (release, wavelength_min_um, wavelength_max_um);

CREATE TABLE IF NOT EXISTS object_candidates (
    id BIGSERIAL PRIMARY KEY,
    candidate_key TEXT NOT NULL UNIQUE,
    ra DOUBLE PRECISION NOT NULL,
    dec DOUBLE PRECISION NOT NULL,
    position_error_arcsec DOUBLE PRECISION,
    first_observation_id BIGINT REFERENCES observations(id),
    second_observation_id BIGINT REFERENCES observations(id),
    measured_flux_a DOUBLE PRECISION,
    measured_flux_b DOUBLE PRECISION,
    flux_error_a DOUBLE PRECISION,
    flux_error_b DOUBLE PRECISION,
    significance DOUBLE PRECISION,
    status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'reviewed', 'dismissed')),
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS object_candidates_position_gix
    ON object_candidates USING GIST (geography(ST_SetSRID(ST_MakePoint(ra, dec), 4326)));

CREATE TABLE IF NOT EXISTS comparison_results (
    id BIGSERIAL PRIMARY KEY,
    earlier_observation_id BIGINT NOT NULL REFERENCES observations(id),
    later_observation_id BIGINT NOT NULL REFERENCES observations(id),
    comparison_hash TEXT NOT NULL UNIQUE,
    processing_version TEXT NOT NULL,
    status TEXT NOT NULL,
    output_uri TEXT,
    metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
    provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comparison_pair_idx ON comparison_results (earlier_observation_id, later_observation_id);

CREATE TABLE IF NOT EXISTS processing_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'complete', 'failed')),
    input JSONB NOT NULL,
    output JSONB,
    error_summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS processing_jobs_status_idx ON processing_jobs (status, created_at);
