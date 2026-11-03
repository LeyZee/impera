import { ContentDropFileIdSchema, newId } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { dropRefusals, mayWithdraw, needsRequest } from '../drops';

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
