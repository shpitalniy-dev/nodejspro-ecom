import 'reflect-metadata';

import type { EntityManager } from 'typeorm';

import type { FulfillmentStatus } from './entities/fulfillment.entity.ts';
import { Fulfillment } from './entities/fulfillment.entity.ts';
import { Inventory } from './entities/inventory.entity.ts';
import type { OrderStatus } from './entities/order.entity.ts';
import { Order } from './entities/order.entity.ts';
import { OrderItem } from './entities/order-item.entity.ts';
import { Product } from './entities/product.entity.ts';
import type { UserRole } from './entities/user.entity.ts';
import { User } from './entities/user.entity.ts';
import { AppDataSource } from './data-source.ts';

// Deterministic fixtures — fixed UUIDs / keys / prices, no random(), no
// Date.now(). Idempotent: every table is inserted with ON CONFLICT DO
// NOTHING on a natural key, so a second run writes nothing and fails
// nothing. order_items has no natural key of its own — it's only inserted
// for orders that were actually new on this run (see run() below).

const MAIN_TABLES = [
  'users',
  'products',
  'inventory',
  'orders',
  'order_items',
  'fulfillments',
] as const;

type TableName = (typeof MAIN_TABLES)[number];

const USERS: Array<{
  uuid: string;
  name: string | null;
  email: string;
  role: UserRole;
}> = [
  {
    uuid: '10000000-0000-4000-8000-000000000001',
    name: 'Alice Admin',
    email: 'alice@seed.example',
    role: 'admin',
  },
  {
    uuid: '10000000-0000-4000-8000-000000000002',
    name: 'Bob Admin',
    email: 'bob@seed.example',
    role: 'admin',
  },
  {
    uuid: '10000000-0000-4000-8000-000000000003',
    name: 'Carol Buyer',
    email: 'carol@seed.example',
    role: 'user',
  },
  {
    uuid: '10000000-0000-4000-8000-000000000004',
    name: 'Dave Buyer',
    email: 'dave@seed.example',
    role: 'user',
  },
  {
    uuid: '10000000-0000-4000-8000-000000000005',
    name: 'Erin Buyer',
    email: 'erin@seed.example',
    role: 'user',
  },
  {
    uuid: '10000000-0000-4000-8000-000000000006',
    name: 'Frank Buyer',
    email: 'frank@seed.example',
    role: 'user',
  },
  {
    uuid: '10000000-0000-4000-8000-000000000007',
    name: null,
    email: 'grace@seed.example',
    role: 'user',
  },
  {
    uuid: '10000000-0000-4000-8000-000000000008',
    name: 'Heidi Buyer',
    email: 'heidi@seed.example',
    role: 'user',
  },
];

const PRODUCTS: Array<{ key: string; priceCents: string; quantity: number }> = [
  { key: 'sku-widget', priceCents: '1999', quantity: 120 },
  { key: 'sku-gadget', priceCents: '4950', quantity: 40 },
  { key: 'sku-gizmo', priceCents: '999', quantity: 0 },
  { key: 'sku-doohickey', priceCents: '12500', quantity: 15 },
  { key: 'sku-thingamajig', priceCents: '350', quantity: 500 },
  { key: 'sku-contraption', priceCents: '8800', quantity: 8 },
  { key: 'sku-apparatus', priceCents: '23000', quantity: 0 },
  { key: 'sku-implement', priceCents: '640', quantity: 250 },
  { key: 'sku-sprocket', priceCents: '1500', quantity: 60 },
  { key: 'sku-flange', priceCents: '2750', quantity: 33 },
];

const CURRENCY = 'USD';

const ORDERS: Array<{
  uuid: string;
  userEmail: string;
  status: OrderStatus;
  amountCents: string;
  discountCents: string;
  fulfillmentStatus?: FulfillmentStatus;
  items: Array<{ key: string; quantity: number }>;
}> = [
  {
    uuid: '20000000-0000-4000-8000-000000000001',
    userEmail: 'carol@seed.example',
    status: 'unpaid',
    amountCents: '1999',
    discountCents: '0',
    items: [{ key: 'sku-widget', quantity: 1 }],
  },
  {
    uuid: '20000000-0000-4000-8000-000000000002',
    userEmail: 'carol@seed.example',
    status: 'paid',
    amountCents: '7948',
    discountCents: '0',
    fulfillmentStatus: 'delivered',
    items: [
      { key: 'sku-widget', quantity: 1 },
      { key: 'sku-gadget', quantity: 1 },
      { key: 'sku-gizmo', quantity: 1 },
    ],
  },
  {
    uuid: '20000000-0000-4000-8000-000000000003',
    userEmail: 'dave@seed.example',
    status: 'pending',
    amountCents: '999',
    discountCents: '0',
    items: [{ key: 'sku-gizmo', quantity: 1 }],
  },
  {
    uuid: '20000000-0000-4000-8000-000000000004',
    userEmail: 'dave@seed.example',
    status: 'paid',
    amountCents: '48000',
    discountCents: '2000',
    fulfillmentStatus: 'shipped',
    items: [
      { key: 'sku-doohickey', quantity: 2 },
      { key: 'sku-apparatus', quantity: 1 },
    ],
  },
  {
    uuid: '20000000-0000-4000-8000-000000000005',
    userEmail: 'erin@seed.example',
    status: 'refunded',
    amountCents: '350',
    discountCents: '0',
    items: [{ key: 'sku-thingamajig', quantity: 1 }],
  },
  {
    uuid: '20000000-0000-4000-8000-000000000006',
    userEmail: 'frank@seed.example',
    status: 'paid',
    amountCents: '18240',
    discountCents: '700',
    fulfillmentStatus: 'processing',
    items: [
      { key: 'sku-contraption', quantity: 2 },
      { key: 'sku-implement', quantity: 1 },
    ],
  },
  {
    uuid: '20000000-0000-4000-8000-000000000007',
    userEmail: 'grace@seed.example',
    status: 'pending',
    amountCents: '4250',
    discountCents: '0',
    items: [
      { key: 'sku-sprocket', quantity: 1 },
      { key: 'sku-flange', quantity: 1 },
    ],
  },
  {
    uuid: '20000000-0000-4000-8000-000000000008',
    userEmail: 'heidi@seed.example',
    status: 'unpaid',
    amountCents: '2750',
    discountCents: '250',
    items: [{ key: 'sku-flange', quantity: 1 }],
  },
];

function mustGet<K, V>(map: Map<K, V>, key: K): V {
  const value = map.get(key);

  if (value === undefined) {
    throw new Error(
      `seed fixture references a row that isn't there: ${String(key)}`,
    );
  }

  return value;
}

type Inserted = Record<TableName, number>;

async function run(m: EntityManager): Promise<Inserted> {
  const users = await m
    .createQueryBuilder()
    .insert()
    .into(User)
    .values(USERS)
    .orIgnore()
    .returning(['id'])
    .execute();

  const products = await m
    .createQueryBuilder()
    .insert()
    .into(Product)
    .values(
      PRODUCTS.map(p => ({
        key: p.key,
        priceCents: p.priceCents,
        currency: CURRENCY,
      })),
    )
    .orIgnore()
    .returning(['id'])
    .execute();

  const productByKey = new Map(
    (await m.getRepository(Product).find()).map(p => [p.key, p]),
  );

  const userByEmail = new Map(
    (await m.getRepository(User).find()).map(u => [u.email, u]),
  );

  const inventory = await m
    .createQueryBuilder()
    .insert()
    .into(Inventory)
    .values(
      PRODUCTS.map(p => ({
        product: { id: mustGet(productByKey, p.key).id },
        quantity: p.quantity,
      })),
    )
    .orIgnore()
    .returning(['id'])
    .execute();

  const orders = await m
    .createQueryBuilder()
    .insert()
    .into(Order)
    .values(
      ORDERS.map(o => ({
        uuid: o.uuid,
        currency: CURRENCY,
        amountCents: o.amountCents,
        discountCents: o.discountCents,
        status: o.status,
        user: { id: mustGet(userByEmail, o.userEmail).id },
      })),
    )
    .orIgnore()
    .returning(['uuid'])
    .execute();

  const newOrderUuids = new Set(
    (orders.raw as Array<{ uuid: string }>).map(r => r.uuid),
  );

  const orderByUuid = new Map(
    (await m.getRepository(Order).find()).map(o => [o.uuid, o]),
  );

  // order_items: no natural key of its own — insert only for orders that
  // were actually new on this run, so a second run adds nothing.
  const itemRows = ORDERS.filter(o => newOrderUuids.has(o.uuid)).flatMap(o =>
    o.items.map(item => {
      const product = mustGet(productByKey, item.key);

      return {
        order: { id: mustGet(orderByUuid, o.uuid).id },
        product: { id: product.id },
        key: product.key,
        currency: product.currency,
        priceCents: product.priceCents,
        quantity: item.quantity,
      };
    }),
  );

  let insertedItems = 0;

  if (itemRows.length > 0) {
    const items = await m
      .createQueryBuilder()
      .insert()
      .into(OrderItem)
      .values(itemRows)
      .returning(['id'])
      .execute();

    insertedItems = items.raw.length;
  }

  // fulfillments: one per paid order, idempotent on the unique order_id.
  const fulfillments = await m
    .createQueryBuilder()
    .insert()
    .into(Fulfillment)
    .values(
      ORDERS.filter(o => o.status === 'paid').map(o => ({
        order: { id: mustGet(orderByUuid, o.uuid).id },
        status: o.fulfillmentStatus ?? 'pending',
      })),
    )
    .orIgnore()
    .returning(['id'])
    .execute();

  return {
    users: users.raw.length,
    products: products.raw.length,
    inventory: inventory.raw.length,
    orders: orders.raw.length,
    order_items: insertedItems,
    fulfillments: fulfillments.raw.length,
  };
}

async function totals(): Promise<Record<TableName, number>> {
  const entries = await Promise.all(
    MAIN_TABLES.map(async table => {
      const [{ n }] = (await AppDataSource.query(
        `SELECT count(*)::int AS n FROM "${table}"`,
      )) as Array<{ n: number }>;

      return [table, n] as const;
    }),
  );

  return Object.fromEntries(entries) as Record<TableName, number>;
}

async function main(): Promise<void> {
  await AppDataSource.initialize();

  try {
    const inserted = await AppDataSource.transaction(run);
    const total = await totals();

    console.log('seed complete');

    for (const table of MAIN_TABLES) {
      console.log(
        `  ${table.padEnd(13)} +${inserted[table]}   (total ${total[table]})`,
      );
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
