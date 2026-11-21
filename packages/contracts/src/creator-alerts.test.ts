import { describe, expect, it } from 'vitest';

import {
  acceptsRouting,
  CREATOR_ALERT_CODES,
  CREATOR_ALERT_DEFAULTS,
  CREATOR_ALERT_ERROR_CODES,
  CREATOR_ALERT_FAMILY,
  CREATOR_ALERT_ROLES,
  isCreatorAlertLocked,
  LOCKED_CREATOR_ALERTS,
  SetCreatorAlertBodySchema,
} from './creator-alerts';

describe('creator alerts (ADR 0150)', () => {
  it('gives every alert a family and a default for each role', () => {
    for (const code of CREATOR_ALERT_CODES) {
      expect(CREATOR_ALERT_FAMILY[code]).toBeDefined();
      for (const role of CREATOR_ALERT_ROLES) expect(CREATOR_ALERT_DEFAULTS[code][role]).toBeDefined();
    }
  });

  it('locks the safety relays on deliver for every role, defaults included', () => {
    expect(LOCKED_CREATOR_ALERTS).toEqual(['safety_handoff']);
    for (const code of LOCKED_CREATOR_ALERTS) {
      expect(acceptsRouting(code, CREATOR_ALERT_DEFAULTS[code])).toBe(true);
      for (const role of CREATOR_ALERT_ROLES) {
        for (const mode of ['muted', 'off'] as const) {
          expect(acceptsRouting(code, { ...CREATOR_ALERT_DEFAULTS[code], [role]: mode })).toBe(false);
        }
      }
    }
  });

  it('lets any other alert be muted or switched off for any role', () => {
    const quiet = { owner: 'off', manager: 'muted', chatter_on_shift: 'off' } as const;
    for (const code of CREATOR_ALERT_CODES.filter((c) => !isCreatorAlertLocked(c))) {
      expect(acceptsRouting(code, quiet)).toBe(true);
    }
  });

  it('takes the three roles whole, nothing else', () => {
    expect(
      SetCreatorAlertBodySchema.safeParse({
        routes: { owner: 'deliver', manager: 'muted', chatter_on_shift: 'off' },
      }).success,
    ).toBe(true);
    expect(SetCreatorAlertBodySchema.safeParse({ routes: { owner: 'deliver' } }).success).toBe(false);
    expect(
      SetCreatorAlertBodySchema.safeParse({
        routes: { owner: 'loud', manager: 'muted', chatter_on_shift: 'off' },
      }).success,
    ).toBe(false);
  });

  it('gives every error code a suffix that sets its status (api.md)', () => {
    for (const code of CREATOR_ALERT_ERROR_CODES) {
      expect(code).toMatch(/_(not_found|unprocessable)$/u);
    }
  });
});
