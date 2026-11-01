// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ModeControl } from './ModeControl';
import { useFloatingTip } from './parts';

import type { AgentMode, AutomaticGate } from '@/agent/mode';

const CLOSED: AutomaticGate = {
  open: false,
  missing: [{ kind: 'live_rate', value: 64, target: 80 }, { kind: 'blind_test' }],
};
const OPEN: AutomaticGate = { open: true, missing: [] };

function Harness(props: {
  mode: AgentMode;
  automatic: AutomaticGate;
  readOnly?: string | null;
  running?: boolean;
  onChange: (mode: AgentMode) => void;
}): JSX.Element {
  const tip = useFloatingTip();
  return (
    <>
      <ModeControl {...props} creatorName="Léa" tip={tip} />
      {tip.element}
    </>
  );
}

function setup(mode: AgentMode, automatic: AutomaticGate, readOnly: string | null = null) {
  const onChange = vi.fn<(mode: AgentMode) => void>();
  render(<Harness mode={mode} automatic={automatic} readOnly={readOnly} onChange={onChange} />);
  return { onChange, option: (name: string) => screen.getByRole('radio', { name }) };
}

const dialog = (): HTMLElement => screen.getByRole('dialog', { hidden: true });

afterEach(cleanup);

describe('ModeControl', () => {
  it('keeps a closed Automatique out of reach and says what is missing', () => {
    const { onChange, option } = setup('copilot', CLOSED);
    const auto = option('Automatique');
    expect(auto.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(auto);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.focus(auto);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Automatique : verrouillé');
    expect(tip.textContent).toContain('64 % sur 80 %');
    expect(tip.textContent).toContain('pas encore validé');
  });

  it('lights only the chosen mode: Arrêt turns red only when the agent is stopped', () => {
    const dot = (name: string): Element | null =>
      screen.getByRole('radio', { name }).querySelector('.db-mode__dot');
    render(<Harness mode="copilot" automatic={OPEN} onChange={vi.fn()} />);
    expect(dot('Copilote')?.classList.contains('nv-tone--ok')).toBe(true);
    expect(dot('Arrêt')?.classList.contains('nv-tone--bad')).toBe(false);
    expect(dot('Arrêt')?.classList.contains('db-mode__dot--rest')).toBe(true);
    cleanup();
    render(<Harness mode="stop" automatic={OPEN} onChange={vi.fn()} />);
    expect(dot('Arrêt')?.classList.contains('nv-tone--bad')).toBe(true);
    expect(dot('Copilote')?.classList.contains('db-mode__dot--rest')).toBe(true);
  });

  it('lets the dot of Copilote breathe only while the agent acts', () => {
    const dot = (): Element | null =>
      screen.getByRole('radio', { name: 'Copilote' }).querySelector('.db-mode__dot');
    render(<Harness mode="copilot" automatic={OPEN} onChange={vi.fn()} />);
    expect(dot()?.classList.contains('nv-tone--ok')).toBe(true);
    expect(dot()?.classList.contains('nv-dot--live')).toBe(false);
    cleanup();
    render(<Harness mode="copilot" automatic={OPEN} running onChange={vi.fn()} />);
    expect(dot()?.classList.contains('nv-dot--live')).toBe(true);
  });

  it('opens Automatique when the server says so', () => {
    const { onChange, option } = setup('copilot', OPEN);
    expect(option('Automatique').getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(option('Automatique'));
    expect(onChange).toHaveBeenCalledWith('auto');
  });

  it('asks before stopping, and Annuler or Escape changes nothing', () => {
    const { onChange, option } = setup('copilot', CLOSED);
    expect(dialog().getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(option('Arrêt'));
    expect(dialog().getAttribute('aria-hidden')).toBe('false');
    expect(dialog().textContent).toContain('au nom de Léa');
    expect(document.activeElement?.textContent).toBe('Annuler');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(dialog().getAttribute('aria-hidden')).toBe('true');

    fireEvent.click(option('Arrêt'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(dialog().getAttribute('aria-hidden')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(option('Arrêt'));
    fireEvent.click(screen.getByRole('button', { name: 'Arrêter l’agent' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('stop');
  });

  it('keeps its veil catching clicks while it fades, so that a double click stays on the Dashboard (recette 28/10, G2)', () => {
    vi.useFakeTimers();
    try {
      const { onChange, option } = setup('copilot', CLOSED);
      fireEvent.click(option('Arrêt'));
      const confirm = screen.getByRole('button', { name: 'Arrêter l’agent' });
      fireEvent.click(confirm);
      const scrim = document.querySelector('.db-scrim');
      // Closed, but the veil is still there to take the second click of a double click.
      expect(dialog().getAttribute('aria-hidden')).toBe('true');
      expect(scrim?.classList.contains('is-closing')).toBe(true);
      if (scrim !== null) fireEvent.click(scrim);
      expect(onChange).toHaveBeenCalledExactlyOnceWith('stop');
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(scrim?.classList.contains('is-closing')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps Tab inside the dialog while it is open (recette 28/10, M5)', () => {
    const { option } = setup('copilot', CLOSED);
    fireEvent.click(option('Arrêt'));
    const cancel = screen.getByRole('button', { name: 'Annuler' });
    const confirm = screen.getByRole('button', { name: 'Arrêter l’agent' });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: 'Tab' });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('gives the focus back to the option checked once the dialog closes', () => {
    const { option } = setup('copilot', CLOSED);
    fireEvent.click(option('Arrêt'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(option('Copilote'));

    fireEvent.click(option('Arrêt'));
    fireEvent.click(screen.getByRole('button', { name: 'Arrêter l’agent' }));
    // The parent has not re-rendered with the new mode yet: the focus already aims at Arrêt.
    expect(document.activeElement).toBe(option('Arrêt'));
  });

  it('moves with the arrow keys, skipping a closed Automatique', () => {
    const { onChange, option } = setup('copilot', CLOSED);
    expect(option('Copilote').tabIndex).toBe(0);
    expect(option('Arrêt').tabIndex).toBe(-1);

    // Left from Copilote stops there: the locked Automatique is skipped, and nothing wraps onto Arrêt (recette
    // 28/10, M6).
    fireEvent.keyDown(option('Copilote'), { key: 'ArrowLeft' });
    expect(dialog().getAttribute('aria-hidden')).toBe('true');
    expect(document.activeElement).toBe(option('Copilote'));
    // Right moves onto Arrêt, which still asks first: the dialog takes the focus, on Annuler.
    fireEvent.keyDown(option('Copilote'), { key: 'ArrowRight' });
    expect(dialog().getAttribute('aria-hidden')).toBe('false');
    expect(document.activeElement?.textContent).toBe('Annuler');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reaches an open Automatique with the arrow keys', () => {
    const { onChange, option } = setup('copilot', OPEN);
    fireEvent.keyDown(option('Copilote'), { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(option('Automatique'));
    expect(onChange).toHaveBeenCalledWith('auto');
  });

  it('shows a mode it cannot change: the others are greyed and say why, the keys and clicks do nothing', () => {
    const { onChange, option } = setup('copilot', OPEN, 'Exemple : ce contrôle ne pilote aucun agent.');
    expect(option('Copilote').getAttribute('aria-disabled')).toBe('false');
    expect(option('Arrêt').getAttribute('aria-disabled')).toBe('true');
    expect(option('Automatique').getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(option('Arrêt'));
    fireEvent.keyDown(option('Copilote'), { key: 'ArrowRight' });
    expect(dialog().getAttribute('aria-hidden')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.focus(option('Arrêt'));
    expect(screen.getByRole('tooltip').textContent).toContain('ne pilote aucun agent');
  });
});
