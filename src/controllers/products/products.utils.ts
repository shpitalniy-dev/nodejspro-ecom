import { Product as ProductEntity } from '../../entities/product.entity.ts';
import type { Currency } from '../../types/index.ts';

import type { Product } from './products.types.ts';

export function toApiProduct(entity: ProductEntity): Product {
  return {
    id: entity.id,
    key: entity.key,
    price_cents: Number(entity.priceCents),
    currency: entity.currency as Currency,
    created_at: entity.createdAt.toISOString(),
  };
}

export const productCacheKey = (id: number): string => `product:${id}`;

export const jitteredProductTtlSeconds = (): number =>
  300 + Math.floor(Math.random() * 61);
