import { describe, expect, it } from 'vitest';

import { ContentDropFileIdSchema, newId, replacementRefusal } from './index';

describe('the file she sends in place of a medium asked again (trou 7 du 21/11)', () => {
  const file = (mime: 'image/jpeg' | 'video/mp4' | 'audio/mpeg') => ({
    id: newId(ContentDropFileIdSchema),
    mime,
    bytes: 1000,
  });

  it('fits the drop’s category, as any file she drops', () => {
    expect(replacementRefusal('feed_shoot', { kind: 'image', slotKey: null }, file('video/mp4'))).toBeNull();
    expect(replacementRefusal('feed_shoot', { kind: 'image', slotKey: null }, file('audio/mpeg'))).toBe(
      '« Feed · Séance boudoir » prend seulement des photos et des vidéos',
    );
  });

  it('in a script, is of its step’s kind', () => {
    const step = { kind: 'video', slotKey: 'salon::0' } as const;
    expect(replacementRefusal('script', step, file('video/mp4'))).toBeNull();
    expect(replacementRefusal('script', step, file('image/jpeg'))).toBe('Cette étape attend une vidéo');
    expect(replacementRefusal('script', { kind: 'image', slotKey: 'salon::1' }, file('video/mp4'))).toBe(
      'Cette étape attend une photo',
    );
    expect(replacementRefusal('script', { kind: 'audio', slotKey: 'salon::2' }, file('image/jpeg'))).toBe(
      'Cette étape attend un vocal',
    );
  });
});
