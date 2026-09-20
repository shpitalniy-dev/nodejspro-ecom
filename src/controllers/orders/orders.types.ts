import type { ListResponse } from '../../types/index.ts';
import { Currency } from '../../types/index.ts';

export interface OrderItem {
  productId: number;
  quantity: number;
}

export interface Order {
  id: number;
  status: 'unpaid' | 'paid';
  total_cents: number;
  currency: Currency;
  items: OrderItem[];
  created_at: string;
}

export type OrderListResponse = ListResponse<Order>;
