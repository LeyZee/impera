// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addRefusal,
  INSTALL_REFUSALS_KEY,
  MAX_REFUSALS,
  parseRefusals,
  platformOf,
  readRefusals,
  shouldNudge,
} from './install';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';

const phone = { platform: 'ios', standalone: false, refusals: 0, dismissedThisOpening: false } as const;

describe('install guide', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('tells an iPhone, an iPad (which calls itself a Mac) and an Android from a computer', () => {
    expect(platformOf(IPHONE, 5)).toBe('ios');
    expect(platformOf(IPAD, 5)).toBe('ios');
    expect(platformOf(IPAD, 0)).toBe('other');
    expect(platformOf(ANDROID, 5)).toBe('android');
    expect(platformOf(WINDOWS, 0)).toBe('other');
  });

  it('is offered on a phone, never on a computer, in the installed app, after three refusals or once dismissed', () => {
    expect(shouldNudge(phone)).toBe(true);
    expect(shouldNudge({ ...phone, platform: 'android' })).toBe(true);
    expect(shouldNudge({ ...phone, platform: 'other' })).toBe(false);
    expect(shouldNudge({ ...phone, standalone: true })).toBe(false);
    expect(shouldNudge({ ...phone, refusals: MAX_REFUSALS - 1 })).toBe(true);
    expect(shouldNudge({ ...phone, refusals: MAX_REFUSALS })).toBe(false);
    expect(shouldNudge({ ...phone, dismissedThisOpening: true })).toBe(false);
  });

  it('reads anything odd in storage as no refusal', () => {
    expect(parseRefusals(null)).toBe(0);
    expect(parseRefusals('abc')).toBe(0);
    expect(parseRefusals('-2')).toBe(0);
    expect(parseRefusals('2')).toBe(2);
  });

  it('counts each « Plus tard » in this browser', () => {
    expect(readRefusals()).toBe(0);
    addRefusal();
    addRefusal();
    expect(window.localStorage.getItem(INSTALL_REFUSALS_KEY)).toBe('2');
    expect(readRefusals()).toBe(2);
  });

  it('still works when storage is blocked: nothing counted, nothing thrown', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => {
      addRefusal();
    }).not.toThrow();
    expect(readRefusals()).toBe(0);
  });
});
