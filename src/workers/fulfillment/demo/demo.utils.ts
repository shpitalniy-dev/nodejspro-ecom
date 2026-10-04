import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { DataSource } from 'typeorm';

import { validateWorker } from '../../../config/env.schema.ts';
import { OrderEventPublisher } from '../../../controllers/orders/orders.publisher.ts';
import {
  ORDER_RELATIONS,
  toApiOrder,
} from '../../../controllers/orders/orders.utils.ts';
import { Inventory } from '../../../entities/inventory.entity.ts';
import { Order } from '../../../entities/order.entity.ts';
import { Product } from '../../../entities/product.entity.ts';
import { User } from '../../../entities/user.entity.ts';
import { connectBroker } from '../../../services/rabbitmq/rabbitmq.connection.ts';
import { RabbitMqService } from '../../../services/rabbitmq/rabbitmq.service.ts';
import {
  declareTopology,
  QUEUE,
  resetTopology,
} from '../../../services/rabbitmq/rabbitmq.topology.ts';
import { checkout } from '../../../transactions/checkout.ts';
import { waitUntil } from '../../../utils/wait-until.ts';
import type { WorkerEvent } from '../fulfillment.events.ts';

// Shared by the three demos (demo-publish, demo-dlq, demo-duplicate). Every
// demo resets its own state, starts the real worker, and checks its own
// invariant.

const DEMO_BUYER_EMAIL = 'demo-buyer@seed.example';
const DEMO_PRODUCT_KEY = 'sku-concurrency-demo';
const BUYER_BALANCE_CENTS = '100000';

// Demo reset: queues and exchanges are deleted and redeclared. Arguments can't
// change on an existing queue, so a clean state means delete and recreate.
export async function resetBroker(brokerUrl: string): Promise<void> {
  const connection = await connectBroker(brokerUrl);

  try {
    const channel = await connection.createChannel();

    await resetTopology(channel);
    await declareTopology(channel);
  } finally {
    await connection.close();
  }
}

// Resets the demo buyer's balance and the demo product's stock, and returns
// the buyer's id. The same baseline every run, so demos never run out.
export async function resetDemoFixtures(
  dataSource: DataSource,
  stock: number,
): Promise<number> {
  const buyer = await dataSource
    .getRepository(User)
    .findOneByOrFail({ email: DEMO_BUYER_EMAIL });
  const product = await dataSource
    .getRepository(Product)
    .findOneByOrFail({ key: DEMO_PRODUCT_KEY });
  const inventory = await dataSource
    .getRepository(Inventory)
    .findOneByOrFail({ product: { id: product.id } });

  await dataSource
    .getRepository(User)
    .update(buyer.id, { balanceCents: BUYER_BALANCE_CENTS });
  await dataSource
    .getRepository(Inventory)
    .update(inventory.id, { quantity: stock });

  return buyer.id;
}

// checkout() commits each order, then the real publisher sends it. A failed
// publish is logged and left out of the result, so the caller can count it.
export async function publishOrders(
  dataSource: DataSource,
  publisher: OrderEventPublisher,
  buyerId: number,
  count: number,
): Promise<number[]> {
  const orderIds: number[] = [];

  for (let i = 0; i < count; i++) {
    const { orderId } = await checkout(dataSource, {
      userId: buyerId,
      items: [{ productKey: DEMO_PRODUCT_KEY, quantity: 1 }],
    });
    const entity = await dataSource.getRepository(Order).findOneOrFail({
      where: { id: orderId },
      relations: ORDER_RELATIONS,
    });

    try {
      await publisher.publishOrderPlaced(toApiOrder(entity));
      orderIds.push(orderId);
    } catch (error) {
      console.error(`publish failed for order ${orderId}:`, error);
    }
  }

  return orderIds;
}

// How many orders in this run have a fulfilment row, which is the effect.
export async function countFulfillments(
  dataSource: DataSource,
  orderIds: number[],
): Promise<number> {
  const [{ n }] = await dataSource.query(
    'SELECT count(*)::int AS n FROM fulfillments WHERE order_id = ANY($1)',
    [orderIds],
  );

  return n;
}

// Nest context for the demos that publish: just the producer and its broker
// connection, no HTTP and no worker.
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateWorker })],
  providers: [RabbitMqService, OrderEventPublisher],
})
export class DemoPublisherModule {}

export type WorkerLog = Record<WorkerEvent, number>;

export interface WorkerExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface RunningWorker {
  // A copy of the counts the worker has reported over IPC so far.
  readonly log: WorkerLog;
  readonly exited: Promise<WorkerExit>;
  stop(): Promise<void>;
}

// Waits until the worker is consuming. The broker reports consumerCount on the
// work queue. Fails fast if the worker exits first.
async function waitUntilConsuming(
  brokerUrl: string,
  exited: Promise<WorkerExit>,
): Promise<void> {
  const state: { exit: WorkerExit | null } = { exit: null };

  void exited.then(exit => {
    state.exit = exit;
  });

  const connection = await connectBroker(brokerUrl);

  try {
    const channel = await connection.createChannel();
    const consuming = await waitUntil(
      async () =>
        state.exit !== null ||
        (await channel.checkQueue(QUEUE)).consumerCount >= 1,
      15_000,
    );

    if (state.exit !== null) {
      throw new Error(
        `worker exited before it was ready (code ${state.exit.code}, signal ${state.exit.signal})`,
      );
    }

    if (!consuming) {
      throw new Error('worker did not start consuming within 15 seconds');
    }
  } finally {
    await connection.close();
  }
}

// Starts the production worker entry (fulfillment.main.js) as a child process.
// The 'ipc' stdio entry gives the worker a message channel back to this demo,
// so each event arrives as a message instead of text to parse.
// `extraEnv` lets a demo switch on a demo-only behaviour (the duplicate demo's
// crash point).
//
// DEMO ONLY: DB config comes from DB_URL, which is the admin URL that the
// grader and with-secrets.sh provide, so the worker runs as admin here. The
// password goes to the worker through a temp file, the same way the API reads
// its password. Production runs the worker as app_user.
export async function startFulfillmentWorker(
  dbUrl: URL,
  brokerUrl: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<RunningWorker> {
  const passwordDir = await mkdtemp(path.join(os.tmpdir(), 'demo-worker-'));
  const passwordFile = path.join(passwordDir, 'db-password');

  await writeFile(passwordFile, decodeURIComponent(dbUrl.password), {
    mode: 0o600,
  });

  // This file sits in demo/, the worker entry one level up.
  const child: ChildProcess = spawn(
    process.execPath,
    [path.join(import.meta.dirname, '..', 'fulfillment.main.js')],
    {
      env: {
        ...process.env,
        DB_HOST: dbUrl.hostname,
        DB_PORT: dbUrl.port,
        DB_NAME: dbUrl.pathname.slice(1),
        DB_USER: decodeURIComponent(dbUrl.username),
        DB_PASSWORD_FILE: passwordFile,
        BROKER_URL: brokerUrl,
        ...extraEnv,
      },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    },
  );

  const log: WorkerLog = {
    delivered: 0,
    acked: 0,
    rejected: 0,
    requeued: 0,
    skipped: 0,
  };

  child.on('message', message => {
    const { event } = message as { event: WorkerEvent };

    log[event]++;
  });

  // 'close' rather than 'exit': it fires after the IPC channel has been read to
  // its end, so the last events a crashed worker sent are already counted.
  const exited = new Promise<WorkerExit>(resolve =>
    child.once('close', (code, signal) => resolve({ code, signal })),
  );

  try {
    await waitUntilConsuming(brokerUrl, exited);
  } catch (error) {
    child.kill('SIGKILL');
    await rm(passwordDir, { recursive: true, force: true });
    throw error;
  }

  return {
    get log() {
      return { ...log };
    },
    exited,
    async stop() {
      // A worker killed by a signal has exitCode null and signalCode set, so
      // both fields are checked before sending SIGTERM.
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await exited;
      }

      await rm(passwordDir, { recursive: true, force: true });
    },
  };
}
