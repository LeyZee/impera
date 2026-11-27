import { NotificationRequestSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  creatorNoticeKey,
  creatorNoticeKind,
  creatorNoticeMessage,
  type CreatorNoticeSubject,
} from '../creator-notices';

const REQUEST: CreatorNoticeSubject = {
  kind: 'content_request',
  requestId: 'r-1',
  script: false,
  dueOn: '2026-12-03',
};
const SCRIPT: CreatorNoticeSubject = { ...REQUEST, requestId: 'r-2', script: true };
const PROPOSITION: CreatorNoticeSubject = { kind: 'proposition', suggestionId: 's-1' };
const WEEK: CreatorNoticeSubject = { kind: 'week', week: '2026-11-30' };

describe('what the agency asked of her, on her phone (trou 9 du 21/11)', () => {
  it('rings a request, a script and a proposition as an agency request, her week as the week to validate', () => {
    expect([REQUEST, SCRIPT, PROPOSITION, WEEK].map(creatorNoticeKind)).toEqual([
      'agency_request',
      'agency_request',
      'agency_request',
      'week_to_validate',
    ]);
  });

  it('keys each thing asked once, whatever run sees it', () => {
    expect([REQUEST, SCRIPT, PROPOSITION, WEEK].map(creatorNoticeKey)).toEqual([
      'content_request:r-1',
      'content_request:r-2',
      'proposition:s-1',
      'week:2026-11-30',
    ]);
  });

  it('says what to do and by when, on the screen where she does it', () => {
    expect(creatorNoticeMessage(REQUEST)).toEqual({
      title: 'Nouvelle demande de l’agence',
      body: 'À déposer pour jeudi 3 décembre.',
      url: '/contenu',
    });
    expect(creatorNoticeMessage(SCRIPT)).toEqual({
      title: 'Un script t’est demandé',
      body: 'À tourner et déposer pour jeudi 3 décembre.',
      url: '/contenu',
    });
    expect(creatorNoticeMessage(PROPOSITION).url).toBe('/agenda');
    expect(creatorNoticeMessage(WEEK)).toEqual({
      title: 'Ta semaine est prête',
      body: 'La semaine du lundi 30 novembre t’attend : ouvre-la pour l’accepter.',
      url: '/agenda?vue=semaine',
    });
  });

  it('builds requests the notifications module accepts', () => {
    for (const subject of [REQUEST, SCRIPT, PROPOSITION, WEEK])
      expect(() =>
        NotificationRequestSchema.parse({
          userId: 'u-1',
          reason: 'decision',
          objectKey: creatorNoticeKey(subject),
          timeZone: 'Europe/Paris',
          message: creatorNoticeMessage(subject),
          kind: creatorNoticeKind(subject),
        }),
      ).not.toThrow();
  });
});
