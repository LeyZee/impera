import { REDIRECT_LINKS_MAX, RedirectLinkIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { writeFault } from '../links';

const id = (n: number) =>
  RedirectLinkIdSchema.parse(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const fresh = 'https://liens.example.test/z';
const kept = [
  { id: id(1), name: 'Story du jour', url: 'https://liens.example.test/a' },
  { id: id(2), name: 'Story à la une', url: 'https://liens.example.test/b' },
];

describe('writeFault', () => {
  it('lets a new link in under a new name', () => {
    expect(writeFault(kept, { name: 'Canal', url: fresh })).toBeNull();
  });

  it('refuses a name already taken, whatever its case and outer spaces', () => {
    expect(writeFault(kept, { name: '  story du JOUR ', url: fresh })).toBe('name_taken');
  });

  it('lets a link keep its own name when it is corrected', () => {
    expect(writeFault(kept, { id: id(1), name: 'Story du jour', url: fresh })).toBeNull();
    expect(writeFault(kept, { id: id(1), name: 'Story à la une', url: fresh })).toBe('name_taken');
  });

  it('refuses an address another link already has, however it is typed', () => {
    expect(writeFault(kept, { name: 'Canal', url: 'https://LIENS.example.test/a/' })).toBe('url_taken');
    expect(
      writeFault(kept, { id: id(1), name: 'Story du jour', url: 'https://liens.example.test/a' }),
    ).toBeNull();
  });

  it('refuses to correct a link she does not have', () => {
    expect(writeFault(kept, { id: id(9), name: 'Autre', url: fresh })).toBe('link_not_found');
  });

  it('refuses one link too many, but still lets a full list be corrected', () => {
    const full = Array.from({ length: REDIRECT_LINKS_MAX }, (_, n) => ({
      id: id(n + 1),
      name: `Lien ${String(n + 1)}`,
      url: `https://liens.example.test/${String(n + 1)}`,
    }));
    expect(writeFault(full, { name: 'En trop', url: fresh })).toBe('too_many_links');
    expect(writeFault(full, { id: id(1), name: 'Renommé', url: fresh })).toBeNull();
  });
});
