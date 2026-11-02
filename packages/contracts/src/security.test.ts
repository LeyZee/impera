import { describe, expect, it } from 'vitest';

import { EVENT_PAYLOADS } from './events';
import { networkOf, SecurityAlertPayloadSchema } from './security';

describe('networkOf', () => {
  it('keeps the first three bytes of an IPv4', () => {
    expect(networkOf('203.0.113.42')).toBe('203.0.113.x');
    expect(networkOf('::ffff:198.51.100.7')).toBe('198.51.100.x');
    expect(networkOf('010.001.002.003')).toBe('10.1.2.x');
  });

  it('keeps the first three groups of an IPv6', () => {
    expect(networkOf('2001:db8::1')).toBe('2001:db8:0::/48');
    expect(networkOf('2001:0DB8:85a3:0000:0000:8a2e:0370:7334')).toBe('2001:db8:85a3::/48');
    expect(networkOf('::1')).toBe('0:0:0::/48');
  });

  it('never gives back a full address, nor anything that is not one', () => {
    for (const value of [
      null,
      undefined,
      '',
      'unknown',
      '256.1.1.1',
      '1.2.3.300',
      '1.2.3',
      'a::b::c',
      '1:2:3:4:5:6:7:8:9',
      'zz::1',
    ]) {
      expect(networkOf(value)).toBeNull();
    }
  });
});

describe('security_alert', () => {
  it('reads each reason with its own facts', () => {
    const payloads = [
      { reason: 'new_device_sign_in', userId: 'u1', role: 'owner', network: '203.0.113.x' },
      {
        reason: 'sign_in_refusals',
        userId: 'u1',
        role: 'operator',
        network: null,
        refusals: 5,
        windowMinutes: 15,
      },
      { reason: 'second_factor_reset', userId: 'u1', role: 'operator', network: null, via: 'ops' },
      { reason: 'persona_activated', userId: null, version: '1.2.0' },
      { reason: 'automatic_enabled', userId: 'u1', scope: 'creator' },
      {
        reason: 'platform_session_replaced',
        userId: 'u1',
        platformAccountId: '01900000-0000-7000-8000-000000000030',
        platform: 'reveal',
      },
    ];
    for (const payload of payloads) expect(EVENT_PAYLOADS.security_alert.parse(payload)).toEqual(payload);
  });

  it('refuses a reason without its facts', () => {
    expect(
      SecurityAlertPayloadSchema.safeParse({
        reason: 'sign_in_refusals',
        userId: 'u1',
        role: 'owner',
        network: null,
      }).success,
    ).toBe(false);
    expect(SecurityAlertPayloadSchema.safeParse({ reason: 'leak', userId: null }).success).toBe(false);
  });
});
