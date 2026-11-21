// @vitest-environment jsdom
import { MeSchema, type Me } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { deviceZone, followsDevice, useFollowDeviceZone } from './device-zone';

/** Invented accounts only (ADR 0010). */
const account = (patch: Partial<Me>): Me =>
  MeSchema.parse({
    id: 'compte-invente',
    email: 'compte@example.test',
    name: 'Compte inventé',
    role: 'operator',
    creatorIds: [],
    team: { role: 'chatter', status: 'active' },
    teamScope: 'self',
    ...patch,
  });

function serve(answer: () => Response): { calls: { url: string; body: unknown }[] } {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    return Promise.resolve(answer());
  });
  return { calls };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function wrapperOf(client: QueryClient): (props: { children: ReactNode }) => JSX.Element {
  return function Wrapper({ children }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('the zone of the phone (recette CHT-01)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads a place of the IANA regions, and nothing for UTC, Etc/ or a device that says nothing', () => {
    expect(deviceZone(() => 'Africa/Porto-Novo')).toBe('Africa/Porto-Novo');
    expect(deviceZone(() => 'America/Argentina/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
    expect(deviceZone(() => 'UTC')).toBeNull();
    expect(deviceZone(() => 'Etc/GMT-1')).toBeNull();
    expect(
      deviceZone(() => {
        throw new Error('no Intl');
      }),
    ).toBeNull();
  });

  it('is followed by a member’s record only: never the owner’s, a creator’s nor an operator outside the team', () => {
    expect(followsDevice(account({}))).toBe(true);
    expect(followsDevice(account({ team: { role: 'manager', status: 'on_leave' } }))).toBe(true);
    expect(followsDevice(account({ role: 'owner', team: null, teamScope: 'owner' }))).toBe(false);
    expect(followsDevice(account({ role: 'creator', team: null }))).toBe(false);
    expect(followsDevice(account({ team: null }))).toBe(false);
  });

  it('sends the phone’s zone once per opening, and reads the team again when the record took it', async () => {
    const { calls } = serve(() => json({ timeZone: 'Africa/Porto-Novo' }));
    const client = new QueryClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    const read = () => 'Africa/Porto-Novo';
    const view = renderHook(
      ({ user }) => {
        useFollowDeviceZone(user, read);
      },
      { wrapper: wrapperOf(client), initialProps: { user: account({}) } },
    );
    await waitFor(() => {
      expect(invalidated).toHaveBeenCalledWith({ queryKey: ['team', 'members'] });
    });
    view.rerender({ user: account({ name: 'Compte renommé' }) });
    expect(calls).toEqual([{ url: '/v1/team/me/time-zone', body: { timeZone: 'Africa/Porto-Novo' } }]);
  });

  it('reads nothing again when the record kept its zone, and keeps quiet when the server says no', async () => {
    const kept = serve(() => json({ timeZone: 'Europe/Paris' }));
    const client = new QueryClient();
    const invalidated = vi.spyOn(client, 'invalidateQueries');
    renderHook(
      () => {
        useFollowDeviceZone(account({}), () => 'Asia/Tokyo');
      },
      { wrapper: wrapperOf(client) },
    );
    await waitFor(() => {
      expect(kept.calls).toHaveLength(1);
    });
    expect(invalidated).not.toHaveBeenCalled();

    const refused = serve(() => json({ error: { code: 'member_not_found', message: 'x' } }, 404));
    renderHook(
      () => {
        useFollowDeviceZone(account({}), () => 'Asia/Tokyo');
      },
      { wrapper: wrapperOf(client) },
    );
    await waitFor(() => {
      expect(refused.calls).toHaveLength(1);
    });
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('sends nothing for the owner, a creator, or a phone that gives no place', () => {
    const { calls } = serve(() => json({ timeZone: 'Europe/Paris' }));
    const wrapper = wrapperOf(new QueryClient());
    renderHook(
      () => {
        useFollowDeviceZone(account({ role: 'owner', team: null, teamScope: 'owner' }), () => 'Europe/Paris');
      },
      { wrapper },
    );
    renderHook(
      () => {
        useFollowDeviceZone(account({ role: 'creator', team: null }), () => 'Europe/Paris');
      },
      { wrapper },
    );
    renderHook(
      () => {
        useFollowDeviceZone(account({}), () => 'UTC');
      },
      { wrapper },
    );
    expect(calls).toEqual([]);
  });
});
