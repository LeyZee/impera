import { describe, expect, it } from 'vitest';

import { instagramPostOf, InstagramPostUrlSchema, PasteTrendLinkBodySchema } from './trends';

// Invented codes and names only (ADR 0010).
describe('an Instagram post read from its address alone (VEI-01)', () => {
  it('reads a post and a reel, and keeps a bare address', () => {
    expect(instagramPostOf('https://www.instagram.com/p/AbC123xyz/?igsh=c2hhcmVy')).toEqual({
      code: 'AbC123xyz',
      path: 'post',
      url: 'https://www.instagram.com/p/AbC123xyz/',
    });
    expect(instagramPostOf('https://instagram.com/reel/Zz_9-8yy#top')?.url).toBe(
      'https://www.instagram.com/reel/Zz_9-8yy/',
    );
    expect(instagramPostOf('https://www.instagram.com/reels/Zz_9-8yy/')?.path).toBe('reel');
    expect(instagramPostOf('https://www.instagram.com/compte.invente/p/AbC123xyz/')?.code).toBe('AbC123xyz');
  });

  it('refuses anything else, by its form', () => {
    for (const address of [
      'http://www.instagram.com/p/AbC123xyz/',
      'https://www.instagram.com/compte.invente/',
      'https://www.instagram.com/stories/compte.invente/123456/',
      'https://www.instagram.com/',
      'https://instagram.com.example.test/p/AbC123xyz/',
      'https://user:pass@www.instagram.com/p/AbC123xyz/',
      'https://www.instagram.com:8443/p/AbC123xyz/',
      'https://instagr.am/p/AbC123xyz/',
      'pas une adresse',
    ])
      expect(instagramPostOf(address), address).toBeNull();
  });

  it('turns a pasted address into the one kept, or refuses it', () => {
    expect(InstagramPostUrlSchema.parse(' https://m.instagram.com/p/AbC123xyz ')).toBe(
      'https://www.instagram.com/p/AbC123xyz/',
    );
    expect(InstagramPostUrlSchema.safeParse('https://example.test/p/AbC123xyz/').success).toBe(false);
    expect(
      PasteTrendLinkBodySchema.safeParse({
        url: 'https://www.instagram.com/reel/Zz_9-8yy/',
        text: '  ',
        format: 'reel',
        creatorId: '01900000-0000-7000-8000-000000000001',
      }).success,
    ).toBe(false);
  });
});
