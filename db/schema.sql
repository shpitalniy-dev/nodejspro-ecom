CREATE DOMAIN currency_code AS TEXT CHECK (VALUE IN ('USD'));

CREATE TABLE IF NOT EXISTS products (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    uuid UUID UNIQUE NOT NULL DEFAULT gen_random_uuid(),
    currency currency_code NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
    status TEXT NOT NULL CHECK (status IN ('unpaid', 'pending', 'paid', 'canceled', 'refunded')) DEFAULT 'unpaid',
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT discount_not_exceeding_amount CHECK (discount_cents <= amount_cents)
);

CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    key TEXT NOT NULL, -- snapshot of the product key
    currency currency_code NOT NULL, -- snapshot of the product currency
    price_cents INTEGER NOT NULL, -- snapshot of the product price
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NULL,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT
);