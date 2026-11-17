// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A stand-in for the browser's audio: counts the contexts made and what was asked of them. */
class FakeContext {
  static made = 0;
  state: 'running' | 'suspended' | 'closed';
  currentTime = 0;
  destination = {};
  resume = vi.fn(() => {
    this.state = 'running';
    return Promise.resolve();
  });
  close = vi.fn(() => Promise.resolve());
  oscillators = 0;
  static last: FakeContext | null = null;
  constructor() {
    FakeContext.made += 1;
    FakeContext.last = this;
    this.state = FakeContext.startSuspended ? 'suspended' : 'running';
  }
  static startSuspended = false;
  createGain() {
    const ramp = () => undefined;
    const node = {
      gain: {
        value: 0,
        setValueAtTime: ramp,
        linearRampToValueAtTime: ramp,
        exponentialRampToValueAtTime: ramp,
      },
      connect: () => node,
      disconnect: vi.fn(),
    };
    return node;
  }
  createOscillator() {
    this.oscillators += 1;
    const node = {
      frequency: { value: 0 },
      connect: (next: unknown) => next,
      start: () => undefined,
      stop: () => undefined,
    };
    return node;
  }
}

async function freshChime(): Promise<typeof import('./chime')> {
  vi.resetModules();
  return import('./chime');
}

beforeEach(() => {
  FakeContext.made = 0;
  FakeContext.startSuspended = false;
  vi.stubGlobal('AudioContext', FakeContext);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the reveal’s chime (recette 16/11, CHT-10 and CRE-18)', () => {
  it('asks for no audio before her first gesture: silent, and no warning in the console', async () => {
    const { playChime } = await freshChime();
    playChime()();
    expect(FakeContext.made).toBe(0);
  });

  it('rings after a gesture, on one context for every chime', async () => {
    const { playChime } = await freshChime();
    document.dispatchEvent(new Event('pointerdown'));
    playChime();
    playChime();
    expect(FakeContext.made).toBe(1);
  });

  it('resumes a suspended context before ringing, and rings nothing once stopped', async () => {
    FakeContext.startSuspended = true;
    const { playChime } = await freshChime();
    document.dispatchEvent(new Event('keydown'));
    const stop = playChime();
    stop();
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeContext.last?.resume).toHaveBeenCalledTimes(1);
    expect(FakeContext.last?.oscillators).toBe(0);
  });

  it('rings once resumed when nothing stopped it', async () => {
    FakeContext.startSuspended = true;
    const { playChime } = await freshChime();
    document.dispatchEvent(new Event('touchend'));
    playChime();
    await Promise.resolve();
    await Promise.resolve();
    expect(FakeContext.last?.oscillators).toBeGreaterThan(0);
  });
});
