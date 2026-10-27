-- No runtime INSERT privilege: only the separate migration/operator role may attest bank reconciliation.
CREATE TABLE bank_refund_reconciliations (
 id uuid PRIMARY KEY,
 payment_id uuid NOT NULL REFERENCES payments(id),
 transaction_nsu uuid NOT NULL,
 provider_refund_reference text NOT NULL UNIQUE CHECK(length(provider_refund_reference) BETWEEN 8 AND 128),
 amount_cents bigint NOT NULL CHECK(amount_cents>0),
 occurred_at timestamptz NOT NULL,
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 recorded_by text NOT NULL DEFAULT current_user,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER bank_refund_reconciliations_append_only BEFORE UPDATE OR DELETE ON bank_refund_reconciliations
 FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
CREATE INDEX bank_refund_reconciliations_payment ON bank_refund_reconciliations(payment_id);
