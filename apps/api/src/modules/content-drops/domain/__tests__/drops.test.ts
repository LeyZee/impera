import { ContentDropFileIdSchema, newId } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  NOTHING_KEPT,
  dropRefusals,
  mayWithdraw,
  needsRequest,
  requestAnswer,
  type RequestDrop,
} from '../drops';

describe('a drop before anything is stored (CR-06)', () => {
  it('names each file that does not fit, and the drop when it holds too many', () => {
    const photo = newId(ContentDropFileIdSchema);
    const vocal = newId(ContentDropFileIdSchema);
    expect(
      dropRefusals({
        category: 'instagram_reel',
        files: [
          { id: photo, mime: 'image/jpeg', bytes: 1000 },
          { id: vocal, mime: 'audio/mpeg', bytes: 1000 },
        ],
      }),
    ).toEqual([
      { fileId: null, sentence: '« Reel Insta » prend un seul fichier' },
      { fileId: photo, sentence: '« Reel Insta » prend seulement des vidéos' },
      { fileId: vocal, sentence: '« Reel Insta » prend seulement des vidéos' },
    ]);
    expect(
      dropRefusals({ category: 'mass_dm', files: [{ id: vocal, mime: 'audio/mpeg', bytes: 1000 }] }),
    ).toEqual([]);
  });

  it('wants a request for a script only', () => {
    expect(needsRequest('script')).toBe(true);
    expect(needsRequest('feed_shoot')).toBe(false);
  });

  it('lets her withdraw until something is scheduled, the agency until it is out', () => {
    expect(mayWithdraw('ready', 'creator')).toBe(true);
    expect(mayWithdraw('scheduled', 'creator')).toBe(false);
    expect(mayWithdraw('scheduled', 'agency')).toBe(true);
    expect(mayWithdraw('published', 'agency')).toBe(false);
  });
});

describe('what answers a request, and what she is asked to redo (trou 7 du 21/11)', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 21, 10, minute));
  const drop = (fields: Partial<RequestDrop>): RequestDrop => ({
    id: 'drop',
    state: 'ready',
    blockedReason: null,
    redoSentence: null,
    withdrawnAt: null,
    updatedAt: at(0),
    ...fields,
  });

  it('is answered by its live drop, never asked again', () => {
    expect(requestAnswer([drop({ id: 'live' })])).toEqual({ dropId: 'live', redo: null });
  });

  it('opens again when nothing of her drop was kept, with why', () => {
    expect(requestAnswer([drop({ state: 'blocked', updatedAt: at(5) })])).toEqual({
      dropId: null,
      redo: { sentence: NOTHING_KEPT, at: at(5) },
    });
    expect(
      requestAnswer([drop({ state: 'blocked', blockedReason: 'La vidéo est illisible', updatedAt: at(5) })])
        .redo?.sentence,
    ).toBe('La vidéo est illisible');
  });

  it('carries the team’s sentence of its latest withdrawal, none after her own', () => {
    const redone = drop({ id: 'a', state: 'withdrawn', redoSentence: 'Trop sombre', withdrawnAt: at(10) });
    expect(requestAnswer([redone])).toEqual({ dropId: null, redo: { sentence: 'Trop sombre', at: at(10) } });
    const hers = drop({ id: 'b', state: 'withdrawn', withdrawnAt: at(20) });
    expect(requestAnswer([redone, hers])).toEqual({ dropId: null, redo: null });
    expect(requestAnswer([])).toEqual({ dropId: null, redo: null });
  });

  it('forgets the sentence once she drops again', () => {
    const redone = drop({ id: 'a', state: 'withdrawn', redoSentence: 'Trop sombre', withdrawnAt: at(10) });
    expect(requestAnswer([redone, drop({ id: 'again', state: 'uploading' })])).toEqual({
      dropId: 'again',
      redo: null,
    });
  });
});
