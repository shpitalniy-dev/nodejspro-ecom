import { Injectable } from '@nestjs/common';

import { Product } from '../types/products.types.ts';
import { Currencies } from '../types/types.ts';

const products: Product[] = [
  {
    id: 1,
    name: 'Keyboard',
    price_cents: 4500,
    currency: Currencies.USD,
    created_at: new Date().toISOString(),
  },
  {
    id: 2,
    name: 'Mouse',
    price_cents: 2500,
    currency: Currencies.USD,
    created_at: new Date().toISOString(),
  },
];

@Injectable()
export class ProductService {
  list(): Product[] {
    return products;
  }

  findById(id: number): Product | undefined {
    return products.find(product => product.id === id);
  }
}
