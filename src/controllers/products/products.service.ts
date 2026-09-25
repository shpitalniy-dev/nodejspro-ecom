import { Injectable } from '@nestjs/common';

import { Product as ProductEntity } from '../../entities/product.entity.ts';
import { DataSourceService } from '../../services/data-source.service.ts';
import { decodeCursor, encodeCursor } from '../../utils/cursor.ts';

import type { Product, ProductListResponse } from './products.types.ts';
import { toApiProduct } from './products.utils.ts';

@Injectable()
export class ProductsService {
  constructor(private readonly dataSourceService: DataSourceService) {}

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
    const manager = await this.dataSourceService.getManager();
    const product = await manager
      .getRepository(ProductEntity)
      .findOneBy({ id });

    return product ? toApiProduct(product) : undefined;
  }
}
