export const Currencies = {
  USD: 'USD',
} as const;

export type Currency = (typeof Currencies)[keyof typeof Currencies];

// Shared shape for every cursor-paginated list endpoint (GET /products,
// GET /orders, ...) — matches openapi.yaml's ProductListResponse/
// OrderListResponse schemas, which are structurally identical.
export interface ListResponse<T> {
  items: T[];
  next_cursor: string | null;
}
