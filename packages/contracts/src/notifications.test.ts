import { describe, expect, it } from 'vitest';

import { isPushServiceUrl, PushMessageSchema, PushSubscriptionInputSchema } from './notifications';

const P256DH = 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4';
const SHARED = 'BTBZMqHH6r4Tts7J_aSIgg';

describe('push subscriptions', () => {
  it('point only at a known push service, over https, with no port nor user', () => {
    expect(isPushServiceUrl('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isPushServiceUrl('https://web.push.apple.com/QGuQ')).toBe(true);
    expect(isPushServiceUrl('https://api.push.apple.com/x')).toBe(true);
    expect(isPushServiceUrl('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isPushServiceUrl('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
    for (const evil of [
      'http://fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
      'https://user@fcm.googleapis.com/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evilpush.apple.com.example/x',
      'https://169.254.169.254/latest',
      'https://localhost/x',
      'not a url',
    ]) {
      expect(isPushServiceUrl(evil), evil).toBe(false);
    }
  });

  it('read the browser’s subscription and check the size of its keys', () => {
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      expirationTime: null,
      keys: { p256dh: P256DH, auth: SHARED },
    };
    expect(PushSubscriptionInputSchema.safeParse(subscription).success).toBe(true);
    expect(
      PushSubscriptionInputSchema.safeParse({ ...subscription, keys: { p256dh: SHARED, auth: SHARED } })
        .success,
    ).toBe(false);
  });
});

describe('push messages', () => {
  it('open a page of the app, never another site', () => {
    const message = { title: 'Nouvelle vente', url: '/commissions' };
    expect(PushMessageSchema.safeParse(message).success).toBe(true);
    for (const url of ['https://evil.example', '//evil.example', '/\\evil.example', 'commissions']) {
      expect(PushMessageSchema.safeParse({ ...message, url }).success, url).toBe(false);
    }
  });
});
