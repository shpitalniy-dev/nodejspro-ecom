import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AuthGuard, RolesGuard } from '../auth/auth.guards.ts';
import { Roles } from '../auth/roles.decorator.ts';

import { UpdateProductDto } from './products.dto.ts';
import { ProductsListRateLimitGuard } from './products.guards.ts';
import { ProductsService } from './products.service.ts';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @UseGuards(ProductsListRateLimitGuard)
  async list(
    @Query('limit', ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ) {
    return this.productsService.list(limit, cursor);
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

  @Patch(':productId')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('admin')
  async updatePrice(
    @Param('productId', ParseIntPipe) productId: number,
    @Body() body: UpdateProductDto,
  ) {
    const product = await this.productsService.updatePriceCents(
      productId,
      String(body.price_cents),
    );

    if (!product) {
      throw new NotFoundException({
        title: 'Product not found',
        detail: `Product "${productId}" not found.`,
      });
    }

    return product;
  }
}
