import { describe, expect, it } from 'vitest';

import {
  changedOrigin,
  crmOriginOf,
  isGrantedAtInstall,
  permissionPatternOf,
  shortAddress,
} from './crm-address';

describe('crmOriginOf', () => {
  it.each([
    ['localhost:5173', 'http://localhost:5173'],
    ['http://localhost:5173/', 'http://localhost:5173'],
    ['127.0.0.1:5173', 'http://127.0.0.1:5173'],
    ['crm.exemple.fr', 'https://crm.exemple.fr'],
    ['  https://crm.exemple.fr/moi  ', 'https://crm.exemple.fr'],
  ])('reads %s as %s', (input, origin) => {
    expect(crmOriginOf(input)).toBe(origin);
  });

  it.each([
    ['', 'nothing'],
    ['http://crm.exemple.fr', 'plain HTTP off this computer'],
    ['crm impera', 'a host Chrome would percent-encode'],
    ['ftp://crm.exemple.fr', 'not a web address'],
    ['https://moi:secret@crm.exemple.fr', 'credentials in the address'],
    ['intranet', 'a bare name'],
  ])('refuses %j (%s)', (input) => {
    expect(crmOriginOf(input)).toBeNull();
  });
});

describe('the browser permission', () => {
  it('is granted at install for this computer only', () => {
    expect(isGrantedAtInstall('http://localhost:5173')).toBe(true);
    expect(isGrantedAtInstall('https://crm.exemple.fr')).toBe(false);
  });

  it('asks for one site, every path', () => {
    expect(permissionPatternOf('https://crm.exemple.fr')).toBe('https://crm.exemple.fr/*');
  });

  it('shows the address without its scheme', () => {
    expect(shortAddress('https://crm.exemple.fr')).toBe('crm.exemple.fr');
  });
});

// Recette du 16/11, EXT-24: the panel kept asking the old address until it was reloaded.
describe('changedOrigin', () => {
  it('reads the address the popup saved, and nothing else', () => {
    expect(changedOrigin({ crmOrigin: { newValue: 'https://crm.exemple.fr' } }, 'local', 'crmOrigin')).toBe(
      'https://crm.exemple.fr',
    );
    expect(changedOrigin({ crmOrigin: {} }, 'local', 'crmOrigin')).toBe('http://localhost:5173');
    expect(changedOrigin({ watchLink: { newValue: 'x' } }, 'local', 'crmOrigin')).toBeNull();
    expect(
      changedOrigin({ crmOrigin: { newValue: 'https://crm.exemple.fr' } }, 'session', 'crmOrigin'),
    ).toBeNull();
  });

  it('goes back to the built-in CRM of a hosted build when the saved address is removed (ADR 0067)', () => {
    expect(changedOrigin({ crmOrigin: {} }, 'local', 'crmOrigin', 'https://crm.exemple.fr')).toBe(
      'https://crm.exemple.fr',
    );
  });
});
