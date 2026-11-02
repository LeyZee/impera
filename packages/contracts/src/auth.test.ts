import { describe, expect, it } from 'vitest';

import {
  CurrentUserSchema,
  isBackupCode,
  SecondFactorCodeSchema,
  SignInAnswerSchema,
  UserRoleSchema,
} from './auth';

describe('auth contracts', () => {
  it('knows the three roles and nothing else', () => {
    expect(UserRoleSchema.options).toEqual(['owner', 'operator', 'creator']);
    expect(UserRoleSchema.safeParse('admin').success).toBe(false);
  });

  it('describes the signed-in user without any token', () => {
    const user = { id: 'u1', email: 'owner@example.test', name: 'Owner', role: 'owner', creatorIds: [] };
    expect(CurrentUserSchema.parse({ ...user, token: 'secret' })).toEqual({ ...user, routedCreatorIds: [] });
  });

  it('reads an authenticator code or a backup code, spaces dropped, and nothing else', () => {
    expect(SecondFactorCodeSchema.parse(' 123 456 ')).toBe('123456');
    expect(SecondFactorCodeSchema.parse('aB3dE-9fGh1')).toBe('aB3dE-9fGh1');
    expect(isBackupCode(SecondFactorCodeSchema.parse('aB3dE-9fGh1'))).toBe(true);
    expect(isBackupCode(SecondFactorCodeSchema.parse('123456'))).toBe(false);
    for (const wrong of ['12345', '1234567', 'abcdef', 'aB3dE9fGh1', 'aB3dE-9fGh', '']) {
      expect(SecondFactorCodeSchema.safeParse(wrong).success).toBe(false);
    }
  });

  it('tells a sign-in that waits for the code from one that opened a session', () => {
    expect(SignInAnswerSchema.parse({ twoFactorRedirect: true, twoFactorMethods: ['totp'] })).toEqual({
      twoFactorRedirect: true,
    });
    expect(SignInAnswerSchema.parse({ user: { id: 'u1', email: 'a@example.test' } })).toEqual({
      user: { id: 'u1' },
    });
  });
});
