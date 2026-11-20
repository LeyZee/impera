import { CreatorIdSchema, type Me } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { creatorsSearch, parseCreatorsSearch, sheetsFor } from './search';

const member = (over: Pick<Me, 'role' | 'teamScope'>): Pick<Me, 'role' | 'teamScope'> => over;

describe('the sheets of a creator a member opens', () => {
  it('opens every sheet to the owner, her ideas of the day included', () => {
    expect(sheetsFor(member({ role: 'owner', teamScope: 'owner' }))).toContain('ideas');
  });

  it('opens her ideas of the day to an active manager', () => {
    expect(sheetsFor(member({ role: 'operator', teamScope: 'agency' }))).toEqual([
      'agenda',
      'ideas',
      'requests',
      'scripts',
      'content',
      'links',
    ]);
  });

  it('never shows the watch to a chatter, nor to a manager away or gone (ADR 0060 § 2, amended 07/11)', () => {
    // The server derives `self` for both; the persona alone is left, with no « Idées du jour » nor « Coller un lien ».
    expect(sheetsFor(member({ role: 'operator', teamScope: 'self' }))).toEqual(['persona']);
  });
});

describe('the vault folder in the address (`dossier`)', () => {
  const creatrice = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');

  it('reads a folder on Scripts only, as a short non-empty text', () => {
    expect(parseCreatorsSearch({ onglet: 'scripts', creatrice, dossier: 'f1' })).toEqual({
      onglet: 'scripts',
      creatrice,
      dossier: 'f1',
    });
    expect(parseCreatorsSearch({ onglet: 'agenda', creatrice, dossier: 'f1' })).toEqual({
      onglet: 'agenda',
      creatrice,
    });
    for (const odd of ['', '   ', 'x'.repeat(201), 12]) {
      expect(parseCreatorsSearch({ onglet: 'scripts', dossier: odd })).toEqual({ onglet: 'scripts' });
    }
  });

  it('writes it on Scripts only, and leaves it out when a tab or a creator changes', () => {
    expect(creatorsSearch('scripts', creatrice, 'racine')).toEqual({
      onglet: 'scripts',
      creatrice,
      dossier: 'racine',
    });
    expect(creatorsSearch('scripts', creatrice)).toEqual({ onglet: 'scripts', creatrice });
    expect(creatorsSearch('agenda', creatrice, 'f1')).toEqual({ onglet: 'agenda', creatrice });
  });
});
