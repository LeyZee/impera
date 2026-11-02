// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAppPath, listenForNotificationOpens } from './notificationOpen';

/** The page side of a touched notification (public/sw.js): it moves itself, and only within the app. */

function fakeContainer(): EventTarget {
  const container = new EventTarget();
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
  return container;
}

function message(
  data: unknown,
  origin = window.location.origin,
): { event: MessageEvent; reply: MessagePort } {
  const channel = new MessageChannel();
  const event = new MessageEvent('message', { data, origin, ports: [channel.port2] });
  return { event, reply: channel.port2 };
}

describe('a touched notification while the app is open', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('moves the app to the page and answers the worker, so it does not reload', () => {
    const container = fakeContainer();
    const go = vi.fn();
    const stop = listenForNotificationOpens(go);
    const { event, reply } = message({ type: 'open', path: '/commissions' });
    const answer = vi.spyOn(reply, 'postMessage');
    container.dispatchEvent(event);
    expect(go).toHaveBeenCalledExactlyOnceWith('/commissions');
    expect(answer).toHaveBeenCalledWith('opened');
    stop();
    container.dispatchEvent(message({ type: 'open', path: '/planning' }).event);
    expect(go).toHaveBeenCalledOnce();
  });

  it('ignores anything else: another site, another origin, another kind of message', () => {
    const container = fakeContainer();
    const go = vi.fn();
    listenForNotificationOpens(go);
    for (const data of [
      { type: 'open', path: 'https://evil.example/' },
      { type: 'open', path: '//evil.example/x' },
      { type: 'open', path: '/\\evil.example' },
      { type: 'apply-update' },
      'open',
    ]) {
      container.dispatchEvent(message(data).event);
    }
    container.dispatchEvent(message({ type: 'open', path: '/suivi' }, 'https://evil.example').event);
    expect(go).not.toHaveBeenCalled();
  });

  it('knows a path of the app', () => {
    expect(isAppPath('/suivi?fan=1')).toBe(true);
    expect(isAppPath('javascript:alert(1)')).toBe(false);
  });
});
