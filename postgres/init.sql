-- Database schema for Personal Credential & Knowledge Vault ("Core Vault")

-- Config table (holds master password hash and TOTP settings, restricted to a single row)
CREATE TABLE IF NOT EXISTS vault_config (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  master_password_hash TEXT NOT NULL,
  encryption_salt TEXT NOT NULL,
  totp_secret TEXT,
  totp_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- One vault item per credential/note/repo/skill
CREATE TABLE IF NOT EXISTS vault_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('api_key','password','repo','skill','note')),
  title TEXT NOT NULL,                  -- e.g. "Kite Connect API Key"
  service TEXT,                         -- e.g. "Zerodha Kite Connect"
  project TEXT,                         -- e.g. "Stock Signal Bot", "NaviGo Website"
  username TEXT,                        -- if applicable
  secret_value_encrypted BYTEA,         -- AES-256-GCM ciphertext (null for repo/skill/note)
  secret_value_hash TEXT,               -- SHA-256 hash of plaintext, for dedup detection only
  url TEXT,                             -- repo link, login URL, webhook URL, docs link
  used_in TEXT[],                       -- array of project/workflow names where this is consumed
  notes TEXT,                           -- free text: setup steps, gotchas, expiry info
  tags TEXT[],                          -- searchable tags
  last_rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_vault_search ON vault_items USING GIN (
  to_tsvector('english', title || ' ' || coalesce(service,'') || ' ' || coalesce(project,'') || ' ' || coalesce(notes,''))
);

-- Access log table for security auditing
CREATE TABLE IF NOT EXISTS access_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID REFERENCES vault_items(id) ON DELETE CASCADE,
  action TEXT NOT NULL,                 -- 'viewed' | 'created' | 'updated' | 'deleted' | 'revealed'
  occurred_at TIMESTAMPTZ DEFAULT now()
);
