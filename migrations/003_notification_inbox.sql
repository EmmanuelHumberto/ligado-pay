-- Untrusted correlation hints only; never a financial observation or raw provider body.
CREATE TABLE checkout_notifications (
 id uuid PRIMARY KEY,
 payment_id uuid NOT NULL REFERENCES payments(id),
 transaction_nsu uuid NOT NULL,
 invoice_slug text NOT NULL CHECK (invoice_slug ~ '^[A-Za-z0-9_-]{1,128}$'),
 state text NOT NULL DEFAULT 'PENDING' CHECK (state IN ('PENDING','DONE','FAILED')),
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 8),
 next_check_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_token uuid,
 lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(payment_id,transaction_nsu,invoice_slug)
);
CREATE INDEX checkout_notifications_due ON checkout_notifications(next_check_at) WHERE state='PENDING';
