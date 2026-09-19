import { Product as ProductEntity } from '../../entities/product.entity.ts';
import type { Product } from '../../types/products.types.ts';
import type { Currency } from '../../types/types.ts';

export function toApiProduct(entity: ProductEntity): Product {
  return {
    id: entity.id,
    key: entity.key,
    price_cents: Number(entity.priceCents),
    currency: entity.currency as Currency,
    created_at: entity.createdAt.toISOString(),
  };
}
