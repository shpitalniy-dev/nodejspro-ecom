import { Injectable } from '@nestjs/common';

import { Product as ProductEntity } from '../../entities/product.entity.ts';
import { DataSourceService } from '../../services/data-source.service.ts';
import type { Product } from '../../types/products.types.ts';

import { toApiProduct } from './products.utils.ts';

@Injectable()
export class ProductsService {
  constructor(private readonly dataSourceService: DataSourceService) {}

  async list(): Promise<Product[]> {
    const manager = await this.dataSourceService.getManager();
    const products = await manager
      .getRepository(ProductEntity)
      .find({ order: { id: 'ASC' } });

    return products.map(toApiProduct);
  }

  async findById(id: number): Promise<Product | undefined> {
    const manager = await this.dataSourceService.getManager();
    const product = await manager
      .getRepository(ProductEntity)
      .findOneBy({ id });

    return product ? toApiProduct(product) : undefined;
  }
}
