import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  asPersonaV2,
  ChatterPersonaSchema,
  ChatterPersonaSheetSchema,
  StoredPersonaSchema,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { chatterSheetOf } from '../sheet';

/** The fictional demo persona of the repository (ADR 0010: never a real one in a test). */
const demo = StoredPersonaSchema.parse(
  parse(
    readFileSync(
      fileURLToPath(new URL('../../../../../../../personas/demo/v0.4.0.yaml', import.meta.url)),
      'utf8',
    ),
  ),
);

describe('chatterSheetOf (ADR 0153)', () => {
  const sheet = chatterSheetOf(demo, '2026-11-20');
  const v2 = asPersonaV2(demo);

  it('reads as the chatter contract, nothing more', () => {
    expect(ChatterPersonaSheetSchema.parse(sheet)).toEqual(sheet);
    expect(Object.keys(sheet)).toEqual([
      'her',
      'physique',
      'lifestyle',
      'preferences',
      'writing',
      'limits',
      'intimate',
    ]);
  });

  it('refuses any key outside its list, at every level: a field forgotten never leaks (Charles, 21/11)', () => {
    expect(ChatterPersonaSheetSchema.safeParse({ ...sheet, strategies: {} }).success).toBe(false);
    expect(
      ChatterPersonaSheetSchema.safeParse({ ...sheet, her: { ...sheet.her, birth_date: '2000-01-01' } })
        .success,
    ).toBe(false);
    expect(
      ChatterPersonaSchema.safeParse({
        creatorId: '00000000-0000-4000-8000-000000000000',
        sheet,
        versions: [],
      }).success,
    ).toBe(false);
  });

  it('gives her age on the day, never her birth date', () => {
    expect(sheet.her.age).toBeGreaterThanOrEqual(18);
    expect(JSON.stringify(sheet)).not.toContain(v2.sheet.identity.birth_date);
  });

  it('keeps every limit of hers, and never the agency’s method', () => {
    expect(sheet.limits.never_say).toEqual(v2.agent.rules.never_say);
    expect(sheet.limits.disgusts).toEqual(v2.agent.rules.disgusts);
    expect(sheet.writing.emojis_forbidden).toEqual(v2.agent.rules.emojis_forbidden);
    const text = JSON.stringify(sheet);
    for (const key of [
      'strategies',
      'follow_ups',
      'notifications',
      'alert_keywords',
      'objection_replies',
      'min_desire',
      'cooldown_hours',
      'response_delay_minutes',
      'birth_date',
      'meta',
    ])
      expect(text, key).not.toContain(`"${key}"`);
  });

  it('puts her no-go zones with her limits, not with the intimate', () => {
    expect(sheet.limits.no_go_zones).toBe(v2.sheet.intimacy.no_go_zones);
    expect(Object.keys(sheet.intimate)).not.toContain('no_go_zones');
  });
});
