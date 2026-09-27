import { Injectable } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { filter, Subject } from 'rxjs';

import type { OrderStatus } from '../../entities/order.entity.ts';

export interface OrderStatusEvent {
  // Per-order sequence starting at 1 — not a global counter — so a fresh
  // order's first status change is always event id 1, matching what a
  // Last-Event-ID walkthrough against one order expects to see.
  id: number;
  orderId: number;
  status: OrderStatus;
  ts: number;
}

interface OrderEventState {
  nextId: number;
  buffer: OrderStatusEvent[];
}

// Cap on how many past events an order remembers for SSE's Last-Event-ID
// resume — generous relative to how many status changes one order ever
// realistically goes through.
const BUFFER_SIZE = 50;

// The bus both realtime transports subscribe to. Deliberately knows
// nothing about socket.io or SSE — orders.gateway.ts and
// orders.controller.ts's SSE endpoint are the only two places that turn an
// OrderStatusEvent into a wire format. OrdersService.updateStatus() is the
// only writer, via publish().
@Injectable()
export class OrderEventsService {
  private readonly states = new Map<number, OrderEventState>();
  private readonly subject = new Subject<OrderStatusEvent>();

  private stateFor(orderId: number): OrderEventState {
    let state = this.states.get(orderId);

    if (!state) {
      state = { nextId: 1, buffer: [] };
      this.states.set(orderId, state);
    }

    return state;
  }

  publish(orderId: number, status: OrderStatus): OrderStatusEvent {
    const state = this.stateFor(orderId);
    const event: OrderStatusEvent = {
      id: state.nextId++,
      orderId,
      status,
      ts: Date.now(),
    };

    state.buffer.push(event);

    if (state.buffer.length > BUFFER_SIZE) {
      state.buffer.shift();
    }

    this.subject.next(event);

    return event;
  }

  // SSE resume: everything strictly newer than the client's Last-Event-ID.
  bufferedSince(orderId: number, lastEventId: number): OrderStatusEvent[] {
    return this.stateFor(orderId).buffer.filter(
      event => event.id > lastEventId,
    );
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
}
