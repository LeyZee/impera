import { CreatorIdSchema, CreatorContentSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  ASKABLE_CATEGORIES,
  askProblems,
  askableStructures,
  cadenceNote,
  everyText,
  requestGroups,
  type AskDraft,
} from './model';

import { structureOf } from '@/creators/scripts/fixtures';
import { dropOf, requestOf } from '@/screens/content/fixtures';

/* An invented creator and her requests (ADR 0010). */
const HER = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const OTHER = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c2');
const TODAY = '2026-11-06';
const NIGHT = structureOf('0192f3a0-0000-7000-8000-000000000a01', 'Soirée inventée', 'night');

const content = (requests: unknown[], drops: unknown[] = []) =>
  CreatorContentSchema.parse({ requests, drops });

describe('Créatrices › Demandes: what the screen says (MED-09)', () => {
  it('offers what goes to Reveal, and a script: five choices, as chips', () => {
    expect(ASKABLE_CATEGORIES).toEqual(['feed_shoot', 'feed_video', 'reveal_story', 'mass_dm', 'script']);
  });

  it('lists what is under way by its day, then what she refused or the agency cancelled, the latest first', () => {
    const later = requestOf({ dueOn: '2026-11-12' });
    const sooner = requestOf({ dueOn: '2026-11-08' });
    const shooting = dropOf({ state: 'filling' });
    const filling = requestOf({ dueOn: '2026-11-10', dropId: shooting.id });
    const dropped = dropOf({ state: 'ready' });
    const done = requestOf({ dueOn: '2026-11-09', dropId: dropped.id });
    const refused = requestOf({
      state: 'refused',
      refusalReason: 'Pas ce week-end',
      createdAt: '2026-11-01T09:00:00.000Z',
    });
    const cancelled = requestOf({ state: 'cancelled', createdAt: '2026-11-03T09:00:00.000Z' });
    const groups = requestGroups(
      content([later, refused, sooner, filling, cancelled, done], [shooting, dropped]),
      [],
      TODAY,
    );
    expect(groups.current.map((row) => [row.request.id, row.standing, row.cancellable])).toEqual([
      [sooner.id, 'todo', true],
      [done.id, 'dropped', false],
      [filling.id, 'shooting', false],
      [later.id, 'todo', true],
    ]);
    expect(groups.closed.map((row) => [row.request.id, row.standing, row.cancellable])).toEqual([
      [cancelled.id, 'cancelled', false],
      [refused.id, 'refused', false],
    ]);
  });

  it('says a closed request’s day without « en retard », and a script’s structure by its name', () => {
    const night = structureOf('0192f3a0-0000-7000-8000-000000000a01', 'Soirée inventée', 'night');
    const script = requestOf({
      category: 'script',
      structureId: night.id,
      moment: 'night',
      dueOn: '2026-11-02',
    });
    const old = requestOf({ state: 'refused', dueOn: '2026-11-02' });
    const groups = requestGroups(content([script, old]), [night], TODAY);
    expect(groups.current[0]?.due).toEqual({ text: 'En retard depuis lundi', late: true });
    expect(groups.current[0]?.structureName).toBe('Soirée inventée');
    expect(groups.closed[0]?.due).toEqual({ text: 'Pour le 2 nov.', late: false });
    expect(groups.closed[0]?.structureName).toBeNull();
  });

  it('says the cadence and what it last did, amber only when it needs a hand', () => {
    expect(everyText(1)).toBe('Tous les jours');
    expect(everyText(7)).toBe('Tous les 7 jours');
    expect(cadenceNote({ outcome: null, skipped: [] })).toBeNull();
    expect(cadenceNote({ outcome: 'asked', skipped: [] })?.warn).toBe(false);
    expect(cadenceNote({ outcome: 'queue_empty', skipped: [] })?.warn).toBe(true);
    expect(
      cadenceNote({
        outcome: 'blocked',
        skipped: [{ structureId: NIGHT.id, name: 'Soirée inventée', blocks: [] }],
      }),
    ).toEqual({
      text: 'Les structures de sa file touchent ses limites, aucune n’a été demandée : Soirée inventée.',
      warn: true,
    });
  });

  it('refuses a day already past for her, an empty reason, and a script without its structure (MED-10)', () => {
    const draft: AskDraft = { category: 'script', dueOn: '2026-11-05', reason: '  ', structureId: '' };
    expect(askProblems(draft, TODAY)).toEqual({
      dueOn: 'Ce jour est déjà passé pour elle : aujourd’hui ou plus tard.',
      reason: 'Dis-lui en une phrase ce que tu attends.',
      structureId: 'Choisis la structure du script.',
    });
    expect(askProblems({ ...draft, category: '' }, TODAY).category).toBe('Choisis ce que tu lui demandes.');
    expect(
      askProblems({ category: 'feed_shoot', dueOn: TODAY, reason: 'Une séance', structureId: '' }, TODAY),
    ).toEqual({});
    expect(askProblems({ ...draft, dueOn: TODAY, reason: 'x'.repeat(161) }, TODAY).reason).toBe(
      '160 caractères au plus.',
    );
  });

  it('offers the library’s shared structures and those kept for her, never another’s', () => {
    const shared = structureOf('0192f3a0-0000-7000-8000-000000000a01', 'Partagée', 'night');
    const hers = {
      ...structureOf('0192f3a0-0000-7000-8000-000000000a02', 'La sienne', 'day'),
      reservedCreatorId: HER,
    };
    const theirs = {
      ...structureOf('0192f3a0-0000-7000-8000-000000000a03', 'Une autre', 'day'),
      reservedCreatorId: OTHER,
    };
    expect(askableStructures([shared, hers, theirs], HER).map((s) => s.current.name)).toEqual([
      'Partagée',
      'La sienne',
    ]);
  });
});
