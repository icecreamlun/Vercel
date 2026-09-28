CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY, project_id text NOT NULL UNIQUE, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS projects (id text PRIMARY KEY, generation bigint NOT NULL DEFAULT 1, release_id text NOT NULL);
CREATE TABLE IF NOT EXISTS releases (id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) DEFERRABLE INITIALLY DEFERRED, run_id text UNIQUE, artifact jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS jobs (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id), kind text NOT NULL, idem_key text NOT NULL, request_hash text NOT NULL,
 frozen jsonb NOT NULL, status text NOT NULL DEFAULT 'queued', gate text NOT NULL DEFAULT 'pending', report jsonb, error text NOT NULL DEFAULT '',
 weight bigint NOT NULL DEFAULT 0, dispatched boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id,idem_key)
);
CREATE INDEX IF NOT EXISTS jobs_dispatch ON jobs(created_at) WHERE dispatched=false;
CREATE TABLE IF NOT EXISTS executions (
 job_id text NOT NULL REFERENCES jobs(id), side text NOT NULL, name text NOT NULL, attempt int NOT NULL DEFAULT 1, lease bigint NOT NULL DEFAULT 0,
 command_id text NOT NULL DEFAULT '', state text NOT NULL DEFAULT 'pending', image text NOT NULL DEFAULT '', node text NOT NULL DEFAULT '', cleanup boolean NOT NULL DEFAULT false,
 PRIMARY KEY(job_id,side)
);
CREATE TABLE IF NOT EXISTS case_results (job_id text NOT NULL, side text NOT NULL, case_id text NOT NULL, artifact jsonb NOT NULL, PRIMARY KEY(job_id,side,case_id), FOREIGN KEY(job_id,side) REFERENCES executions(job_id,side));
CREATE TABLE IF NOT EXISTS usage_counter (id int PRIMARY KEY CHECK(id=1), used bigint NOT NULL DEFAULT 0, cap bigint NOT NULL);
INSERT INTO usage_counter(id,cap) VALUES(1,4608000) ON CONFLICT DO NOTHING;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS weight bigint NOT NULL DEFAULT 0;
