import { describe, expect, it } from 'vitest';

import { linkOfferOf } from './crm-link-page';

describe('linkOfferOf', () => {
  it('offers a deployed CRM on its link page, by its full host', () => {
    expect(linkOfferOf('https://crm.exemple.fr/extension/lier')).toEqual({
      origin: 'https://crm.exemple.fr',
      host: 'crm.exemple.fr',
    });
  });

  it('reads nothing after the path', () => {
    expect(linkOfferOf('https://crm.exemple.fr/extension/lier?adresse=ailleurs.fr#x')).toEqual({
      origin: 'https://crm.exemple.fr',
      host: 'crm.exemple.fr',
    });
  });

  it('offers this computer without a site name, in plain HTTP and on any port', () => {
    expect(linkOfferOf('http://localhost:5173/extension/lier')).toEqual({
      origin: 'http://localhost:5173',
      host: null,
    });
    expect(linkOfferOf('http://127.0.0.1:5173/extension/lier')).toEqual({
      origin: 'http://127.0.0.1:5173',
      host: null,
    });
  });

  it.each([
    ['plain HTTP off this computer', 'http://crm.exemple.fr/extension/lier'],
    ['another port', 'https://crm.exemple.fr:8443/extension/lier'],
    ['credentials in the address', 'https://moi:secret@crm.exemple.fr/extension/lier'],
    ['a final slash', 'https://crm.exemple.fr/extension/lier/'],
    ['another case', 'https://crm.exemple.fr/Extension/lier'],
    ['a longer path', 'https://crm.exemple.fr/extension/lier-x'],
    ['a path inside', 'https://crm.exemple.fr/x/extension/lier'],
    ['another page', 'https://crm.exemple.fr/aide/extension'],
    ['a name that is not ASCII', 'https://crm.exämple.fr/extension/lier'],
    ['a name written in punycode', 'https://xn--crm-exmple-r5a.fr/extension/lier'],
    ['an IP address', 'https://192.168.1.20/extension/lier'],
    ['an IPv6 address', 'https://[::1]/extension/lier'],
    ['a final dot', 'https://crm.exemple.fr./extension/lier'],
    ['a single label', 'https://intranet/extension/lier'],
    ['another scheme', 'ftp://crm.exemple.fr/extension/lier'],
    ['no address', undefined],
    ['not an address', 'pas une adresse'],
  ])('offers nothing for %s', (_, url) => {
    expect(linkOfferOf(url)).toBeNull();
  });
});
