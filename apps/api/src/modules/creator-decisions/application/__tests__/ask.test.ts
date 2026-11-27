import { CreatorIdSchema, newId, type NewCreatorDecision, type NotificationRequest } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { AskedDecision } from '../../domain/ports';
import { askAndTell, type AskDeps } from '../ask';

const NOW = new Date('2026-11-26T10:00:00.000Z');
const CREATOR = newId(CreatorIdSchema);
const decision: NewCreatorDecision = {
  kind: 'publish_time',
  subject: 'reel:01936f00-0000-7000-8000-000000000001',
  category: 'post',
  question: 'Je publie ton Reel à 18 h 30 ?',
  context: 'Un Reel inventé.',
  layout: 'buttons',
  answers: [
    { key: 'yes', label: 'Oui', text: null, noted: 'C’est noté.' },
    { key: 'no', label: 'Non', text: null, noted: 'C’est noté.' },
  ],
  otherIdeasLeft: 0,
  expiresAt: '2026-11-27T10:00:00.000Z',
};

function setup(state: AskedDecision['state'], push: boolean): { deps: AskDeps; told: NotificationRequest[] } {
  const told: NotificationRequest[] = [];
  return {
    told,
    deps: {
      asking: {
        ask: () => Promise.resolve(true),
        read: () => Promise.resolve({ state, answerKey: null }),
        phones: () => Promise.resolve({ accounts: ['her-phone', 'her-tablet'], timeZone: 'Europe/Paris' }),
      },
      notify: push
        ? (request) => {
            told.push(request);
            return Promise.resolve('rang');
          }
        : null,
    },
  };
}

describe('a question asked is told to her (ADR 0164 § 9)', () => {
  it('tells each of her accounts the question itself, under one key per question, on her Aujourd’hui', async () => {
    const { deps, told } = setup('open', true);

    await expect(askAndTell(deps, CREATOR, decision, NOW)).resolves.toBe(true);

    expect(told).toEqual(
      ['her-phone', 'her-tablet'].map((userId) => ({
        userId,
        reason: 'decision',
        objectKey: `decision:publish_time:${decision.subject}`,
        timeZone: 'Europe/Paris',
        message: {
          title: 'Une question pour toi',
          body: 'Je publie ton Reel à 18 h 30 ?',
          url: '/aujourdhui',
          tag: 'decision',
        },
      })),
    );
  });

  it.each(['answered', 'withdrawn', 'ended'] as const)('tells nothing of a question %s', async (state) => {
    const { deps, told } = setup(state, true);

    await askAndTell(deps, CREATOR, decision, NOW);
    expect(told).toEqual([]);
  });

  it('asks all the same when push is off', async () => {
    const { deps } = setup('open', false);

    await expect(askAndTell(deps, CREATOR, decision, NOW)).resolves.toBe(true);
  });
});
