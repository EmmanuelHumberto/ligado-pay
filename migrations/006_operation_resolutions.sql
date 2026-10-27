CREATE TABLE operation_resolutions (
 operation_id uuid PRIMARY KEY REFERENCES payment_operations(id),
 application_id text NOT NULL,
 reason_code text NOT NULL CHECK(reason_code ~ '^[A-Z_]{3,64}$'),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER operation_resolutions_append_only BEFORE UPDATE OR DELETE ON operation_resolutions
 FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
