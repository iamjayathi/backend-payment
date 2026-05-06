import { db } from './client';
import { logger } from '../logger';

const migration = `
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY,

  idempotency_key VARCHAR(255) UNIQUE NOT NULL,

  amount DECIMAL(10,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'USD',

  status VARCHAR(20) NOT NULL DEFAULT 'pending',

  gateway_transaction_id VARCHAR(255),

  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 3,

  error_message TEXT,
  metadata JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_payments_idempotency_key ON payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_gateway_tx ON payments(gateway_transaction_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY,
  transaction_id VARCHAR(255) UNIQUE NOT NULL,
  payment_id UUID,
  status VARCHAR(20) NOT NULL,
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_payment_id ON webhook_events(payment_id);

-- Auto-update updated_at column
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payments_updated_at ON payments;

CREATE TRIGGER payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
`;

async function runMigration() {
  try {
    await db.query(migration);
    logger.info('Migration completed successfully');
  } catch (error) {
    logger.error('Migration failed', { error });
    throw error;
  } finally {
    await db.end();
  }
}

runMigration();
