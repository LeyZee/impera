import { describe, expect, it } from 'vitest';

import { firstPlacement, placementOf } from '../placement';

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

describe('the first room of a validated idea (VEI-01 d)', () => {
  const dispos = [span('17:00', '21:00'), span('22:00', '23:00')];

  it('takes the start of her first dispo with room', () => {
    expect(firstPlacement(60, dispos, [], at('09:00'))).toEqual(span('17:00', '18:00'));
  });

  it('starts where a task ends, touching it, and never over one', () => {
    const busy = [span('17:00', '18:30'), span('19:00', '20:00')];
    expect(firstPlacement(30, dispos, busy, at('09:00'))).toEqual(span('18:30', '19:00'));
    expect(firstPlacement(60, dispos, busy, at('09:00'))).toEqual(span('20:00', '21:00'));
  });

  it('goes to a later dispo when the first has no room, and none when no dispo has', () => {
    expect(firstPlacement(60, dispos, [span('17:00', '20:30')], at('09:00'))).toEqual(span('22:00', '23:00'));
    expect(firstPlacement(300, dispos, [], at('09:00'))).toBeNull();
    expect(firstPlacement(60, [], [], at('09:00'))).toBeNull();
  });

  it('never starts before now, rounded up to the quarter hour', () => {
    expect(firstPlacement(60, dispos, [], new Date('2026-11-03T17:07:30.000Z'))).toEqual(
      span('17:15', '18:15'),
    );
    expect(firstPlacement(60, dispos, [], at('20:30'))).toEqual(span('22:00', '23:00'));
  });

  it('refuses a length of nothing', () => {
    expect(firstPlacement(0, dispos, [], at('09:00'))).toBeNull();
  });
});
