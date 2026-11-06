import { describe, expect, it } from 'vitest';

import { postOfHref, watchPageOf } from './pages';

describe('watchPageOf', () => {
  it.each([
    ['/reels/', { kind: 'reels', code: null }],
    ['/reels/Cx0abc12DEf/', { kind: 'reels', code: 'Cx0abc12DEf' }],
    ['/p/Cx0abc12DEf/', { kind: 'post', code: 'Cx0abc12DEf', path: 'post' }],
    ['/reel/Cx0abc12DEf/', { kind: 'post', code: 'Cx0abc12DEf', path: 'reel' }],
    ['/tv/Cx0abc12DEf', { kind: 'post', code: 'Cx0abc12DEf', path: 'reel' }],
    ['/atelier.lune/reel/Cx0abc12DEf/', { kind: 'post', code: 'Cx0abc12DEf', path: 'reel' }],
    ['/explore/', { kind: 'explore' }],
    ['/atelier.lune/', { kind: 'profile', handle: 'atelier.lune', tab: 'posts' }],
    ['/atelier.lune/reels/', { kind: 'profile', handle: 'atelier.lune', tab: 'reels' }],
  ])('reads %s', (path, expected) => {
    expect(watchPageOf(path)).toEqual(expected);
  });

  it.each([
    ['/', 'the home feed'],
    ['/direct/inbox/', 'messages'],
    ['/direct/t/123456/', 'a conversation'],
    ['/stories/atelier.lune/123/', 'a story'],
    ['/accounts/edit/', 'account settings'],
    ['/explore/tags/danse/', 'a tag'],
    ['/explore/search/', 'a search'],
    ['/reels/audio/1234567890/', 'a sound'],
    ['/atelier.lune/tagged/', 'a profile’s tagged tab'],
    ['/atelier.lune/saved/', 'saved posts'],
    ['/p/abc/', 'a code too short'],
  ])('never reads %s (%s)', (path) => {
    expect(watchPageOf(path)).toBeNull();
  });
});

describe('postOfHref', () => {
  it('reads a post link, relative or absolute', () => {
    expect(postOfHref('/p/Cx0abc12DEf/')).toEqual({ code: 'Cx0abc12DEf', path: 'post' });
    expect(postOfHref('https://www.instagram.com/reel/Cx0abc12DEf/?igsh=x')).toEqual({
      code: 'Cx0abc12DEf',
      path: 'reel',
    });
    expect(postOfHref('/atelier.lune/reel/Cx0abc12DEf/')).toEqual({ code: 'Cx0abc12DEf', path: 'reel' });
  });

  it('refuses another site, a profile and nothing', () => {
    expect(postOfHref('https://exemple.fr/p/Cx0abc12DEf/')).toBeNull();
    expect(postOfHref('/atelier.lune/')).toBeNull();
    expect(postOfHref(null)).toBeNull();
  });
});
