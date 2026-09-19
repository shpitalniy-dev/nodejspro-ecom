import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';

import { ProductsService } from './products.service.ts';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async list(
    @Query('limit', ParseIntPipe) _limit: number,
    @Query('cursor') _cursor: string,
  ) {
    return { items: await this.productsService.list(), next_cursor: null };
  }

  @Get(':productId')
  async getOne(@Param('productId', ParseIntPipe) productId: number) {
    const product = await this.productsService.findById(productId);

    if (!product) {
      throw new NotFoundException({
        title: 'Product not found',
        detail: `Product "${productId}" not found.`,
      });
    }

    return product;
  }
}
