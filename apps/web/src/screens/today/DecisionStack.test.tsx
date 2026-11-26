// @vitest-environment jsdom
import { CreatorDecisionSchema, type CreatorDecision } from '@impera/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DecisionStack } from './DecisionStack';

/* Invented questions (ADR 0010). */
const id = (n: number): string => `01936f00-0000-7000-8000-${String(n).padStart(12, '0')}`;

const caption: CreatorDecision = CreatorDecisionSchema.parse({
  id: id(1),
  kind: 'caption',
  category: 'post',
  question: 'Quelle légende pour ton Reel de ce soir ?',
  context: 'Reel « miroir, robe noire », prévu à 18 h 30.',
  layout: 'rows',
  answers: [
    {
      key: 'question',
      label: 'Une question',
      text: 'Robe noire ou robe rouge ?',
      noted: 'Ce sera la question.',
    },
    { key: 'teasing', label: 'Taquine', text: 'Vingt minutes pour choisir.', noted: 'Ce sera la taquine.' },
  ],
  otherIdeasLeft: 2,
  expiresAt: '2026-11-21T17:30:00.000Z',
});

const time: CreatorDecision = CreatorDecisionSchema.parse({
  id: id(2),
  kind: 'publish_time',
  category: 'post',
  question: 'Je publie ton Reel à 18 h 30 ?',
  context: 'C’est l’heure où tes abonnés sont le plus là.',
  layout: 'buttons',
  answers: [
    { key: 'yes', label: 'Oui, à 18 h 30', text: null, noted: 'Je publie à 18 h 30.' },
    { key: 'change', label: 'Changer l’heure', text: null, noted: 'On change l’heure.' },
  ],
  otherIdeasLeft: 0,
  expiresAt: '2026-11-21T17:30:00.000Z',
});

const quiet = { onAnswer: () => Promise.resolve('C’est noté.'), onLater: () => Promise.resolve() };

afterEach(cleanup);

describe('« À décider », hers (ADR 0164)', () => {
  it('shows nothing while nothing waits', () => {
    const { container } = render(<DecisionStack decisions={[]} {...quiet} />);
    expect(container.textContent).toBe('');
  });

  it('shows one question at a time, counted, with every caption read in full', () => {
    render(<DecisionStack decisions={[caption, time]} {...quiet} />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(caption.question);
    expect(screen.getByText('1 sur 2')).toBeTruthy();
    expect(screen.getByText('Robe noire ou robe rouge ?')).toBeTruthy();
    expect(screen.getByText('Vingt minutes pour choisir.')).toBeTruthy();
    expect(screen.queryByText(time.question)).toBeNull();
    // No other ideas while nothing proposes them.
    expect(screen.queryByRole('button', { name: 'D’autres idées' })).toBeNull();
  });

  it('keeps her answer, says it is noted, then lets the next one in and counts on', async () => {
    const onAnswer = vi.fn(() => Promise.resolve('Ce sera la taquine.'));
    const { rerender } = render(<DecisionStack decisions={[caption, time]} {...quiet} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole('button', { name: /Taquine/u }));
    expect((await screen.findByRole('status')).textContent).toContain('Ce sera la taquine.');
    expect(onAnswer).toHaveBeenCalledWith(caption, 'teasing');
    // The server's list already lost it: she still reads what was noted.
    rerender(<DecisionStack decisions={[time]} {...quiet} onAnswer={onAnswer} />);
    expect(screen.getByRole('status').textContent).toContain('Ce sera la taquine.');
    expect(screen.getByText('1 sur 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Suivante' }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(time.question);
    expect(screen.getByText('2 sur 2')).toBeTruthy();
  });

  it('puts a question aside in one gesture', async () => {
    const onLater = vi.fn(() => Promise.resolve());
    render(<DecisionStack decisions={[time]} {...quiet} onLater={onLater} />);
    expect(screen.queryByText(/sur/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    await waitFor(() => {
      expect(onLater).toHaveBeenCalledWith(time);
    });
  });

  it('says so when an answer could not be kept, and keeps the question', async () => {
    render(
      <DecisionStack decisions={[time]} {...quiet} onAnswer={() => Promise.reject(new Error('offline'))} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Oui, à 18 h 30' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Ça n’a pas marché');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(time.question);
  });

  it('asks for other ideas with what she touched and wrote, and shows the three new ones', async () => {
    const onOtherIdeas = vi.fn(() =>
      Promise.resolve([
        { key: 'a', label: 'Plus drôle', text: 'Le miroir a dit oui.', noted: 'Ce sera celle-là.' },
        { key: 'b', label: 'Plus drôle', text: 'Moi 1, ma garde-robe 0.', noted: 'Ce sera celle-là.' },
      ]),
    );
    render(<DecisionStack decisions={[caption]} {...quiet} onOtherIdeas={onOtherIdeas} />);
    fireEvent.click(screen.getByRole('button', { name: 'D’autres idées' }));
    // Neither a hint nor a word yet: nothing to ask.
    fireEvent.click(screen.getByRole('button', { name: 'Proposer trois autres' }));
    expect(onOtherIdeas).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Plus drôle' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Parle de samedi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Proposer trois autres' }));
    expect(await screen.findByText('Le miroir a dit oui.')).toBeTruthy();
    expect(onOtherIdeas).toHaveBeenCalledWith(caption, ['funnier'], 'Parle de samedi');
    expect(screen.queryByText('Robe noire ou robe rouge ?')).toBeNull();
  });

  it('looks as it always did for her: no name, no end, no notice in the head', () => {
    const { container } = render(<DecisionStack decisions={[caption]} {...quiet} />);
    expect(container.querySelector('.sc-ask__who')).toBeNull();
    expect(container.querySelector('.sc-ask__due')).toBeNull();
    expect(screen.getByRole('button', { name: 'Plus tard' })).toBeTruthy();
  });

  it('lets the owner answer in her place: her name, the end as a tag, the notice, and no « Plus tard »', () => {
    const { container } = render(
      <DecisionStack
        decisions={[caption]}
        onAnswer={quiet.onAnswer}
        who={() => ({ name: 'Nora' })}
        due={() => ({ label: 'Plus que 40 min', soon: true })}
        notice={() => <p className="nv-note">Tu réponds à la place de Nora.</p>}
      />,
    );
    expect(container.querySelector('.sc-ask__who')?.textContent).toBe('NNora');
    expect(screen.getByText('Plus que 40 min').className).toContain('nv-tag--warn');
    expect(screen.getByText('Tu réponds à la place de Nora.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Plus tard' })).toBeNull();
    // Nothing left in the foot: no empty footer keeps its margin.
    expect(container.querySelector('.sc-ask__foot')).toBeNull();
  });
});
