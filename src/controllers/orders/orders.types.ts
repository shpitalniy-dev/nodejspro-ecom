import type { OrderStatus } from '../../entities/order.entity.ts';
import type { ListResponse } from '../../types/index.ts';
import { Currency } from '../../types/index.ts';

export interface OrderItem {
  productId: number;
  quantity: number;
}

export interface Order {
  id: number;
  // Was narrowed to 'unpaid' | 'paid' — the only two values checkout() ever
  // produced. HW#18's status-change endpoint can now set any OrderStatus,
  // so this endpoint's response type has to admit all four too.
  status: OrderStatus;
  total_cents: number;
  currency: Currency;
  items: OrderItem[];
  created_at: string;
  // Needed by the WS gateway's ownership check (see orders.gateway.ts) and
  // by scripts/realtime-demo.mjs, which has no other way to learn which
  // user id a freshly created order belongs to — there's no auth yet (see
  // orders.service.ts's own note), so the client has to be told explicitly.
  user_id: number;
}

export type OrderListResponse = ListResponse<Order>;
