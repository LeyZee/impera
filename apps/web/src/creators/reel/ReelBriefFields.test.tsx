// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ReelBriefFields } from './ReelBriefFields';
import { emptyReelDraft, reelBriefOf, type ReelDraft } from './model';

import { ReelBrief } from '@/screens/agenda/ReelBrief';

afterEach(cleanup);

let last: ReelDraft = emptyReelDraft();

function Form({ tried = false }: { tried?: boolean }): JSX.Element {
  const [draft, setDraft] = useState(emptyReelDraft);
  last = draft;
  return <ReelBriefFields draft={draft} tried={tried} onChange={setDraft} />;
}

const type = (label: string | RegExp, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

// Invented sentences only (ADR 0010).
describe('« Fiche reel », the agency’s form (VEI-08)', () => {
  it('counts words, turns amber at the bound and takes no word more', () => {
    render(<Form />);
    type(/Première phrase/u, 'Trois secondes pour te convaincre');
    const counter = screen.getByText('5 / 8 mots');
    expect(counter.dataset['full']).toBeUndefined();
    type(/Première phrase/u, 'un deux trois quatre cinq six sept huit neuf');
    expect(screen.getByLabelText<HTMLInputElement>(/Première phrase/u).value).toBe(
      'un deux trois quatre cinq six sept huit',
    );
    expect(screen.getByText('8 / 8 mots').dataset['full']).toBe('true');
    type(/Texte à l’écran/u, 'un deux trois quatre cinq six sept');
    expect(screen.getByText('6 / 6 mots')).toBeDefined();
    // Never a red error after the fact.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('adds, moves and removes shots, from two to six', () => {
    render(<Form />);
    type('Plan 1', 'Gros plan sur la tasse');
    type('Plan 2', 'Elle sourit');
    fireEvent.click(screen.getByRole('button', { name: 'Monter le plan 2' }));
    expect(last.shots.map((shot) => shot.text)).toEqual(['Elle sourit', 'Gros plan sur la tasse']);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Retirer le plan 1' }).disabled).toBe(true);
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByRole('button', { name: 'Ajouter un plan' }));
    expect(last.shots).toHaveLength(6);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Six plans au plus' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer le plan 6' }));
    expect(last.shots).toHaveLength(5);
  });

  it('moves the duration by steps of 5 from the keyboard', () => {
    render(<Form />);
    const slider = screen.getByRole('slider', { name: 'Durée' });
    expect(slider.getAttribute('aria-valuenow')).toBe('20');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    fireEvent.keyDown(slider, { key: 'PageUp' });
    expect(slider.getAttribute('aria-valuenow')).toBe('40');
    fireEvent.keyDown(slider, { key: 'End' });
    expect(slider.getAttribute('aria-valuenow')).toBe('90');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.getAttribute('aria-valuenow')).toBe('90');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(last.seconds).toBe(5);
  });

  it('says what is missing in amber once sent, nothing for a blank sheet', () => {
    const { unmount } = render(<Form tried />);
    expect(screen.queryByText(/Deux plans au moins/u)).toBeNull();
    unmount();
    render(<Form tried />);
    type(/Première phrase/u, 'Bonjour toi');
    expect(screen.getByText('Deux plans au moins.')).toBeDefined();
  });

  it('previews exactly what she will see, at each keystroke', () => {
    render(<Form />);
    type(/Première phrase/u, 'Trois secondes pour te convaincre');
    type(/Texte à l’écran/u, 'Café du matin');
    type('Plan 1', 'Gros plan sur la tasse');
    type('Plan 2', 'Elle sourit');
    const preview = within(screen.getByRole('group', { name: 'Ce qu’elle verra' }));
    const brief = reelBriefOf(last);
    if (brief === null) throw new Error('a complete sheet');
    const { container } = render(<ReelBrief brief={brief} />);
    const shown = preview.getByText('Trois secondes pour te convaincre').closest('.ag-reel');
    expect(shown?.outerHTML.replace(/_r_[a-z0-9]+_|«r[0-9a-z]+»/gu, 'ID')).toBe(
      container.querySelector('.ag-reel')?.outerHTML.replace(/_r_[a-z0-9]+_|«r[0-9a-z]+»/gu, 'ID'),
    );
  });
});
