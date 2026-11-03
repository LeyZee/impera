import { describe, expect, it } from 'vitest';

import { REAUTHENTICATION_ERROR_CODE } from './auth';
import {
  CreateCreatorInvitationLinkBodySchema,
  INVITATION_LINK_ERROR_CODES,
  InvitationLinkPreviewSchema,
  InvitationLinkTokenSchema,
  PASSWORD_MIN_LENGTH,
  PasswordInvalidReasonSchema,
  RedeemInvitationLinkBodySchema,
} from './invitation-links';

const LINK = 'lien-invente-pour-les-tests';

describe('invitation links', () => {
  it('takes a base64url token of at least 128 bits, and nothing that could carry a query', () => {
    expect(InvitationLinkTokenSchema.safeParse(LINK).success).toBe(true);
    expect(InvitationLinkTokenSchema.safeParse('court').success).toBe(false);
    expect(InvitationLinkTokenSchema.safeParse(`${LINK}&next=/reglages`).success).toBe(false);
  });

  it('refuses a password shorter than the one Better Auth accepts', () => {
    const body = (password: string) => RedeemInvitationLinkBodySchema.safeParse({ token: LINK, password });
    expect(body('x'.repeat(PASSWORD_MIN_LENGTH - 1)).success).toBe(false);
    expect(body('x'.repeat(PASSWORD_MIN_LENGTH)).success).toBe(true);
  });

  it('shows the invited member what the page needs, nothing more', () => {
    const preview = InvitationLinkPreviewSchema.parse({
      purpose: 'invitation',
      account: 'member',
      email: 'theo@example.test',
      displayName: 'Théo',
      country: 'BJ',
      expiresAt: '2026-10-30T15:00:00.000Z',
      memberId: 'not part of the preview',
    });
    expect(Object.keys(preview).sort()).toEqual([
      'account',
      'country',
      'displayName',
      'email',
      'expiresAt',
      'purpose',
    ]);
  });

  it('names why a password is refused and what the owner meets when making a link', () => {
    expect(PasswordInvalidReasonSchema.options).toEqual(['too_short', 'too_long', 'breached', 'refused']);
    expect(INVITATION_LINK_ERROR_CODES).toContain(REAUTHENTICATION_ERROR_CODE);
    expect(INVITATION_LINK_ERROR_CODES).toContain('member_left_conflict');
  });

  it('names her e-mail on a creator’s invitation, and nothing on her reset (CR-02)', () => {
    expect(
      CreateCreatorInvitationLinkBodySchema.safeParse({ purpose: 'invitation', email: 'nora@example.test' })
        .success,
    ).toBe(true);
    expect(CreateCreatorInvitationLinkBodySchema.safeParse({ purpose: 'invitation' }).success).toBe(false);
    expect(CreateCreatorInvitationLinkBodySchema.safeParse({ purpose: 'reset' }).success).toBe(true);
    expect(
      CreateCreatorInvitationLinkBodySchema.safeParse({ purpose: 'reset', email: 'nora@example.test' })
        .success,
    ).toBe(false);
  });

  it('previews a creator’s own account without a country', () => {
    const preview = {
      purpose: 'invitation',
      email: 'nora@example.test',
      account: 'creator',
      displayName: 'Nora',
      expiresAt: '2026-11-06T12:00:00.000Z',
    };
    expect(InvitationLinkPreviewSchema.safeParse(preview).success).toBe(true);
    // A member always has his country; a creator's account says it is hers, not a member's without one.
    expect(InvitationLinkPreviewSchema.safeParse({ ...preview, account: 'member' }).success).toBe(false);
    expect(
      InvitationLinkPreviewSchema.safeParse({ ...preview, account: undefined, country: null }).success,
    ).toBe(false);
  });
});
