// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SaveBar, useOnScreen } from './SaveBar';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const bar = (over: Partial<Parameters<typeof SaveBar>[0]> = {}): JSX.Element => (
  <SaveBar
    show
    warn={false}
    text="2 modifications"
    saveLabel="Enregistrer"
    saving={false}
    blocked={null}
    onReset={vi.fn()}
    onSave={vi.fn()}
    {...over}
  />
);

describe('SaveBar (CREA-20)', () => {
  it('says what waits, and saves or undoes it', () => {
    const onSave = vi.fn();
    const onReset = vi.fn();
    render(bar({ onSave, onReset }));
    const region = screen.getByRole('region', { name: 'Modifications en attente' });
    expect(region.textContent).toContain('2 modifications');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tout annuler' }));
    expect(onSave).toHaveBeenCalledOnce();
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('stays away when hidden, and keeps the save shut when blocked', () => {
    const { rerender } = render(bar({ show: false }));
    expect(screen.queryByRole('region')).toBeNull();
    rerender(
      bar({ warn: true, text: '1 champ à corriger', blocked: 'Corrige d’abord les champs signalés.' }),
    );
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveProperty('disabled', true);
  });
});

function Probe(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useOnScreen(ref);
  return <div ref={ref}>{seen ? 'vue' : 'hors champ'}</div>;
}

describe('useOnScreen', () => {
  it('counts as seen without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Probe />);
    expect(screen.getByText('vue')).toBeDefined();
  });

  it('follows the observer once the head scrolls away', () => {
    let report: (entries: { isIntersecting: boolean }[]) => void = () => undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
          report = callback;
        }
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    render(<Probe />);
    act(() => {
      report([{ isIntersecting: false }]);
    });
    expect(screen.getByText('hors champ')).toBeDefined();
  });
});
