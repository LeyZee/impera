// @vitest-environment jsdom
import { SAMPLE_REPLIES_MAX, type Persona } from '@nirvana/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LifestyleTab, SampleRepliesTab, TastesTab, WRITING_STYLE_START, WritingStyleTab } from './blocks';
import { FormContext } from './fields';
import { refusedReplyIssues } from './model';

afterEach(() => {
  cleanup();
});

const replies = (n: number): NonNullable<Persona['sample_replies']> =>
  Array.from({ length: n }, (_, i) => ({ situation: null, reply: `Réponse inventée ${String(i + 1)}` }));

describe('Style d’écriture', () => {
  it('says what a first choice starts from, then writes the block from it', () => {
    const onChange = vi.fn<(value: Persona['writing_style']) => void>();
    render(<WritingStyleTab value={undefined} onChange={onChange} issues={[]} />);
    expect(screen.getByText(/Le premier choix crée ce bloc/u)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Effacer ce bloc' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Longs' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...WRITING_STYLE_START, message_length: 'long' });
  });

  it('refuses the same emoji twice, with or without its variation selector, and clears the block', () => {
    const onChange = vi.fn<(value: Persona['writing_style']) => void>();
    render(
      <WritingStyleTab
        value={{ ...WRITING_STYLE_START, emojis_preferred: ['❤️'] }}
        onChange={onChange}
        issues={[]}
      />,
    );
    const input = screen.getByLabelText('Ses emojis');
    fireEvent.change(input, { target: { value: '❤' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Effacer ce bloc' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });
});

describe('Mode de vie and Goûts', () => {
  it('drops a block emptied of everything, so the version keeps it absent', () => {
    const onLife = vi.fn<(value: Persona['lifestyle']) => void>();
    render(
      <LifestyleTab
        value={{ occupation: 'Étudiante', area: null, routine: null, goals: null }}
        onChange={onLife}
        issues={[]}
      />,
    );
    fireEvent.change(screen.getByLabelText('Ce qu’elle fait'), { target: { value: '' } });
    expect(onLife).toHaveBeenLastCalledWith(undefined);
    cleanup();

    const onTastes = vi.fn<(value: Persona['tastes']) => void>();
    render(<TastesTab value={undefined} onChange={onTastes} issues={[]} />);
    const likes = screen.getByLabelText('Ce qu’elle aime');
    fireEvent.change(likes, { target: { value: 'Salsa' } });
    fireEvent.keyDown(likes, { key: 'Enter' });
    expect(onTastes).toHaveBeenLastCalledWith({ likes: ['Salsa'], dislikes: [] });
  });
});

describe('Réponses types', () => {
  it('previews a reply as a fan reads it, and removes it', () => {
    const onChange = vi.fn<(value: Persona['sample_replies']) => void>();
    render(<SampleRepliesTab value={replies(2)} onChange={onChange} issues={[]} />);
    expect(screen.getByText('Réponse inventée 1', { selector: 'p' }).className).toBe(
      'nv-bubble nv-bubble--creator',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retirer la 1re réponse' }));
    expect(onChange).toHaveBeenLastCalledWith([{ situation: null, reply: 'Réponse inventée 2' }]);
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une réponse type' }));
    expect(onChange).toHaveBeenLastCalledWith([...replies(2), { situation: null, reply: '' }]);
  });

  it('stops adding at the maximum, and an emptied list is no block', () => {
    const onChange = vi.fn<(value: Persona['sample_replies']) => void>();
    const { rerender } = render(
      <SampleRepliesTab value={replies(SAMPLE_REPLIES_MAX)} onChange={onChange} issues={[]} />,
    );
    expect(screen.queryByRole('button', { name: 'Ajouter une réponse type' })).toBeNull();
    expect(screen.getByText(/10 réponses au plus/u)).toBeDefined();

    rerender(<SampleRepliesTab value={replies(1)} onChange={onChange} issues={[]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer la 1re réponse' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('says on the reply why the server refused it', () => {
    const issues = refusedReplyIssues([{ index: 1, code: 'ai_disclosure' }]);
    render(
      <FormContext.Provider value={{ issues, changed: [] }}>
        <SampleRepliesTab value={replies(2)} onChange={vi.fn()} issues={issues} />
      </FormContext.Provider>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('L’agent ne l’enverrait pas : un aveu d’IA.');
    expect(alert.closest('[data-path]')?.getAttribute('data-path')).toBe('sample_replies.1.reply');
  });
});
