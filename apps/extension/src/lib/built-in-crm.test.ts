import { describe, expect, it } from 'vitest';

import { assertSameCrm, builtInCrmOf } from './built-in-crm';

describe('builtInCrmOf (ADR 0067, second amendement)', () => {
  it('has no address without the variable: the welcome stays', () => {
    expect(builtInCrmOf(undefined)).toBeNull();
    expect(builtInCrmOf('')).toBeNull();
    expect(builtInCrmOf('  ')).toBeNull();
  });

  it('takes a deployed CRM’s https origin, a final slash allowed', () => {
    expect(builtInCrmOf('https://crm.exemple.fr')).toBe('https://crm.exemple.fr');
    expect(builtInCrmOf('https://crm.exemple.fr/')).toBe('https://crm.exemple.fr');
  });

  it.each([
    ['plain HTTP', 'http://crm.exemple.fr'],
    ['no scheme', 'crm.exemple.fr'],
    ['localhost', 'https://localhost'],
    ['an IP address', 'https://203.0.113.7'],
    ['127.0.0.1', 'https://127.0.0.1'],
    ['another port', 'https://crm.exemple.fr:8443'],
    ['the default port written out', 'https://crm.exemple.fr:443'],
    ['a path', 'https://crm.exemple.fr/app'],
    ['a query', 'https://crm.exemple.fr/?x=1'],
    ['credentials', 'https://user:pass@crm.exemple.fr'],
    ['a wildcard', 'https://*.exemple.fr'],
    ['a final dot', 'https://crm.exemple.fr.'],
    ['a non-ASCII name', 'https://crm.exémple.fr'],
    ['punycode', 'https://xn--crm-exmple-b4a.fr'],
    ['capitals', 'https://CRM.exemple.fr'],
    ['a single label', 'https://crm'],
  ])('fails the build on %s', (_, raw) => {
    expect(() => builtInCrmOf(raw)).toThrow(/EXTENSION_CRM_ORIGIN refusée/u);
  });
});

describe('assertSameCrm (avis Sécurité et Bilan du 20/11)', () => {
  it('lets the build through when the two addresses name the same site, a final slash aside', () => {
    expect(() => {
      assertSameCrm('https://crm.exemple.fr', 'https://crm.exemple.fr');
    }).not.toThrow();
    expect(() => {
      assertSameCrm('https://crm.exemple.fr', 'https://crm.exemple.fr/');
    }).not.toThrow();
    expect(() => {
      assertSameCrm('https://crm.exemple.fr', 'https://CRM.exemple.fr:443');
    }).not.toThrow();
  });

  it('has nothing to compare when either address is missing', () => {
    expect(() => {
      assertSameCrm(null, 'http://127.0.0.1:8080');
    }).not.toThrow();
    expect(() => {
      assertSameCrm('https://crm.exemple.fr', undefined);
    }).not.toThrow();
    expect(() => {
      assertSameCrm('https://crm.exemple.fr', ' ');
    }).not.toThrow();
  });

  it.each([
    ['another site', 'https://autre.exemple.fr'],
    ['plain HTTP', 'http://crm.exemple.fr'],
    ['another port', 'https://crm.exemple.fr:8443'],
    ['no address', 'crm.exemple.fr'],
  ])('fails the build when WEB_ORIGIN is %s', (_, webOrigin) => {
    expect(() => {
      assertSameCrm('https://crm.exemple.fr', webOrigin);
    }).toThrow(/WEB_ORIGIN/u);
  });
});
