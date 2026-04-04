-- Products table for redhawk-store off-chain marketplace
CREATE TABLE IF NOT EXISTS products (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  description TEXT NOT NULL,
  price      REAL NOT NULL,
  token      TEXT NOT NULL DEFAULT 'USDC',
  image      TEXT,
  category   TEXT NOT NULL DEFAULT 'Other',
  stock      INTEGER NOT NULL DEFAULT 1,
  seller_id  TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_seller  ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_products_status  ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_cat     ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_created ON products(created_at DESC);
