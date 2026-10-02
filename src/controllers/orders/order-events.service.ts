import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { filter, Subject } from 'rxjs';

import type { OrderStatus } from '../../entities/order.entity.ts';

export interface OrderStatusEvent {
  // One counter for all orders, seeded from the clock at startup: ids only
  // ever grow, so a client's Last-Event-ID stays meaningful even after its
  // order's buffer was evicted, and across a restart. Ids are opaque and
  // only their order matters — they are not contiguous per order.
  id: number;
  orderId: number;
  status: OrderStatus;
  ts: number;
}

// Cap on how many past events an order remembers for SSE's Last-Event-ID
// resume — generous relative to how many status changes one order ever
// realistically goes through.
const BUFFER_SIZE = 50;

// How many orders keep a replay buffer at once. Past this, the least
// recently used order's buffer is dropped, so memory stays bounded. Live
// streams are unaffected (they subscribe to the Subject, not to the buffers);
// an evicted order just can't replay what it missed.
export const MAX_TRACKED_ORDERS = 10_000;

// The bus both realtime transports subscribe to. Deliberately knows
// nothing about socket.io or SSE — orders.gateway.ts and
// orders.controller.ts's SSE endpoint are the only two places that turn an
// OrderStatusEvent into a wire format. OrdersService.updateStatus() is the
// only writer, via publish().
@Injectable()
export class OrderEventsService {
  private readonly buffers = new Map<number, OrderStatusEvent[]>();
  private readonly subject = new Subject<OrderStatusEvent>();
  private seq = Date.now();

  publish(orderId: number, status: OrderStatus): OrderStatusEvent {
    const event: OrderStatusEvent = {
      id: ++this.seq,
      orderId,
      status,
      ts: Date.now(),
    };

    const buffer = this.touch(orderId) ?? this.insert(orderId);
    buffer.push(event);

    if (buffer.length > BUFFER_SIZE) {
      buffer.shift();
    }

    this.subject.next(event);

    return event;
  }

  // SSE resume: everything strictly newer than the client's Last-Event-ID.
  // Only publish() creates a buffer, so merely opening a stream for an order
  // never adds a Map entry.
  bufferedSince(orderId: number, lastEventId: number): OrderStatusEvent[] {
    return (this.touch(orderId) ?? []).filter(event => event.id > lastEventId);
  }

  streamFor(orderId: number): Observable<OrderStatusEvent> {
    return this.subject
      .asObservable()
      .pipe(filter(event => event.orderId === orderId));
  }

  // Gateway-only: relays every order's events to its own room, so the
  // gateway needs just one subscription for its whole lifetime instead of
  // one per joined room.
  streamAll(): Observable<OrderStatusEvent> {
    return this.subject.asObservable();
  }

  // LRU: a Map iterates in insertion order, so re-inserting an entry on every
  // use keeps the least recently used one first in line for eviction.
  private touch(orderId: number): OrderStatusEvent[] | undefined {
    const buffer = this.buffers.get(orderId);

    if (buffer) {
      this.buffers.delete(orderId);
      this.buffers.set(orderId, buffer);
    }

    return buffer;
  }

  private insert(orderId: number): OrderStatusEvent[] {
    if (this.buffers.size >= MAX_TRACKED_ORDERS) {
      const [leastRecentlyUsed] = this.buffers.keys();

      if (leastRecentlyUsed !== undefined) {
        this.buffers.delete(leastRecentlyUsed);
      }
    }

    const buffer: OrderStatusEvent[] = [];

    this.buffers.set(orderId, buffer);

    return buffer;
  }
}
