import { describe, expect, it } from 'vitest';

import {
  ageLine,
  alertsOf,
  ageQuestion,
  ceilingProblem,
  centsOf,
  euros,
  flagError,
  flagsSummary,
  attentionTone,
  isBlocking,
  sheetSummary,
  switchDetail,
  switchTone,
} from './flags-model';

describe('the fan’s limits', () => {
  it('folds to one line, and says when there is none', () => {
    expect(flagsSummary({})).toBe('Aucune en place');
    expect(
      flagsSummary({
        salesFrozen: { reason: 'operator', since: '2026-10-23T10:00:00.000Z' },
        fragile: true,
        spendingLimitMinor: 5000,
      }),
    ).toBe('Ventes gelées · fan fragile · plafond de 50\u00a0€');
    expect(flagsSummary({ spendingLimitMinor: 4990 })).toBe('Plafond de 49,90\u00a0€');
  });

  it('writes cents in full, and a round amount without them', () => {
    expect(euros(4990)).toBe('49,90\u00a0€');
    expect(euros(1250)).toBe('12,50\u00a0€');
    expect(euros(5000)).toBe('50\u00a0€');
  });

  it('stops the agent only when it forbids writing or selling', () => {
    expect(isBlocking({ fragile: true, noExplicit: true, spendingLimitMinor: 0 })).toBe(false);
    expect(isBlocking({ doNotContact: true })).toBe(true);
    expect(isBlocking({ salesFrozen: { reason: 'distress', since: '2026-10-23T10:00:00.000Z' } })).toBe(true);
  });

  it('colours a fan’s states by one rule: red to stop writing or a disputed age, amber for frozen sales (IA-06)', () => {
    const frozen = { salesFrozen: { reason: 'distress' as const, since: '2026-10-23T10:00:00.000Z' } };
    const disputed = { ageDisputed: { since: '2026-10-28T10:00:00.000Z', by: 'policy' as const } };
    expect(attentionTone({})).toBeNull();
    expect(attentionTone(frozen)).toBe('warn');
    expect(attentionTone({ ...frozen, doNotContact: true })).toBe('bad');
    expect(attentionTone({ ...frozen, ...disputed })).toBe('bad');
    expect(switchTone({ doNotContact: true }, 'doNotContact')).toBe('bad');
    expect(switchTone(frozen, 'salesFrozen')).toBe('warn');
    expect(switchTone({}, 'doNotContact')).toBeNull();
    expect(switchTone({ fragile: true }, 'fragile')).toBeNull();
    const levels = (flags: Parameters<typeof alertsOf>[0]) => alertsOf(flags).map((a) => [a.label, a.level]);
    expect(levels(frozen)).toEqual([['Ventes gelées', 'care']]);
    expect(levels(disputed)).toEqual([['Âge contesté', 'stop']]);
    expect(levels({ doNotContact: true })).toEqual([['Ne plus lui écrire', 'stop']]);
  });

  it('says since when and why sales stopped', () => {
    const flags = { salesFrozen: { reason: 'money_trouble' as const, since: '2026-10-23T10:00:00.000Z' } };
    expect(switchDetail(flags, 'salesFrozen')).toBe('Depuis le 23 octobre : il a dit manquer d’argent.');
    expect(switchDetail(flags, 'fragile')).toBeNull();
    // PAIE-19: the first of a month is « 1er ».
    const first = { salesFrozen: { reason: 'money_trouble' as const, since: '2026-11-01T10:00:00.000Z' } };
    expect(switchDetail(first, 'salesFrozen')).toBe('Depuis le 1er novembre : il a dit manquer d’argent.');
  });

  it('says whether his age is confirmed', () => {
    expect(ageLine({})).toBe('Pas encore confirmé : rien d’explicite tant qu’il ne l’est pas.');
    expect(ageLine({ ageConfirmedAt: '2026-10-21T10:00:00.000Z' })).toBe('Majeur, confirmé le 21 octobre.');
    // Disputed (a sign of a minor): who may lift it is said to anyone who may not (SUIVI-04).
    const disputed = { ageDisputed: { since: '2026-10-22T10:00:00.000Z', by: 'policy' } } as const;
    expect(ageLine(disputed)).toBe(
      'Contesté le 22 octobre : l’agent a relevé un signe de minorité. Rien d’explicite. Seuls le propriétaire et les managers peuvent le confirmer.',
    );
    expect(ageLine(disputed, true)).toBe(
      'Contesté le 22 octobre : l’agent a relevé un signe de minorité. Rien d’explicite.',
    );
  });

  it('reads a disputed age as a suspected minor, never as an age nobody checked', () => {
    const byAgent = { ageDisputed: { since: '2026-10-28T10:00:00.000Z', by: 'policy' as const } };
    const byHuman = { ageDisputed: { since: '2026-10-28T10:00:00.000Z', by: 'human' as const } };
    expect(ageLine(byAgent, true)).toBe(
      'Contesté le 28 octobre : l’agent a relevé un signe de minorité. Rien d’explicite.',
    );
    expect(ageLine(byHuman, true)).toBe('Contesté le 28 octobre par un humain. Rien d’explicite.');
    expect(flagsSummary({ ...byAgent, doNotContact: true })).toBe('Âge contesté · ne plus lui écrire');
    expect(attentionTone(byAgent)).toBe('bad');
    expect(attentionTone({ fragile: true })).toBeNull();
    expect(ageQuestion(byAgent)).toContain('Ça lève la contestation');
    expect(ageQuestion({})).not.toContain('contestation');
  });

  it('folds the fan’s sheet to one quiet line, his limits being above it, and never « Rien à signaler » blind (CHAT-03)', () => {
    const flags = {
      ageDisputed: { since: '2026-10-28T10:00:00.000Z', by: 'policy' as const },
      doNotContact: true as const,
      noExplicit: true as const,
    };
    expect(sheetSummary({ flags, toLearn: 7, band: 'neutre' })).toEqual({
      urgent: null,
      rest: '7 à apprendre · désir neutre',
    });
    expect(sheetSummary({ flags, toLearn: 0, band: null }).rest).toBe('Ses limites sont en tête');
    expect(sheetSummary({ flags: {}, toLearn: null, band: null })).toEqual({
      urgent: null,
      rest: 'Rien à signaler',
    });
    // Unread or refused limits are said in amber; while they are read, nothing is claimed.
    expect(sheetSummary({ flags: 'refused', toLearn: null, band: null })).toEqual({
      urgent: 'Limites non lisibles',
      rest: '',
    });
    expect(sheetSummary({ flags: 'down', toLearn: 2, band: null })).toEqual({
      urgent: 'Limites non lues',
      rest: '2 à apprendre',
    });
    expect(sheetSummary({ flags: 'loading', toLearn: null, band: null })).toEqual({
      urgent: null,
      rest: '…',
    });
    // What his card waits for is said in amber folded, and never under « Rien à signaler » (ADR 0085 § 6).
    expect(sheetSummary({ flags: {}, toLearn: null, band: null, toCheck: 1 })).toEqual({
      urgent: '1 à vérifier',
      rest: '',
    });
    expect(sheetSummary({ flags: 'refused', toLearn: 2, band: null, toCheck: 3 })).toEqual({
      urgent: 'Limites non lisibles · 3 à vérifier',
      rest: '2 à apprendre',
    });
    expect(sheetSummary({ flags: {}, toLearn: null, band: null, toCheck: 0 }).rest).toBe('Rien à signaler');
  });

  it('puts what forbids first, in red, then what changes how one writes, in amber (CHAT-23)', () => {
    const alerts = alertsOf({
      fragile: true,
      doNotContact: true,
      spendingLimitMinor: 5000,
      salesFrozen: { since: '2026-11-01T10:00:00.000Z', reason: 'distress' },
    });
    expect(alerts.map((a) => [a.level, a.label])).toEqual([
      ['stop', 'Ne plus lui écrire'],
      ['care', 'Ventes gelées'],
      ['care', 'Fan fragile'],
      ['care', 'Plafond de 50\u00a0€'],
    ]);
    expect(alerts[0]?.text).toContain('ni l’agent ni toi');
    expect(alerts[1]?.text).toContain('Depuis le 1er novembre : il allait mal.');
    // A disputed age already says « rien d’explicite »: not twice.
    expect(
      alertsOf({ ageDisputed: { since: '2026-10-28T10:00:00.000Z', by: 'human' }, noExplicit: true }).map(
        (a) => a.label,
      ),
    ).toEqual(['Âge contesté']);
    expect(alertsOf({})).toEqual([]);
  });

  it('reads a ceiling typed in euros as cents, and refuses what is not an amount', () => {
    expect(centsOf('50')).toBe(5000);
    expect(centsOf('49,90 €')).toBe(4990);
    expect(centsOf(' 12.5 ')).toBe(1250);
    expect(centsOf('')).toBeNull();
    expect(centsOf('-5')).toBeNull();
    expect(centsOf('12,345')).toBeNull();
    expect(centsOf('cinquante')).toBeNull();
  });

  it('says under the field why a ceiling cannot be saved: not an amount, 0 €, past 100 000 €', () => {
    expect(ceilingProblem('')).toBeNull();
    expect(ceilingProblem('49,90')).toBeNull();
    expect(ceilingProblem('100 000')).toBeNull();
    expect(ceilingProblem('-5')).toBe('Un montant en euros, par exemple 50 ou 49,90.');
    expect(ceilingProblem('0')).toContain('gèle les ventes');
    expect(ceilingProblem('99999999999')).toBe('Au plus 100\u202f000\u00a0€.');
  });

  it('says why a change was refused', () => {
    expect(flagError(404, null)).toBe('Ce fan n’existe plus.');
    expect(flagError(403, null)).toBe('Tu ne peux pas changer les limites de ce fan : rien n’a changé.');
    expect(flagError(0, null)).toBe('Le serveur ne répond pas : rien n’a changé. Réessaie dans un instant.');
    const refusal = (code: string) => ({ error: { code, message: 'x', details: {}, requestId: 'r' } });
    expect(flagError(403, refusal('age_dispute_forbidden'))).toBe(
      'Seuls le propriétaire et les managers confirment un âge contesté : rien n’a changé.',
    );
    expect(flagError(400, refusal('age_dispute_reason_invalid'))).toBe(
      'Écris pourquoi tu confirmes son âge : rien n’a changé.',
    );
  });
});
