// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { matchSelect, Select, type SelectOption } from './Select';

afterEach(cleanup);

const FEW: SelectOption<'eur' | 'usd' | 'chf'>[] = [
  { value: 'eur', label: 'Euro', hint: '€' },
  { value: 'usd', label: 'Dollar', hint: '$' },
  { value: 'chf', label: 'Franc suisse', disabled: true },
];

const LOOSE: SelectOption<string>[] = [{ value: 'eur', label: 'Euro' }];

const CITIES = [
  'Paris',
  'Lyon',
  'Genève',
  'Bruxelles',
  'Montréal',
  'Dakar',
  'Abidjan',
  'Cotonou',
  'Lomé',
  'Tunis',
  'Alger',
  'Casablanca',
].map((city) => ({
  value: city.toLowerCase(),
  label: city,
  group: city === 'Paris' ? 'Les plus courantes' : 'Toutes',
}));

function Form<V extends string>({
  options,
  initial,
  onChange,
}: {
  options: readonly SelectOption<V>[];
  initial: V | '';
  onChange: (value: V) => void;
}): JSX.Element {
  const [value, setValue] = useState<V | ''>(initial);
  return (
    <>
      <label htmlFor="pick">Monnaie</label>
      <Select
        id="pick"
        value={value}
        options={options}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
      <button type="button">Ailleurs</button>
    </>
  );
}

describe('matchSelect', () => {
  it('finds a choice without its accents or its case', () => {
    expect(matchSelect(CITIES, 'gene').map((one) => one.label)).toEqual(['Genève']);
    expect(matchSelect(CITIES, '  ').length).toBe(CITIES.length);
  });

  it('puts first, within its group, a choice with a word that begins with the text', () => {
    const zones = ['Edmonton', 'Monterrey', 'Toronto (Montréal)'].map((label) => ({ value: label, label }));
    expect(matchSelect(zones, 'mont').map((one) => one.label)).toEqual([
      'Monterrey',
      'Toronto (Montréal)',
      'Edmonton',
    ]);
  });
});

describe('Select', () => {
  it('is named by its label, says the choice, and is no select of the system', () => {
    render(<Form options={FEW} initial="eur" onChange={vi.fn()} />);
    const field = screen.getByRole('combobox', { name: 'Monnaie' });
    expect(field.textContent).toContain('Euro');
    expect(field.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('select')).toBeNull();
  });

  it('opens on a click, ticks the choice, and picks another with a click', () => {
    const onChange = vi.fn();
    render(<Form options={FEW} initial="eur" onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Monnaie' }));
    const list = screen.getByRole('listbox');
    expect(within(list).getByRole('option', { name: /Euro/u }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(within(list).getByRole('option', { name: /Dollar/u }));
    expect(onChange).toHaveBeenCalledWith('usd');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Monnaie' }));
  });

  it('moves with the arrows past a choice that cannot be picked, and picks with Enter', () => {
    const onChange = vi.fn();
    render(<Form options={FEW} initial="eur" onChange={onChange} />);
    const field = screen.getByRole('combobox', { name: 'Monnaie' });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('usd');
  });

  it('finds a choice of a short list from its first letters', () => {
    const onChange = vi.fn();
    render(<Form options={FEW} initial="usd" onChange={onChange} />);
    const field = screen.getByRole('combobox', { name: 'Monnaie' });
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.keyDown(field, { key: 'e' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('eur');
  });

  it('closes with Escape without leaving the dialog around it', () => {
    const outer = vi.fn();
    render(
      <div onKeyDown={outer}>
        <Form options={FEW} initial="eur" onChange={vi.fn()} />
      </div>,
    );
    const field = screen.getByRole('combobox', { name: 'Monnaie' });
    fireEvent.click(field);
    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(outer).not.toHaveBeenCalled();
  });

  it('opens a long list with a field that finds a choice, under its group', () => {
    const onChange = vi.fn();
    render(<Form options={CITIES} initial="paris" onChange={onChange} />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Monnaie' }));
    expect(screen.getByText('Les plus courantes')).toBeDefined();
    const search = screen.getByRole('combobox', { name: 'Chercher' });
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: 'come' } });
    expect(screen.getByText('Aucun choix ne correspond.')).toBeDefined();
    fireEvent.change(search, { target: { value: 'gen' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('genève');
  });

  it('shows a value not in its options as itself, and the placeholder when there is none', () => {
    const { rerender } = render(<Select id="a" value="xof" options={LOOSE} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox').textContent).toContain('xof');
    rerender(<Select id="a" value="" options={LOOSE} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox').textContent).toContain('Choisir…');
  });
});
