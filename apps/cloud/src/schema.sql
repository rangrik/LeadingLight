CREATE TABLE IF NOT EXISTS cloud_jobs (
  owner text NOT NULL,
  id uuid NOT NULL,
  provider text NOT NULL CHECK(provider IN ('gpt', 'claude')),
  state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','running','ready','failed','cancelled')),
  input jsonb NOT NULL,
  result text,
  model text,
  error text,
  lease uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner,id)
);
CREATE INDEX IF NOT EXISTS cloud_jobs_queue ON cloud_jobs(state,created_at);
CREATE TABLE IF NOT EXISTS sync_events (
  seq bigserial UNIQUE,
  owner text NOT NULL,
  id text NOT NULL,
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(owner,id)
);
CREATE INDEX IF NOT EXISTS sync_events_pull ON sync_events(owner,seq);
CREATE TABLE IF NOT EXISTS relay_pairs (
  id uuid PRIMARY KEY,
  owner text NOT NULL,
  account_name text NOT NULL,
  browser_name text NOT NULL,
  mac_name text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','review','active','revoked')),
  invite_hash text NOT NULL,
  credential_hash text,
  controller uuid,
  command_ack bigint NOT NULL DEFAULT 0,
  status jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
  last_seen timestamptz,
  browser_seen timestamptz
);
CREATE INDEX IF NOT EXISTS relay_pairs_owner ON relay_pairs(owner,created_at);
CREATE TABLE IF NOT EXISTS relay_runs (
  pair_id uuid NOT NULL REFERENCES relay_pairs(id),
  id uuid NOT NULL,
  controller uuid NOT NULL,
  state text NOT NULL CHECK(state IN ('queued','running','stopping','done','failed','stopped','interrupted','expired')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '30 seconds',
  PRIMARY KEY(pair_id,id)
);
ALTER TABLE relay_runs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS relay_one_active_run ON relay_runs(pair_id) WHERE state IN ('queued','running','stopping');
CREATE TABLE IF NOT EXISTS relay_commands (
  seq bigserial UNIQUE,
  pair_id uuid NOT NULL REFERENCES relay_pairs(id),
  id uuid NOT NULL,
  controller uuid NOT NULL,
  turn uuid NOT NULL,
  kind text NOT NULL CHECK(kind IN ('start','reply','cancel')),
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(pair_id,id),
  FOREIGN KEY(pair_id,turn) REFERENCES relay_runs(pair_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS relay_commands_poll ON relay_commands(pair_id,seq);
CREATE TABLE IF NOT EXISTS relay_events (
  seq bigserial UNIQUE,
  pair_id uuid NOT NULL REFERENCES relay_pairs(id),
  id uuid NOT NULL,
  controller uuid NOT NULL,
  turn uuid NOT NULL,
  kind text NOT NULL CHECK(kind='event'),
  envelope jsonb,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(pair_id,id),
  FOREIGN KEY(pair_id,turn) REFERENCES relay_runs(pair_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS relay_events_pull ON relay_events(pair_id,controller,seq);
