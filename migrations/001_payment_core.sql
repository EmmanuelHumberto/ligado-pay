CREATE TABLE payments (
  id uuid PRIMARY KEY,
  application_id text NOT NULL,
  receiver_id text NOT NULL,
  environment text NOT NULL CHECK (environment = 'sandbox'),
  external_reference text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 9007199254740991),
  currency text NOT NULL CHECK (currency = 'BRL'),
  method text NOT NULL CHECK (method = 'pix'),
  provider text NOT NULL CHECK (provider = 'simulated'),
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('PROCESSING','PENDING','UNCERTAIN')),
  provider_reference text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(application_id, receiver_id, environment, idempotency_key),
  UNIQUE(application_id, receiver_id, environment, external_reference)
);

CREATE TABLE payment_events (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL REFERENCES payments(id),
  application_id text NOT NULL,
  receiver_id text NOT NULL,
  environment text NOT NULL CHECK (environment = 'sandbox'),
  event_type text NOT NULL CHECK (event_type IN ('PROCESSING','PENDING','UNCERTAIN')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(payment_id, event_type)
);

-- Same transaction as financial state. Delivery is deliberately not implemented yet.
CREATE TABLE outbox (
  event_id uuid PRIMARY KEY REFERENCES payment_events(id),
  delivered_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0)
);

CREATE FUNCTION reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'payment events are append only'; END;
$$;
CREATE TRIGGER payment_events_append_only BEFORE UPDATE OR DELETE ON payment_events
  FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();

CREATE TABLE request_limits (
  application_id text NOT NULL,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY(application_id, window_start)
);
