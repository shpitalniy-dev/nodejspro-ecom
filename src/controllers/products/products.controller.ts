import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
} from '@nestjs/common';

import { ProductService } from '../../services/product.service.ts';

@Controller('products')
export class ProductsController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  list(
    @Query('limit', ParseIntPipe) _limit: number,
    @Query('cursor') _cursor: string,
  ) {
    return { items: this.productService.list(), next_cursor: null };
  }

  @Get(':productId')
  getOne(@Param('productId', ParseIntPipe) productId: number) {
    const product = this.productService.findById(productId);

    if (!product) {
      throw new NotFoundException({
        title: 'Product not found',
        detail: `Product "${productId}" not found.`,
      });
    }

    return product;
  }
}
