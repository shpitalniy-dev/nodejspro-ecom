// HW#18 headless demo: two socket.io clients, two orders, one status
// change. Proves room isolation rather than asserting it — --same-room
// puts both clients in order A's room, flipping the expected B_RECEIVED
// from 0 to 1 using the exact same code path, so a script that always
// prints a constant fails this control run instead of passing by luck.
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const SAME_ROOM = process.argv.includes('--same-room');
const JOIN_TIMEOUT_MS = 5000;
const DELIVERY_WAIT_MS = 500;

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();

  if (!res.ok) {
    throw new Error(
      `${init?.method ?? 'GET'} ${url} -> ${res.status}: ${text}`,
    );
  }

  return text ? JSON.parse(text) : undefined;
}

async function findProductIds() {
  const page = await fetchJson(`${BASE_URL}/products?limit=20`);

  if (page.items.length === 0) {
    throw new Error('no products found — run `npm run seed` first');
  }

  return page.items.map(product => product.id);
}

// Doesn't hardcode a productId — stock is a seed-data detail, not a
// contract this script should depend on. Tries each candidate until one
// has stock; the winner also becomes the order this call returns.
async function createOrder(candidateProductIds) {
  let lastError;

  for (const productId of candidateProductIds) {
    try {
      return await fetchJson(`${BASE_URL}/orders`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': randomUUID(),
        },
        body: JSON.stringify({ items: [{ productId, quantity: 1 }] }),
      });
    } catch (error) {
      lastError = error; // most likely 409 out-of-stock — try the next product
    }
  }

  throw new Error(
    `could not create an order with any candidate product: ${lastError}`,
  );
}

async function patchStatus(orderId, status) {
  await fetchJson(`${BASE_URL}/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status }),
  });
}

function connect() {
  return io(BASE_URL, { transports: ['websocket'], reconnection: false });
}

// Waits for the join ack per the homework's own hint: change status only
// after the client is actually in the room, never racing the two. Also
// races against a rejected join's 'exception' event (OrderOwnershipGuard
// throwing) so a refusal fails fast instead of waiting out the ack timeout.
function join(socket, orderId, userId) {
  return new Promise((resolve, reject) => {
    const onException = err => {
      reject(
        new Error(`join(orderId=${orderId}) rejected: ${JSON.stringify(err)}`),
      );
    };

    socket.once('exception', onException);

    socket
      .timeout(JOIN_TIMEOUT_MS)
      .emit('join', { orderId, userId }, (timeoutErr, ack) => {
        socket.off('exception', onException);

        if (timeoutErr) {
          reject(
            new Error(`join(orderId=${orderId}) timed out waiting for ack`),
          );

          return;
        }

        if (!ack?.ok) {
          reject(
            new Error(
              `join(orderId=${orderId}) refused: ${JSON.stringify(ack)}`,
            ),
          );

          return;
        }

        resolve(ack);
      });
  });
}

async function main() {
  const productIds = await findProductIds();

  const orderA = await createOrder(productIds);
  const orderB = await createOrder(productIds);

  const clientA = connect();
  const clientB = connect();

  let aReceived = false;
  let bReceived = false;

  clientA.on('order.status', event => {
    if (event.orderId === orderA.id) {
      aReceived = true;
    }
  });
  clientB.on('order.status', () => {
    bReceived = true;
  });

  await join(clientA, orderA.id, orderA.user_id);

  // The one line --same-room needs: which room (and whose user id, since
  // ownership is checked against it) client B joins.
  const roomBOrderId = SAME_ROOM ? orderA.id : orderB.id;
  const roomBUserId = SAME_ROOM ? orderA.user_id : orderB.user_id;

  await join(clientB, roomBOrderId, roomBUserId);

  await patchStatus(orderA.id, 'refunded');
  await new Promise(resolve => setTimeout(resolve, DELIVERY_WAIT_MS));

  console.log(`A_RECEIVED=${aReceived ? 1 : 0}`);
  console.log(`B_RECEIVED=${bReceived ? 1 : 0}`);

  clientA.close();
  clientB.close();

  const expectedBReceived = SAME_ROOM;
  const ok = aReceived && bReceived === expectedBReceived;

  process.exit(ok ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
