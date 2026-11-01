import { describe, expect, it } from 'vitest';

import {
  acceptanceDeadline,
  acceptanceStep,
  acceptanceWrite,
  nextAcceptance,
  standingOf,
  type AcceptanceState,
  type AcceptanceStep,
  type RecordedStep,
} from '../invoice-acceptance';

const issuedAt = new Date('2026-11-01T08:00:00.000Z');
const deadline = acceptanceDeadline(issuedAt, 15);
const before = { now: new Date('2026-11-16T07:59:59.999Z'), deadline };
const after = { now: deadline, deadline };

/** `run` is refused: the invoice, in `state`, no longer allows the step. */
function refusedIn(state: AcceptanceState, run: () => unknown): void {
  expect(run).toThrow(expect.objectContaining({ code: 'invoice_acceptance_conflict', details: { state } }));
}

describe('the acceptance of an invoice by its contractor (EQ-06)', () => {
  it('leaves whole days to contest from the issue', () => {
    expect(deadline).toEqual(new Date('2026-11-16T08:00:00.000Z'));
    for (const days of [0, -1, 1.5]) expect(() => acceptanceDeadline(issuedAt, days)).toThrow(RangeError);
  });

  it('is accepted or contested with a reason before the deadline, and accepted tacitly from it', () => {
    expect(nextAcceptance('pending', { kind: 'accept' }, before)).toBe('accepted');
    expect(nextAcceptance('pending', { kind: 'contest', reason: 'Une vente manque' }, before)).toBe(
      'contested',
    );
    expect(nextAcceptance('pending', { kind: 'lapse' }, after)).toBe('tacitly_accepted');
    refusedIn('pending', () => nextAcceptance('pending', { kind: 'accept' }, after));
    refusedIn('pending', () => nextAcceptance('pending', { kind: 'contest', reason: 'Trop tard' }, after));
    refusedIn('pending', () => nextAcceptance('pending', { kind: 'lapse' }, before));
  });

  it('ends a contest upheld or refused, with its reason, whenever the owner decides (ADR 0039 § 3)', () => {
    expect(nextAcceptance('contested', { kind: 'uphold', reason: 'La vente manquait' }, after)).toBe(
      'contest_upheld',
    );
    expect(nextAcceptance('contested', { kind: 'uphold', reason: 'La vente manquait' }, before)).toBe(
      'contest_upheld',
    );
    expect(
      nextAcceptance(
        'contested',
        { kind: 'refuse', reason: 'La vente est sur la quinzaine suivante' },
        after,
      ),
    ).toBe('contest_refused');
    refusedIn('pending', () => nextAcceptance('pending', { kind: 'uphold', reason: 'Oui' }, before));
    refusedIn('pending', () => nextAcceptance('pending', { kind: 'refuse', reason: 'Non' }, before));
  });

  it('never moves an answered invoice again', () => {
    const steps: AcceptanceStep[] = [
      { kind: 'accept' },
      { kind: 'contest', reason: 'Une vente manque' },
      { kind: 'lapse' },
      { kind: 'uphold', reason: 'Oui' },
      { kind: 'refuse', reason: 'Non' },
    ];
    const answered: AcceptanceState[] = ['accepted', 'tacitly_accepted', 'contest_upheld', 'contest_refused'];
    for (const state of answered) {
      for (const step of steps) {
        refusedIn(state, () => nextAcceptance(state, step, before));
        refusedIn(state, () => nextAcceptance(state, step, after));
      }
    }
    refusedIn('contested', () => nextAcceptance('contested', { kind: 'accept' }, before));
  });

  it('refuses a contest or an end of it without a reason', () => {
    expect(() => nextAcceptance('pending', { kind: 'contest', reason: ' ' }, before)).toThrow(RangeError);
    expect(() => nextAcceptance('contested', { kind: 'refuse', reason: '' }, after)).toThrow(RangeError);
    expect(() => nextAcceptance('contested', { kind: 'uphold', reason: ' ' }, after)).toThrow(RangeError);
  });
});

describe('a document answered through the API (EQ-06 lot 6, ADR 0039)', () => {
  const issued: RecordedStep = { kind: 'issued', reason: null };
  const contested: RecordedStep = { kind: 'contested', reason: 'Une vente du 3 manque' };

  it('stands where its last answer or contest end puts it, with its contest’s reason', () => {
    expect(standingOf([])).toEqual({ state: 'pending', reason: null });
    expect(standingOf([issued])).toEqual({ state: 'pending', reason: null });
    expect(standingOf([issued, { kind: 'accepted', reason: null }])).toEqual({
      state: 'accepted',
      reason: null,
    });
    expect(standingOf([issued, { kind: 'lapsed', reason: null }])).toEqual({
      state: 'tacitly_accepted',
      reason: null,
    });
    expect(standingOf([issued, contested])).toEqual({ state: 'contested', reason: 'Une vente du 3 manque' });
    // The refusal's reason is the owner's: the document keeps the contractor's words.
    expect(standingOf([issued, contested, { kind: 'contest_refused', reason: 'Vente du 18' }])).toEqual({
      state: 'contest_refused',
      reason: 'Une vente du 3 manque',
    });
    expect(standingOf([issued, contested, { kind: 'contest_upheld', reason: 'Elle manquait' }])).toEqual({
      state: 'contest_upheld',
      reason: 'Une vente du 3 manque',
    });
    // A payment leaves the acceptance where it stands.
    expect(
      standingOf([issued, { kind: 'accepted', reason: null }, { kind: 'paid', reason: null }]).state,
    ).toBe('accepted');
  });

  it('writes the event of an allowed step, its reason trimmed', () => {
    expect(acceptanceWrite([issued], { kind: 'accept' }, true)).toEqual({
      kind: 'write',
      event: 'accepted',
      reason: null,
    });
    expect(acceptanceWrite([issued], { kind: 'contest', reason: '  Une vente du 3 manque ' }, true)).toEqual({
      kind: 'write',
      event: 'contested',
      reason: 'Une vente du 3 manque',
    });
    expect(acceptanceWrite([issued], { kind: 'lapse' }, false)).toEqual({
      kind: 'write',
      event: 'lapsed',
      reason: null,
    });
    expect(acceptanceWrite([issued, contested], { kind: 'refuse', reason: 'Vente du 18' }, false)).toEqual({
      kind: 'write',
      event: 'contest_refused',
      reason: 'Vente du 18',
    });
    expect(acceptanceWrite([issued, contested], { kind: 'uphold', reason: ' Elle manquait ' }, true)).toEqual(
      {
        kind: 'write',
        event: 'contest_upheld',
        reason: 'Elle manquait',
      },
    );
  });

  it('gives back what was recorded when the same step is sent again, even after the deadline', () => {
    const accepted: RecordedStep[] = [issued, { kind: 'accepted', reason: null }];
    expect(acceptanceWrite(accepted, { kind: 'accept' }, true)).toEqual({ kind: 'replay' });
    expect(acceptanceWrite(accepted, { kind: 'accept' }, false)).toEqual({ kind: 'replay' });
    expect(
      acceptanceWrite([issued, contested], { kind: 'contest', reason: 'Une vente du 3 manque ' }, false),
    ).toEqual({ kind: 'replay' });
    const refused: RecordedStep[] = [issued, contested, { kind: 'contest_refused', reason: 'Vente du 18' }];
    expect(acceptanceWrite(refused, { kind: 'refuse', reason: 'Vente du 18' }, false)).toEqual({
      kind: 'replay',
    });
    const upheld: RecordedStep[] = [issued, contested, { kind: 'contest_upheld', reason: 'Elle manquait' }];
    expect(acceptanceWrite(upheld, { kind: 'uphold', reason: 'Elle manquait' }, false)).toEqual({
      kind: 'replay',
    });
  });

  it('refuses another answer than the one recorded, and a step the delay no longer allows', () => {
    const accepted: RecordedStep[] = [issued, { kind: 'accepted', reason: null }];
    refusedIn('accepted', () =>
      acceptanceWrite(accepted, { kind: 'contest', reason: 'Finalement non' }, true),
    );
    refusedIn('contested', () => acceptanceWrite([issued, contested], { kind: 'accept' }, true));
    refusedIn('contested', () =>
      acceptanceWrite([issued, contested], { kind: 'contest', reason: 'Un autre motif' }, true),
    );
    const refused: RecordedStep[] = [issued, contested, { kind: 'contest_refused', reason: 'Vente du 18' }];
    refusedIn('contest_refused', () =>
      acceptanceWrite(refused, { kind: 'refuse', reason: 'Autre motif' }, false),
    );
    // One end of a contest: an upheld one is never refused after, nor a refused one upheld.
    refusedIn('contest_refused', () => acceptanceWrite(refused, { kind: 'uphold', reason: 'Oui' }, false));
    const upheld: RecordedStep[] = [issued, contested, { kind: 'contest_upheld', reason: 'Elle manquait' }];
    refusedIn('contest_upheld', () => acceptanceWrite(upheld, { kind: 'refuse', reason: 'Non' }, false));
    refusedIn('contest_upheld', () => acceptanceWrite(upheld, { kind: 'uphold', reason: 'Autre' }, false));
    refusedIn('pending', () =>
      acceptanceWrite([issued], { kind: 'uphold', reason: 'Rien à corriger' }, true),
    );
    refusedIn('pending', () => acceptanceWrite([issued], { kind: 'accept' }, false));
    refusedIn('pending', () => acceptanceWrite([issued], { kind: 'lapse' }, true));
    refusedIn('pending', () => acceptanceWrite([issued], { kind: 'refuse', reason: 'Rien à refuser' }, true));
    refusedIn('tacitly_accepted', () =>
      acceptanceWrite([issued, { kind: 'lapsed', reason: null }], { kind: 'accept' }, false),
    );
  });

  it('takes the delay as the database tells it', () => {
    expect(acceptanceStep('pending', { kind: 'accept' }, true)).toBe('accepted');
    refusedIn('pending', () => acceptanceStep('pending', { kind: 'accept' }, false));
    expect(acceptanceStep('pending', { kind: 'lapse' }, false)).toBe('tacitly_accepted');
    expect(() => acceptanceWrite([issued], { kind: 'contest', reason: '   ' }, true)).toThrow(RangeError);
  });
});
