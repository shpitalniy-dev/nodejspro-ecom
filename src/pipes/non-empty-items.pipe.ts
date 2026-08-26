import type { PipeTransform } from '@nestjs/common';
import { BadRequestException, Injectable } from '@nestjs/common';

interface CreateOrderBody {
  items?: unknown[];
}

@Injectable()
export class NonEmptyItemsPipe
  implements PipeTransform<CreateOrderBody, CreateOrderBody>
{
  transform(value: CreateOrderBody): CreateOrderBody {
    if (!Array.isArray(value.items) || value.items.length === 0) {
      throw new BadRequestException({
        title: 'Validation failed',
        detail: 'items must contain at least one entry',
        errors: [
          {
            field: '/body/items',
            constraints: ['must NOT have fewer than 1 items'],
          },
        ],
      });
    }

    return value;
  }
}
