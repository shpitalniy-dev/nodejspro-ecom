import { SetMetadata } from '@nestjs/common';

import type { UserRole } from '../../entities/user.entity.ts';

export const ROLES_KEY = 'roles';

// Only meaningful behind @UseGuards(AuthGuard, RolesGuard), in that
// order — RolesGuard reads the roles this decorator attaches to the
// handler, then checks them against request.user, which AuthGuard is
// what actually populates.
export const Roles = (...roles: UserRole[]): MethodDecorator =>
  SetMetadata(ROLES_KEY, roles);
