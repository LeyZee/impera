import { describe, expect, it } from 'vitest';

import { REAUTHENTICATION_ERROR_CODE } from './auth';
import { EVENT_PAYLOADS } from './events';
import {
  deviceOf,
  limitKeyOf,
  networkOf,
  SECURITY_SETTINGS_ERROR_CODES,
  SecurityAlertPayloadSchema,
} from './security';

describe('limitKeyOf', () => {
  it('counts an IPv4 address as it is, mapped or not', () => {
    expect(limitKeyOf('203.0.113.42')).toBe('203.0.113.42');
    expect(limitKeyOf('::ffff:203.0.113.42')).toBe('203.0.113.42');
  });

  it('counts every address of one IPv6 /64 as the same client', () => {
    expect(limitKeyOf('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(limitKeyOf('2001:0DB8:0001:0002::1')).toBe('2001:db8:1:2::/64');
    expect(limitKeyOf('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
    expect(limitKeyOf('::1')).toBe('0:0:0:0::/64');
  });

  it('counts what is not an address as written', () => {
    expect(limitKeyOf('unknown')).toBe('unknown');
  });
});

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

describe('deviceOf', () => {
  it('names the browser and the system a person recognises', () => {
    expect(
      deviceOf(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome sur Windows');
    expect(
      deviceOf(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari sur iPhone');
    expect(
      deviceOf(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
      ),
    ).toBe('Edge sur Mac');
    expect(deviceOf('Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0')).toBe(
      'Firefox sur Android',
    );
  });

  it('says it does not know rather than showing the string', () => {
    expect(deviceOf(null)).toBe('Appareil inconnu');
    expect(deviceOf('curl/8.4.0')).toBe('Appareil inconnu');
    expect(deviceOf('node')).toBe('Appareil inconnu');
  });
});

describe('SECURITY_SETTINGS_ERROR_CODES', () => {
  it('publishes the refusals of Réglages › Sécurité, the confirmation of a sensitive action among them', () => {
    expect(SECURITY_SETTINGS_ERROR_CODES).toContain('session_current_conflict');
    expect(SECURITY_SETTINGS_ERROR_CODES).toContain(REAUTHENTICATION_ERROR_CODE);
  });
});
