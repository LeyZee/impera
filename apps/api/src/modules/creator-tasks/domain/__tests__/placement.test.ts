import { describe, expect, it } from 'vitest';

import { placementOf } from '../placement';

const at = (hour: string) => new Date(`2026-11-03T${hour}:00.000Z`);
const span = (from: string, to: string) => ({ startsAt: at(from), endsAt: at(to) });

describe('where a dated suggestion falls (ADR 0042 § 4)', () => {
  const dispos = [span('17:00', '21:00')];

  it('falls inside one of her dispos', () => {
    expect(placementOf(span('18:00', '19:00'), dispos, [])).toEqual(span('18:00', '19:00'));
    expect(placementOf(span('17:00', '21:00'), dispos, [])).toEqual(span('17:00', '21:00'));
  });

  it('stays undated outside a dispo, or half outside', () => {
    expect(placementOf(span('10:00', '11:00'), dispos, [])).toBeNull();
    expect(placementOf(span('20:30', '21:30'), dispos, [])).toBeNull();
    expect(placementOf(span('18:00', '19:00'), [], [])).toBeNull();
  });

  it('never falls over one of her tasks, and a task that ends where it starts leaves room', () => {
    const shoot = [span('18:00', '19:00')];
    expect(placementOf(span('18:30', '19:30'), dispos, shoot)).toBeNull();
    expect(placementOf(span('17:30', '20:00'), dispos, shoot)).toBeNull();
    expect(placementOf(span('19:00', '20:00'), dispos, shoot)).toEqual(span('19:00', '20:00'));
  });

  it('refuses a suggestion with no length', () => {
    expect(placementOf(span('18:00', '18:00'), dispos, [])).toBeNull();
  });
});
