import { CREATOR_ALERT_DEFAULTS, PushMessageSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorAlertLines } from '../creator-alerts';
import { agencyModesFor, alertMessage, modesFor, reachedRoles } from '../route';

describe('who an alert reaches (ADR 0150 § A)', () => {
  it('reads her choice, the code’s default otherwise', () => {
    expect(modesFor('sale', [])).toEqual(CREATOR_ALERT_DEFAULTS.sale);
    const lines = creatorAlertLines([{ alertCode: 'sale', role: 'owner', mode: 'off' }]);
    expect(modesFor('sale', lines).owner).toBe('off');
  });

  it('rings « reçoit », comes silent in « sourdine », and reaches nobody in « rien »', () => {
    expect(reachedRoles({ owner: 'deliver', manager: 'muted', chatter_on_shift: 'off' })).toEqual([
      { role: 'owner', silent: false },
      { role: 'manager', silent: true },
    ]);
  });

  it('never reaches a chatter with a steering alert, whatever line is handed over (ADR 0094 § 3)', () => {
    expect(modesFor('uncovered_account', [])).toEqual({
      owner: 'deliver',
      manager: 'deliver',
      chatter_on_shift: 'off',
    });
    const forced = creatorAlertLines([]).map((line) =>
      line.code === 'uncovered_account'
        ? { ...line, routes: { owner: 'muted', manager: 'off', chatter_on_shift: 'deliver' } as const }
        : line,
    );
    expect(modesFor('uncovered_account', forced)).toEqual({
      owner: 'muted',
      manager: 'off',
      chatter_on_shift: 'off',
    });
    // A row the base would refuse is read « rien » for the chatters all the same.
    const stored = creatorAlertLines([
      { alertCode: 'uncovered_account', role: 'chatter_on_shift', mode: 'deliver' },
    ]).find((line) => line.code === 'uncovered_account');
    expect(stored?.routes.chatter_on_shift).toBe('off');
    expect(stored?.chattersClosed).toBe(true);
    expect(alertMessage('uncovered_account', 'Nora', null, false)).toMatchObject({
      title: 'Nora · Compte sans personne',
      url: '/equipe/planning',
    });
  });

  it('takes, for an alert of the agency, the loudest choice of her creators', () => {
    const quiet = creatorAlertLines([
      { alertCode: 'ai_budget', role: 'owner', mode: 'off' },
      { alertCode: 'ai_budget', role: 'manager', mode: 'off' },
    ]);
    const loud = creatorAlertLines([{ alertCode: 'ai_budget', role: 'manager', mode: 'muted' }]);
    expect(agencyModesFor('ai_budget', [quiet, loud])).toEqual({
      owner: 'deliver',
      manager: 'muted',
      chatter_on_shift: 'off',
    });
    expect(agencyModesFor('ai_budget', [])).toEqual(CREATOR_ALERT_DEFAULTS.ai_budget);
  });

  it('says her name and the alert, opens the conversation, and never carries a fan’s words', () => {
    const message = alertMessage('offer_proposed', 'Nora', '01900000-0000-7000-8000-000000000020', true);
    expect(PushMessageSchema.parse(message)).toEqual({
      title: 'Nora · Offre proposée',
      body: 'Une offre hors des scripts est en cours : à suivre.',
      url: '/suivi?conversation=01900000-0000-7000-8000-000000000020',
      silent: true,
    });
    expect(alertMessage('ai_budget', null, null, false)).toMatchObject({ title: 'Budget IA', url: '/suivi' });
    expect(alertMessage('sale', 'N'.repeat(200), null, false).title.length).toBeLessThanOrEqual(80);
  });
});
