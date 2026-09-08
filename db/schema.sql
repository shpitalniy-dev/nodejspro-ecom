CREATE DOMAIN currency_code AS TEXT CHECK (VALUE IN ('USD'));

CREATE TABLE IF NOT EXISTS products (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    price_cents BIGINT NOT NULL CHECK (price_cents >= 0),
    currency currency_code NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NULL,
    deleted_at TIMESTAMPTZ DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    name TEXT,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NULL
);

-- Case-insensitive uniqueness: 'Bob@x.com' and 'bob@x.com' can't both
-- register — a plain UNIQUE on email wouldn't catch that. Also replaces
-- idx_users_email_lower from db/indexes.sql: one index now does both jobs
-- (uniqueness + the case-insensitive lookup q3 needs), instead of two.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- One row per product. Separate from products on purpose — every order
-- updates this table, not products, so the catalog itself stays purely
-- read-heavy (see README's Architecture Note).
CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    product_id INTEGER NOT NULL UNIQUE REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    currency currency_code NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0),
    discount_cents BIGINT NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
    status TEXT NOT NULL CHECK (status IN ('unpaid', 'pending', 'paid', 'refunded')) DEFAULT 'unpaid',
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT discount_not_exceeding_amount CHECK (discount_cents <= amount_cents)
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key TEXT NOT NULL, -- snapshot of the product key
    currency currency_code NOT NULL, -- snapshot of the product currency
    price_cents BIGINT NOT NULL, -- snapshot of the product price
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT
);

-- One row per order, created the moment that order's payment status
-- becomes 'paid' — not created at all for unpaid/refunded orders. Separate
-- from orders.status on purpose: payment and fulfillment are different
-- events with different owners (see README's Architecture Note).
CREATE TABLE IF NOT EXISTS fulfillments (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE RESTRICT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'shipped', 'delivered')) DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NULL
);