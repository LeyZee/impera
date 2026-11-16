import { describe, expect, it } from 'vitest';

import { correctedDrafts, writtenBy, type StoredWriter } from '../written-by';

const DRAFT = '01890000-0000-7000-8000-0000000000d1';
const OTHER_DRAFT = '01890000-0000-7000-8000-0000000000d2';
const editors = new Map([[DRAFT, 'Kofi']]);

const outbound = (author: StoredWriter['author'], draftId: string | null): StoredWriter => ({
  direction: 'outbound',
  author,
  draftId,
});

describe('who wrote one of her messages (CRE-04, ADR 0065 § 1)', () => {
  it('gives a fan’s message no writer', () => {
    expect(writtenBy({ direction: 'inbound', author: 'fan', draftId: null }, editors)).toBeNull();
  });

  it('signs the AI’s: a draft sent as proposed, or a send of ours the connector recognised', () => {
    expect(writtenBy(outbound('ai', DRAFT), editors)).toEqual({ kind: 'ai' });
    expect(writtenBy(outbound('ai', null), editors)).toEqual({ kind: 'ai' });
  });

  it('names the member who corrected the draft, by his display name only', () => {
    expect(writtenBy(outbound('human', DRAFT), editors)).toEqual({ kind: 'chatter', displayName: 'Kofi' });
  });

  it('gives the agency a draft corrected by someone with no display name (the owner)', () => {
    expect(writtenBy(outbound('human', OTHER_DRAFT), editors)).toEqual({ kind: 'agency' });
    expect(writtenBy(outbound('human', DRAFT), new Map([[DRAFT, '']]))).toEqual({ kind: 'agency' });
  });

  it('says a message written on the platform, outside Impera, came from there', () => {
    expect(writtenBy(outbound('human', null), editors)).toEqual({ kind: 'platform' });
  });

  it('asks the corrector of her corrected drafts only, each once', () => {
    expect(
      correctedDrafts([
        { direction: 'inbound', author: 'fan', draftId: null },
        outbound('ai', OTHER_DRAFT),
        outbound('human', null),
        outbound('human', DRAFT),
        outbound('human', DRAFT),
      ]),
    ).toEqual([DRAFT]);
  });
});
