import { Currency } from './types.ts';

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

export interface CreateOrderBody {
  items: OrderItem[];
}
