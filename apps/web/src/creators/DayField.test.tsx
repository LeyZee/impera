// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DayField, dayOfInput, inputOfDay } from './DayField';

afterEach(cleanup);

describe('dayOfInput (recette 05/11, PRO-11)', () => {
  it('reads a day written day first, whatever the separator', () => {
    expect(dayOfInput('28/02/1999')).toBe('1999-02-28');
    expect(dayOfInput(' 1.3.2026 ')).toBe('2026-03-01');
    expect(dayOfInput('28-02-1999')).toBe('1999-02-28');
    expect(dayOfInput('28021999')).toBe('1999-02-28');
  });

  it('refuses what is half typed or not a day of the calendar', () => {
    expect(dayOfInput('28/02')).toBeNull();
    expect(dayOfInput('31/02/2026')).toBeNull();
    expect(dayOfInput('02/28/1999')).toBeNull();
    expect(dayOfInput('')).toBeNull();
  });

  it('writes a day back as jj/mm/aaaa', () => {
    expect(inputOfDay('1999-02-28')).toBe('28/02/1999');
    expect(inputOfDay('')).toBe('');
  });
});

function Form(): JSX.Element {
  const [day, setDay] = useState('1999-02-28');
  return (
    <>
      <DayField id="dob" value={day} onChange={setDay} />
      <output>{day === '' ? 'vide' : day}</output>
    </>
  );
}

describe('DayField', () => {
  it('shows jj/mm/aaaa, never the browser’s own order, and gives the form the day typed', () => {
    render(<Form />);
    const field = screen.getByRole('textbox');
    expect(field.getAttribute('type')).toBe('text');
    expect(field.getAttribute('placeholder')).toBe('jj/mm/aaaa');
    expect(field).toHaveProperty('value', '28/02/1999');

    fireEvent.change(field, { target: { value: '12/04/2001' } });
    expect(screen.getByRole('status').textContent).toBe('2001-04-12');
  });

  it('keeps what is not a day as typed, marked, and gives the form no day', () => {
    render(<Form />);
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: '31/02/2001' } });
    fireEvent.blur(field);
    expect(field).toHaveProperty('value', '31/02/2001');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('vide');
    expect(screen.getByText('Une date comme 28/02/1999 : jour, mois, année.')).toBeDefined();
  });
});
