import { Injectable } from '@nestjs/common';

import { Product as ProductEntity } from '../../entities/product.entity.ts';
import { CacheAsideService } from '../../services/cache/cache-aside.service.ts';
import { DataSourceService } from '../../services/data-source.service.ts';
import { decodeCursor, encodeCursor } from '../../utils/cursor.ts';

import type { Product, ProductListResponse } from './products.types.ts';
import {
  jitteredProductTtlSeconds,
  productCacheKey,
  toApiProduct,
} from './products.utils.ts';

@Injectable()
export class ProductsService {
  constructor(
    private readonly dataSourceService: DataSourceService,
    private readonly cacheAside: CacheAsideService,
  ) {}

  async list(limit = 20, cursor?: string): Promise<ProductListResponse> {
    const manager = await this.dataSourceService.getManager();
    const qb = manager
      .getRepository(ProductEntity)
      .createQueryBuilder('product')
      .orderBy('product.id', 'ASC')
      .take(limit + 1); // one extra row, to know if there's a next page

    if (cursor) {
      qb.andWhere('product.id > :id', decodeCursor(cursor));
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(toApiProduct),
      next_cursor: hasMore ? encodeCursor(page[page.length - 1].id) : null,
    };
  }

  async findById(id: number): Promise<Product | undefined> {
    const product = await this.cacheAside.getOrLoad<Product | null>(
      productCacheKey(id),
      { ttlSeconds: jitteredProductTtlSeconds },
      () => this.loadProductFromDb(id),
    );

    return product ?? undefined;
  }

  private async loadProductFromDb(id: number): Promise<Product | null> {
    const manager = await this.dataSourceService.getManager();
    const product = await manager
      .getRepository(ProductEntity)
      .findOneBy({ id });

    return product ? toApiProduct(product) : null;
  }

  // Admin-only write (ProductsController.updatePrice). Busts the cache
  // key rather than writing the new value into it directly — the next
  // findById() just re-reads the DB and repopulates, same as any other
  // cache miss, no special-cased "write-through" path to keep in sync.
  async updatePriceCents(
    id: number,
    priceCents: string,
  ): Promise<Product | undefined> {
    const manager = await this.dataSourceService.getManager();
    const repo = manager.getRepository(ProductEntity);

    // updatedAt is never set here — the set_updated_at() BEFORE UPDATE
    // trigger (see product.entity.ts's own comment) already stamps it on
    // any UPDATE to this row.
    const result = await repo.update({ id }, { priceCents });

    if (!result.affected) {
      return undefined;
    }

    await this.cacheAside.invalidate(productCacheKey(id));

    const product = await repo.findOneBy({ id });

    return product ? toApiProduct(product) : undefined;
  }
}
