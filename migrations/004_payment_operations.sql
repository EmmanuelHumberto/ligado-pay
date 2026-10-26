-- Operational intentions/evidence, never a substitute for provider financial confirmation.
CREATE TABLE payment_operations (
 id uuid PRIMARY KEY,
 payment_id uuid NOT NULL REFERENCES payments(id),
 application_id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('REFUND_REQUEST','CANCEL_REQUEST','REFUND_NOTICE','CANCEL_NOTICE','RETRY_REQUEST','EVIDENCE_RECORDED')),
 amount_cents bigint CHECK(amount_cents>0),
 reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z_]{3,64}$'),
 evidence_sha256 text CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 idempotency_key text NOT NULL,
 request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(application_id,payment_id,idempotency_key)
);
CREATE TRIGGER payment_operations_append_only BEFORE UPDATE OR DELETE ON payment_operations
 FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
CREATE INDEX payment_operations_payment ON payment_operations(payment_id,created_at);
