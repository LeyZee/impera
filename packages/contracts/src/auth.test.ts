import { describe, expect, it } from 'vitest';

import { CurrentUserSchema, UserRoleSchema } from './auth';

describe('auth contracts', () => {
  it('knows the three roles and nothing else', () => {
    expect(UserRoleSchema.options).toEqual(['owner', 'operator', 'creator']);
    expect(UserRoleSchema.safeParse('admin').success).toBe(false);
  });

  it('describes the signed-in user without any token', () => {
    const user = { id: 'u1', email: 'owner@example.test', name: 'Owner', role: 'owner', creatorIds: [] };
    expect(CurrentUserSchema.parse({ ...user, token: 'secret' })).toEqual({ ...user, routedCreatorIds: [] });
  });
});
