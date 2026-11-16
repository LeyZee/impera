import { REDIRECT_LINKS_MAX, RedirectLinkIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { writeFault } from '../links';

const id = (n: number) =>
  RedirectLinkIdSchema.parse(`00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
const kept = [
  { id: id(1), name: 'Story du jour' },
  { id: id(2), name: 'Story à la une' },
];

describe('writeFault', () => {
  it('lets a new link in under a new name', () => {
    expect(writeFault(kept, { name: 'Canal' })).toBeNull();
  });

  it('refuses a name already taken, whatever its case and outer spaces', () => {
    expect(writeFault(kept, { name: '  story du JOUR ' })).toBe('name_taken');
  });

  it('lets a link keep its own name when it is corrected', () => {
    expect(writeFault(kept, { id: id(1), name: 'Story du jour' })).toBeNull();
    expect(writeFault(kept, { id: id(1), name: 'Story à la une' })).toBe('name_taken');
  });

  it('refuses to correct a link she does not have', () => {
    expect(writeFault(kept, { id: id(9), name: 'Autre' })).toBe('link_not_found');
  });

  it('refuses one link too many, but still lets a full list be corrected', () => {
    const full = Array.from({ length: REDIRECT_LINKS_MAX }, (_, n) => ({
      id: id(n + 1),
      name: `Lien ${String(n + 1)}`,
    }));
    expect(writeFault(full, { name: 'En trop' })).toBe('too_many_links');
    expect(writeFault(full, { id: id(1), name: 'Renommé' })).toBeNull();
  });
});
