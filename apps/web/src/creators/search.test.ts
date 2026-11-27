// @vitest-environment jsdom
import { CreatorIdSchema, PreparedScriptIdSchema, type Me } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  creatorsSearch,
  legacyCreatorsSearch,
  parseCreatorsSearch,
  rememberCreatorTab,
  rememberedSheet,
  scriptSearch,
  sheetOf,
  sheetsFor,
  tabOf,
} from './search';

const member = (over: Pick<Me, 'role' | 'teamScope'>): Pick<Me, 'role' | 'teamScope'> => over;

describe('the sheets of a creator a member opens', () => {
  it('opens every sheet to the owner, her ideas of the day included', () => {
    expect(sheetsFor(member({ role: 'owner', teamScope: 'owner' }))).toContain('ideas');
  });

  it('opens her ideas of the day to an active manager', () => {
    // Médias first: where her sheet opens for a manager (ADR 0149 § 1). Her links are Trafic's.
    expect(sheetsFor(member({ role: 'operator', teamScope: 'agency' }))).toEqual([
      'vault',
      'content',
      'stock',
      'scripts',
      'copy',
      'custom',
      'agenda',
      'ideas',
      'requests',
      // Her persona to read, last: Médias stays first (trou béant 18).
      'persona',
    ]);
  });

  it('never shows the watch to a chatter, nor to a manager away or gone (ADR 0060 § 2, amended 07/11)', () => {
    // The server derives `self` for both; the persona alone is left, with no « Idées du jour » nor « Coller un lien ».
    expect(sheetsFor(member({ role: 'operator', teamScope: 'self' }))).toEqual(['persona']);
  });
});

const creatrice = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');

describe('the seven tabs of her sheet in the address (ADR 0149 § 5)', () => {
  it('writes a tab, and a view only when it is not the tab’s first', () => {
    expect(creatorsSearch('persona', creatrice)).toEqual({ creatrice });
    expect(creatorsSearch('hours', creatrice)).toEqual({ onglet: 'ia', creatrice });
    expect(creatorsSearch('vault', creatrice)).toEqual({ onglet: 'medias', creatrice });
    expect(creatorsSearch('stock', creatrice)).toEqual({ onglet: 'medias', vue: 'impera', creatrice });
    expect(creatorsSearch('content', creatrice)).toEqual({ onglet: 'medias', vue: 'depots', creatrice });
    expect(creatorsSearch('scripts', creatrice)).toEqual({ onglet: 'scripts', creatrice });
    expect(creatorsSearch('copy', creatrice)).toEqual({ onglet: 'scripts', vue: 'a-copier', creatrice });
    expect(creatorsSearch('structures', null)).toEqual({ onglet: 'scripts', vue: 'structures' });
    expect(creatorsSearch('custom', creatrice)).toEqual({ onglet: 'scripts', vue: 'sur-mesure', creatrice });
    expect(creatorsSearch('requests', creatrice)).toEqual({ onglet: 'agenda', vue: 'demandes', creatrice });
    expect(creatorsSearch('alerts', creatrice)).toEqual({ onglet: 'alertes', creatrice });
  });

  it('puts the four subjects of Compte on one page', () => {
    for (const sheet of ['telegram', 'access', 'rate', 'profile'] as const) {
      expect(creatorsSearch(sheet, creatrice)).toEqual({ onglet: 'compte', creatrice });
      expect(tabOf(sheet)).toBe('account');
    }
  });

  it('reads back the sheet it wrote', () => {
    for (const sheet of [
      'persona',
      'hours',
      'vault',
      'content',
      'stock',
      'scripts',
      'copy',
      'structures',
      'custom',
      'agenda',
      'ideas',
      'requests',
      'alerts',
      'profile',
    ] as const) {
      expect(sheetOf(parseCreatorsSearch({ ...creatorsSearch(sheet, creatrice) }))).toBe(sheet);
    }
  });

  it('reads a view of another tab, or an unknown one, as the tab’s first view', () => {
    expect(parseCreatorsSearch({ onglet: 'medias', vue: 'idees' })).toEqual({ onglet: 'medias' });
    expect(parseCreatorsSearch({ onglet: 'agenda', vue: 'nimporte' })).toEqual({ onglet: 'agenda' });
    expect(parseCreatorsSearch({ onglet: 'nimporte', vue: 'depots' })).toEqual({});
  });
});

describe('the addresses of the tabs before the seven (ADR 0149 § 5)', () => {
  it('leads each one to its tab, its view or its card of Compte, the creator kept', () => {
    expect(legacyCreatorsSearch({ onglet: 'heures', creatrice })).toEqual({
      search: { onglet: 'ia', creatrice },
    });
    expect(legacyCreatorsSearch({ onglet: 'idees', creatrice })).toEqual({
      search: { onglet: 'agenda', vue: 'idees', creatrice },
    });
    expect(legacyCreatorsSearch({ onglet: 'demandes' })).toEqual({
      search: { onglet: 'agenda', vue: 'demandes' },
    });
    expect(legacyCreatorsSearch({ onglet: 'contenu', creatrice })).toEqual({
      search: { onglet: 'medias', vue: 'depots', creatrice },
    });
    expect(legacyCreatorsSearch({ onglet: 'pourcentage', creatrice })).toEqual({
      search: { onglet: 'compte', creatrice },
      hash: 'part',
    });
    expect(legacyCreatorsSearch({ onglet: 'telegram', creatrice })?.hash).toBe('telegram');
    expect(legacyCreatorsSearch({ onglet: 'acces', creatrice })?.hash).toBe('acces');
    expect(legacyCreatorsSearch({ onglet: 'profil', creatrice })?.hash).toBe('profil');
  });

  it('leads her made-to-measure prices to their view of Scripts', () => {
    expect(legacyCreatorsSearch({ onglet: 'sur-mesure', creatrice })).toEqual({
      search: { onglet: 'scripts', vue: 'sur-mesure', creatrice },
    });
  });

  it('leads Scripts with a folder to that folder of her vault in Médias', () => {
    expect(legacyCreatorsSearch({ onglet: 'scripts', creatrice, dossier: 'f1' })).toEqual({
      search: { onglet: 'medias', creatrice, dossier: 'f1' },
    });
  });

  it('leaves an address of today alone', () => {
    for (const onglet of [
      undefined,
      'ia',
      'medias',
      'scripts',
      'agenda',
      'alertes',
      'compte',
      'toString',
      12,
    ]) {
      expect(legacyCreatorsSearch({ onglet, creatrice })).toBeNull();
    }
  });
});

describe('the tab of her sheet left open last (ADR 0149 § 2)', () => {
  const owner = sheetsFor(member({ role: 'owner', teamScope: 'owner' }));
  const manager = sheetsFor(member({ role: 'operator', teamScope: 'agency' }));

  it('opens the tab on its first view for this member, and nothing when it is not theirs', () => {
    localStorage.clear();
    expect(rememberedSheet(owner)).toBeUndefined();
    rememberCreatorTab('requests');
    expect(rememberedSheet(owner)).toBe('agenda');
    expect(rememberedSheet(manager)).toBe('agenda');
    rememberCreatorTab('rate');
    expect(rememberedSheet(owner)).toBe('access');
    expect(rememberedSheet(manager)).toBeUndefined();
  });
});

describe('the vault folder in the address (`dossier`)', () => {
  it('reads a folder on her vault only, as a short non-empty text', () => {
    expect(parseCreatorsSearch({ onglet: 'medias', creatrice, dossier: 'f1' })).toEqual({
      onglet: 'medias',
      creatrice,
      dossier: 'f1',
    });
    expect(parseCreatorsSearch({ onglet: 'medias', vue: 'depots', creatrice, dossier: 'f1' })).toEqual({
      onglet: 'medias',
      vue: 'depots',
      creatrice,
    });
    expect(parseCreatorsSearch({ onglet: 'agenda', creatrice, dossier: 'f1' })).toEqual({
      onglet: 'agenda',
      creatrice,
    });
    for (const odd of ['', '   ', 'x'.repeat(201), 12]) {
      expect(parseCreatorsSearch({ onglet: 'medias', dossier: odd })).toEqual({ onglet: 'medias' });
    }
  });

  it('writes it on her vault only, and leaves it out when a tab or a creator changes', () => {
    expect(creatorsSearch('vault', creatrice, 'racine')).toEqual({
      onglet: 'medias',
      creatrice,
      dossier: 'racine',
    });
    expect(creatorsSearch('vault', creatrice)).toEqual({ onglet: 'medias', creatrice });
    expect(creatorsSearch('stock', creatrice)).toEqual({ onglet: 'medias', vue: 'impera', creatrice });
    expect(creatorsSearch('agenda', creatrice, 'f1')).toEqual({ onglet: 'agenda', creatrice });
  });
});

describe('the script open in Scripts in the address (`script`, PRO1-06)', () => {
  const script = PreparedScriptIdSchema.parse('0192f3a0-0000-7000-8000-0000000000e1');

  it('reads a script id on Scripts only, and writes it back', () => {
    expect(parseCreatorsSearch({ onglet: 'scripts', creatrice, script })).toEqual({
      onglet: 'scripts',
      creatrice,
      script,
    });
    expect(parseCreatorsSearch({ onglet: 'scripts', vue: 'a-copier', creatrice, script })).toEqual({
      onglet: 'scripts',
      vue: 'a-copier',
      creatrice,
    });
    expect(parseCreatorsSearch({ onglet: 'scripts', script: 'pas-un-id' })).toEqual({ onglet: 'scripts' });
    expect(scriptSearch(creatrice, script)).toEqual({ onglet: 'scripts', creatrice, script });
    expect(scriptSearch(creatrice, null)).toEqual({ onglet: 'scripts', creatrice });
    expect(sheetOf(scriptSearch(creatrice, script))).toBe('scripts');
  });
});
