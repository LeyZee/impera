import { describe, expect, it } from 'vitest';

import {
  AGENCY_PRIVATE_STYLE_MAX,
  AGENCY_PUBLIC_STYLE_MAX,
  AGENCY_STYLE_ERROR_CODES,
  ActivateAgencyStyleBodySchema,
  AgencyStyleVersionSchema,
  SaveAgencyStyleBodySchema,
} from './agency-style';
import { AUDIT_ACTIONS } from './audit-actions';
import { ErrorCodeSchema } from './errors';

// Invented texts only: the agency's real style lives in its base (ADR 0173).
const body = { privateStyle: 'Phrase de style inventée', publicStyle: '', form: {} };

describe('the agency’s base style (ADR 0173)', () => {
  it('takes two bounded texts, trimmed, and the form settings of a persona', () => {
    expect(
      SaveAgencyStyleBodySchema.parse({ ...body, publicStyle: '  Autre phrase inventée  ' }).publicStyle,
    ).toBe('Autre phrase inventée');
    expect(
      SaveAgencyStyleBodySchema.safeParse({ ...body, privateStyle: 'x'.repeat(AGENCY_PRIVATE_STYLE_MAX) })
        .success,
    ).toBe(true);
    expect(
      SaveAgencyStyleBodySchema.safeParse({ ...body, privateStyle: 'x'.repeat(AGENCY_PRIVATE_STYLE_MAX + 1) })
        .success,
    ).toBe(false);
    expect(
      SaveAgencyStyleBodySchema.safeParse({ ...body, publicStyle: 'x'.repeat(AGENCY_PUBLIC_STYLE_MAX + 1) })
        .success,
    ).toBe(false);
    expect(
      SaveAgencyStyleBodySchema.safeParse({
        ...body,
        form: { capitalization: 'lowercase', emoji_streak_max: 2 },
      }).success,
    ).toBe(true);
    expect(SaveAgencyStyleBodySchema.safeParse({ ...body, form: { emoji_streak_max: 0 } }).success).toBe(
      false,
    );
  });

  it('refuses what it does not name, and a body without one of its parts', () => {
    expect(SaveAgencyStyleBodySchema.safeParse({ ...body, isActive: true }).success).toBe(false);
    expect(SaveAgencyStyleBodySchema.safeParse({ ...body, form: { tone: 'doux' } }).success).toBe(false);
    expect(SaveAgencyStyleBodySchema.safeParse({ privateStyle: '', form: {} }).success).toBe(false);
    expect(ActivateAgencyStyleBodySchema.safeParse({}).success).toBe(false);
    expect(ActivateAgencyStyleBodySchema.safeParse({ expectedActive: null }).success).toBe(true);
  });

  it('reads a version as the server writes it', () => {
    expect(
      AgencyStyleVersionSchema.safeParse({
        ...body,
        id: '0199f2a0-0000-7000-8000-0000000000a1',
        version: 1,
        isActive: false,
        createdAt: '2026-11-26T20:00:00Z',
        activatedAt: null,
      }).success,
    ).toBe(true);
  });

  it('publishes error codes whose suffix gives the status', () => {
    for (const code of AGENCY_STYLE_ERROR_CODES) expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
  });

  it('journals its versions by number, never by text', () => {
    const context = { entityId: null, member: () => 'un membre', creator: () => 'une créatrice' };
    const activate = AUDIT_ACTIONS['agency_style.activate'];
    const create = AUDIT_ACTIONS['agency_style.create'];
    if (activate === undefined || create === undefined) throw new Error('both actions are journaled');
    expect(activate.describe({ version: 3, privateStyle: 'Phrase de style inventée' }, context)).toEqual({
      label: 'a activé la version 3 du style de base de l’agence',
      link: null,
    });
    expect(create.details.parse({ version: 1, privateStyle: 'x' })).toEqual({
      version: 1,
    });
  });
});
