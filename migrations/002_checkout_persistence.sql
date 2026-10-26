ALTER TABLE payments DROP CONSTRAINT payments_environment_check;
ALTER TABLE payments DROP CONSTRAINT payments_provider_check;
ALTER TABLE payments DROP CONSTRAINT payments_state_check;
ALTER TABLE payments ADD CONSTRAINT payments_profile_check CHECK (
  (provider='simulated' AND environment='sandbox') OR (provider='infinitepay' AND environment='production')
);
ALTER TABLE payments ADD CONSTRAINT payments_state_check CHECK (
  state IN ('PROCESSING','PENDING','UNCERTAIN','PAID_PIX','REVIEW_REQUIRED')
);
ALTER TABLE payments ADD COLUMN provider_account text;
ALTER TABLE payments ADD COLUMN checkout_url text;
ALTER TABLE payments ADD COLUMN checkout_expires_at timestamptz;
ALTER TABLE payments ADD COLUMN review_reason text;
ALTER TABLE payments ADD CONSTRAINT checkout_account_required CHECK (
  provider <> 'infinitepay' OR (provider_account IS NOT NULL AND checkout_expires_at IS NOT NULL)
);
ALTER TABLE payment_events DROP CONSTRAINT payment_events_environment_check;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_environment_check CHECK (environment IN ('sandbox','production'));
ALTER TABLE payment_events DROP CONSTRAINT payment_events_event_type_check;
ALTER TABLE payment_events ADD CONSTRAINT payment_events_event_type_check CHECK (
  event_type IN ('PROCESSING','PENDING','UNCERTAIN','PAID_PIX','REVIEW_REQUIRED')
);
CREATE TABLE provider_settlements (
  provider text NOT NULL CHECK (provider='infinitepay'),
  transaction_nsu uuid NOT NULL,
  payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
  amount_cents bigint NOT NULL CHECK (amount_cents>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(provider,transaction_nsu)
);
CREATE TRIGGER provider_settlements_append_only BEFORE UPDATE OR DELETE ON provider_settlements
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
