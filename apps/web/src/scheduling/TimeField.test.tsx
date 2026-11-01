// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { TimeField, useUnreadableTimes } from './TimeField';

afterEach(cleanup);

function Harness({ second = false }: { second?: boolean }): JSX.Element {
  const [minute, setMinute] = useState(540);
  const times = useUnreadableTimes();
  return (
    <>
      <TimeField value={minute} label="Début" onChange={setMinute} onUnreadable={times.onUnreadable} />
      {second ? (
        <TimeField value={minute} label="Fin" onChange={setMinute} onUnreadable={times.onUnreadable} />
      ) : null}
      <output>{times.unreadable ? 'bloqué' : String(minute)}</output>
    </>
  );
}

describe('TimeField', () => {
  it('is a text field on 24 hours: what is typed stays until the field is left, then reads HH:MM', () => {
    render(<Harness />);
    const field = screen.getByLabelText('Début');
    expect(field).toHaveProperty('type', 'text');
    expect(field).toHaveProperty('value', '09:00');
    fireEvent.change(field, { target: { value: '21h' } });
    expect(field).toHaveProperty('value', '21h');
    expect(screen.getByRole('status').textContent).toBe('1260');
    fireEvent.blur(field);
    expect(field).toHaveProperty('value', '21:00');
  });

  it('takes an hour alone: « 22 » is 22:00 (relecture Équipe, #301)', () => {
    render(<Harness />);
    const field = screen.getByLabelText('Début');
    fireEvent.change(field, { target: { value: '22' } });
    expect(screen.getByRole('status').textContent).toBe('1320');
    fireEvent.blur(field);
    expect(field).toHaveProperty('value', '22:00');
  });

  it('takes digits alone from the phone’s number pad: « 930 » is 09:30 (relecture Extension, #301)', () => {
    render(<Harness />);
    const field = screen.getByLabelText('Début');
    expect(field.getAttribute('inputmode')).toBe('numeric');
    fireEvent.change(field, { target: { value: '930' } });
    fireEvent.blur(field);
    expect(field).toHaveProperty('value', '09:30');
    expect(screen.getByRole('status').textContent).toBe('570');
  });

  it('keeps what is not an hour as typed, marked, and holds the form back until it is one', () => {
    render(<Harness />);
    const field = screen.getByLabelText('Début');
    fireEvent.change(field, { target: { value: '25:00' } });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('bloqué');
    // Leaving it never writes another hour in its place.
    fireEvent.blur(field);
    expect(field).toHaveProperty('value', '25:00');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('bloqué');
    fireEvent.change(field, { target: { value: '23:00' } });
    fireEvent.blur(field);
    expect(field).toHaveProperty('value', '23:00');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('1380');
  });

  it('frees the form when the unreadable field is taken away', () => {
    const { rerender } = render(<Harness second />);
    fireEvent.change(screen.getByLabelText('Fin'), { target: { value: '9:' } });
    expect(screen.getByRole('status').textContent).toBe('bloqué');
    rerender(<Harness />);
    expect(screen.getByRole('status').textContent).toBe('540');
  });
});
