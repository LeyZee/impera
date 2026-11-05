import { describe, expect, it } from 'vitest';

import { AVATAR_MAX_BYTES } from '../../../domain/avatar';
import { createAvatarFetch, isPrivateAddress } from '../fetch-avatar';

const PUBLIC = [{ address: '203.0.113.7', family: 4 }];
const publicLookup = () => Promise.resolve(PUBLIC);

function serving(response: () => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchLike = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(response());
  };
  return { calls, fetchAvatar: createAvatarFetch(fetchLike, publicLookup) };
}

describe('the fetch of a creator photo (CRM-07 a2b)', () => {
  it('reads the image at a public HTTPS address, no redirect followed', async () => {
    const { calls, fetchAvatar } = serving(() => new Response(new Uint8Array([1, 2, 3])));
    expect(await fetchAvatar('https://cdn.example.test/a.jpg')).toEqual({
      ok: true,
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(calls[0]?.init.redirect).toBe('manual');
  });

  it('refuses anything but HTTPS, credentials in the address, and private or local addresses', async () => {
    const { calls, fetchAvatar } = serving(() => new Response('x'));
    const refused = { ok: false, reason: 'refused_address' };
    expect(await fetchAvatar('http://cdn.example.test/a.jpg')).toEqual(refused);
    expect(await fetchAvatar('https://user:pass@cdn.example.test/a.jpg')).toEqual(refused);
    expect(await fetchAvatar('https://127.0.0.1/a.jpg')).toEqual(refused);
    expect(await fetchAvatar('https://[::1]/a.jpg')).toEqual(refused);
    expect(await fetchAvatar('not an address')).toEqual(refused);
    const internal = createAvatarFetch(
      () => Promise.reject(new Error('never called')),
      () => Promise.resolve([...PUBLIC, { address: '10.1.2.3', family: 4 }]),
    );
    expect(await internal('https://intranet.example.test/a.jpg')).toEqual(refused);
    expect(calls).toEqual([]);
  });

  it('takes a redirect for a refusal and a missing image for no photo', async () => {
    const moved = serving(
      () => new Response(null, { status: 302, headers: { location: 'https://10.0.0.1/' } }),
    );
    expect(await moved.fetchAvatar('https://cdn.example.test/a.jpg')).toEqual({
      ok: false,
      reason: 'refused_address',
    });
    const gone = serving(() => new Response(null, { status: 404 }));
    expect(await gone.fetchAvatar('https://cdn.example.test/a.jpg')).toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('throws when the image server fails, so the job tries again', async () => {
    const down = serving(() => new Response(null, { status: 503 }));
    await expect(down.fetchAvatar('https://cdn.example.test/a.jpg')).rejects.toThrow(/503/u);
  });

  it('stops at the size cap, announced or not', async () => {
    const announced = serving(
      () => new Response('x', { headers: { 'content-length': String(AVATAR_MAX_BYTES + 1) } }),
    );
    expect(await announced.fetchAvatar('https://cdn.example.test/a.jpg')).toEqual({
      ok: false,
      reason: 'too_large',
    });
    const streamed = serving(() => new Response(new Uint8Array(AVATAR_MAX_BYTES + 1)));
    expect(await streamed.fetchAvatar('https://cdn.example.test/a.jpg')).toEqual({
      ok: false,
      reason: 'too_large',
    });
  });

  it('knows the private ranges, mapped IPv6 included', () => {
    for (const address of [
      '10.0.0.1',
      '172.16.5.4',
      '192.168.1.1',
      '169.254.169.254',
      '::ffff:127.0.0.1',
      'fd00::1',
    ])
      expect(isPrivateAddress(address)).toBe(true);
    for (const address of ['203.0.113.7', '2001:db8::1']) expect(isPrivateAddress(address)).toBe(false);
  });
});
