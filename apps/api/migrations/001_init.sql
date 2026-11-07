-- Java QuickPick initial schema. All money columns are BIGINT paise (never floating point).

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  email         text NOT NULL UNIQUE,
  phone         text,
  role          text NOT NULL CHECK (role IN ('STUDENT','VENDOR','ADMIN','SUPER_ADMIN')),
  password_hash text,
  status        text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_codes (
  id         bigserial PRIMARY KEY,
  email      text NOT NULL,
  code_hash  text NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   integer NOT NULL DEFAULT 0,
  consumed   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_codes_email_idx ON otp_codes (email, created_at DESC);

CREATE TABLE shops (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   text NOT NULL,
  description            text NOT NULL DEFAULT '',
  status                 text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','SUSPENDED')),
  accepting_orders       boolean NOT NULL DEFAULT true,
  open_time              text NOT NULL DEFAULT '11:30',   -- HH:MM, Asia/Kolkata
  close_time             text NOT NULL DEFAULT '15:00',
  slot_minutes           integer NOT NULL DEFAULT 10 CHECK (slot_minutes BETWEEN 5 AND 60),
  slot_capacity          integer NOT NULL DEFAULT 5 CHECK (slot_capacity >= 0),
  accept_timeout_seconds integer NOT NULL DEFAULT 90 CHECK (accept_timeout_seconds BETWEEN 10 AND 900),
  fssai_number           text,
  owner_contact          text,
  is_demo                boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop_members (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  role    text NOT NULL DEFAULT 'OWNER' CHECK (role IN ('OWNER','MANAGER','STAFF')),
  status  text NOT NULL DEFAULT 'ACTIVE',
  PRIMARY KEY (user_id, shop_id)
);

CREATE TABLE categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name       text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true
);

CREATE TABLE menu_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id          uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  category_id      uuid REFERENCES categories(id) ON DELETE SET NULL,
  name             text NOT NULL,
  description      text NOT NULL DEFAULT '',
  base_price_paise bigint NOT NULL CHECK (base_price_paise >= 0),
  available        boolean NOT NULL DEFAULT true,
  image_url        text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX menu_items_shop_idx ON menu_items (shop_id);

CREATE TABLE devices (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag   text NOT NULL UNIQUE,
  model       text NOT NULL DEFAULT '',
  shop_id     uuid REFERENCES shops(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK','LOANED','RETURNED','LOST','DAMAGED')),
  condition_notes text NOT NULL DEFAULT '',
  last_seen_at timestamptz,
  assigned_at  timestamptz,
  returned_at  timestamptz
);

CREATE TABLE pickup_slots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  capacity       integer NOT NULL CHECK (capacity >= 0),
  reserved_count integer NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  UNIQUE (shop_id, starts_at)
);

CREATE TABLE pricing_policies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version       integer NOT NULL UNIQUE,
  fee_rate_bps  integer NOT NULL CHECK (fee_rate_bps BETWEEN 0 AND 5000),
  tax_mode      text NOT NULL DEFAULT 'NONE' CHECK (tax_mode IN ('NONE','INCLUSIVE','EXCLUSIVE')),
  tax_rate_bps  integer NOT NULL DEFAULT 0 CHECK (tax_rate_bps BETWEEN 0 AND 10000),
  approved      boolean NOT NULL DEFAULT false,  -- true only after written CA sign-off
  effective_from timestamptz NOT NULL DEFAULT now(),
  note          text NOT NULL DEFAULT '',
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     text NOT NULL UNIQUE,
  pickup_code      text NOT NULL,
  user_id          uuid NOT NULL REFERENCES users(id),
  shop_id          uuid NOT NULL REFERENCES shops(id),
  slot_id          uuid NOT NULL REFERENCES pickup_slots(id),
  slot_released    boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN
    ('PENDING_PAYMENT','AWAITING_VENDOR','ACCEPTED','PREPARING','READY','COLLECTED','REJECTED','CANCELLED','EXPIRED','NOT_COLLECTED')),
  payment_status   text NOT NULL DEFAULT 'NOT_STARTED' CHECK (payment_status IN
    ('NOT_STARTED','INITIATED','PENDING','SUCCEEDED','FAILED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED','DISPUTED')),
  subtotal_paise   bigint NOT NULL CHECK (subtotal_paise >= 0),
  fee_rate_bps     integer NOT NULL CHECK (fee_rate_bps >= 0),
  fee_paise        bigint NOT NULL CHECK (fee_paise >= 0),
  tax_mode         text NOT NULL DEFAULT 'NONE',
  tax_rate_bps     integer NOT NULL DEFAULT 0,
  tax_paise        bigint NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  total_paise      bigint NOT NULL CHECK (total_paise >= 0),
  pricing_policy_id uuid NOT NULL REFERENCES pricing_policies(id),
  pricing_policy_version integer NOT NULL,
  idempotency_key  text,
  prep_minutes     integer,
  accept_deadline  timestamptz,
  expires_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX orders_shop_status_idx ON orders (shop_id, status);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_slot_idx ON orders (slot_id);

CREATE TABLE order_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id     uuid NOT NULL REFERENCES menu_items(id),
  name_snapshot    text NOT NULL,
  unit_price_paise bigint NOT NULL CHECK (unit_price_paise >= 0),
  quantity         integer NOT NULL CHECK (quantity > 0),
  line_total_paise bigint NOT NULL CHECK (line_total_paise >= 0)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE order_events (
  id          bigserial PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  actor_type  text NOT NULL,   -- STUDENT | VENDOR | ADMIN | SYSTEM | WEBHOOK
  actor_id    text,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, id);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL UNIQUE REFERENCES orders(id),
  provider        text NOT NULL,
  provider_ref    text NOT NULL UNIQUE,
  amount_paise    bigint NOT NULL CHECK (amount_paise >= 0),
  status          text NOT NULL DEFAULT 'INITIATED',
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE refunds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid NOT NULL REFERENCES payments(id),
  order_id        uuid NOT NULL REFERENCES orders(id),
  amount_paise    bigint NOT NULL CHECK (amount_paise > 0),
  reason          text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSED','FAILED')),
  provider_ref    text UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz
);

-- Planned money split per paid order. Settlement is tracked separately from payment success.
CREATE TABLE payment_splits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES orders(id),
  payment_id       uuid NOT NULL REFERENCES payments(id),
  beneficiary_type text NOT NULL CHECK (beneficiary_type IN ('VENDOR','PLATFORM','TAX')),
  shop_id          uuid REFERENCES shops(id),
  amount_paise     bigint NOT NULL CHECK (amount_paise >= 0),
  status           text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','REVERSED','SETTLED')),
  provider_ref     text,
  UNIQUE (order_id, beneficiary_type)
);

CREATE TABLE settlements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      uuid NOT NULL REFERENCES shops(id),
  provider_ref text,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  gross_paise  bigint NOT NULL DEFAULT 0,
  adjustment_paise bigint NOT NULL DEFAULT 0,
  net_paise    bigint NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'PENDING',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settlement_reconciliation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id    uuid REFERENCES settlements(id),
  external_ref     text,
  expected_paise   bigint NOT NULL,
  actual_paise     bigint NOT NULL,
  difference_paise bigint NOT NULL,
  status           text NOT NULL DEFAULT 'OPEN',
  notes            text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_events (
  id                bigserial PRIMARY KEY,
  provider          text NOT NULL,
  external_event_id text NOT NULL,
  event_type        text NOT NULL,
  payload           jsonb NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  processed_at      timestamptz,
  result            text,
  UNIQUE (provider, external_event_id)
);

CREATE TABLE complaints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  category    text NOT NULL,
  description text NOT NULL,
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','RESOLVED')),
  resolution  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid,
  actor_role  text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);
