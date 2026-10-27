ALTER TABLE checkout_notifications ADD COLUMN trusted boolean NOT NULL DEFAULT false;
CREATE TABLE notification_discard_counts (
 payment_id uuid PRIMARY KEY REFERENCES payments(id),
 discarded bigint NOT NULL DEFAULT 0 CHECK(discarded>=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
