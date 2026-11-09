// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MediaBlurToggle } from './MediaBlurToggle';
import { MEDIA_BLUR_KEY, parseMediaBlur, setMediaBlur, startMediaBlur } from './media-blur';

beforeEach(() => {
  window.localStorage.clear();
  // jsdom has no matchMedia: a reduced motion, so the eye does not play.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  startMediaBlur();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('« Flou des médias » (SC-04 lot c4, ADR 0030 § 4)', () => {
  it('blurs until it is turned off: nothing stored, an old value, all blurred', () => {
    expect(parseMediaBlur(null)).toBe(true);
    expect(parseMediaBlur('on')).toBe(true);
    expect(parseMediaBlur('peut-être')).toBe(true);
    expect(parseMediaBlur('off')).toBe(false);
    expect(document.documentElement.dataset['mediaBlur']).toBe('on');
  });

  it('turns with an eye: crossed out while blurred, open once off, remembered by this browser', () => {
    render(<MediaBlurToggle variant="rail" />);
    const toggle = screen.getByRole('switch', { name: 'Flou des médias' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.querySelector('.nav-icon--eye-off')).not.toBeNull();
    expect(screen.getByText('Floutés')).toBeDefined();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(toggle.querySelector('.nav-icon--eye')).not.toBeNull();
    expect(screen.getByText('Nets')).toBeDefined();
    expect(document.documentElement.dataset['mediaBlur']).toBe('off');
    expect(window.localStorage.getItem(MEDIA_BLUR_KEY)).toBe('off');
  });

  it('keeps every control that shows it in step', () => {
    render(
      <>
        <MediaBlurToggle variant="rail" />
        <MediaBlurToggle variant="sheet" />
      </>,
    );
    act(() => {
      setMediaBlur(false);
    });
    expect(
      screen
        .getAllByRole('switch', { name: 'Flou des médias' })
        .map((one) => one.getAttribute('aria-checked')),
    ).toEqual(['false', 'false']);
  });
});
