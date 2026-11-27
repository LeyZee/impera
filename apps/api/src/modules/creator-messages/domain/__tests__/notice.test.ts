import type { NotificationRequest, ToAgencyMessage } from '@impera/contracts';
import { CreatorIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { tellAgency, tellHer } from '../../application/tell';
import { answerNotice, toAgencyNotice } from '../notice';
import type { MessagePhones } from '../ports';

const AT = new Date('2026-11-27T10:00:00Z');
const CREATOR = CreatorIdSchema.parse('01900000-0000-7000-8000-000000000001');
const MESSAGE: ToAgencyMessage = {
  id: '01900000-0000-7000-8000-0000000000a1',
  creatorId: CREATOR,
  kind: 'worry',
  body: 'Un souci inventé pour le test.',
  createdAt: '2026-11-27T09:00:00.000Z',
  answer: null,
  answeredAt: null,
};

const phones: MessagePhones = {
  agency: () =>
    Promise.resolve({
      creatorName: 'Nora',
      phones: [
        { userId: 'owner-1', timeZone: 'Europe/Paris' },
        { userId: 'manager-1', timeZone: 'Africa/Porto-Novo' },
      ],
    }),
  hers: () => Promise.resolve([{ userId: 'nora-phone', timeZone: 'Europe/Paris' }]),
};

function told(): { asked: NotificationRequest[]; deps: Parameters<typeof tellAgency>[0] } {
  const asked: NotificationRequest[] = [];
  return {
    asked,
    deps: {
      phones,
      notify: (request) => {
        asked.push(request);
        return Promise.resolve('rang');
      },
    },
  };
}

describe('« Écrire à l’agence » rings the other side (recette 27/11, G4 and G13)', () => {
  it('says who wrote and what kind, never her words', () => {
    expect(toAgencyNotice('Nora', 'worry')).toEqual({
      title: 'Nora · Un souci',
      body: 'Elle a écrit à l’agence : sa demande attend une réponse.',
      url: '/',
    });
    expect(JSON.stringify(toAgencyNotice('Nora', 'worry'))).not.toContain(MESSAGE.body);
    expect(answerNotice().url).toBe('/aujourdhui');
  });

  it('tells her owners and her managers once each, keyed on the message', async () => {
    const { asked, deps } = told();
    expect(await tellAgency(deps, MESSAGE, AT)).toBe(2);
    expect(
      asked.map(({ userId, reason, objectKey, timeZone }) => [userId, reason, objectKey, timeZone]),
    ).toEqual([
      ['owner-1', 'team', `creator-message:${MESSAGE.id}`, 'Europe/Paris'],
      ['manager-1', 'team', `creator-message:${MESSAGE.id}`, 'Africa/Porto-Novo'],
    ]);
  });

  it('tells her of an answer, and nothing while there is none', async () => {
    const { asked, deps } = told();
    expect(await tellHer(deps, MESSAGE, AT)).toBe(0);
    expect(asked).toEqual([]);
    const answered = { ...MESSAGE, answer: 'Réponse inventée.', answeredAt: '2026-11-27T09:30:00.000Z' };
    expect(await tellHer(deps, answered, AT)).toBe(1);
    expect(asked[0]).toMatchObject({
      userId: 'nora-phone',
      objectKey: `creator-message-answer:${MESSAGE.id}`,
      message: { title: 'L’agence t’a répondu' },
    });
    expect(JSON.stringify(asked)).not.toContain('Réponse inventée.');
  });
});
