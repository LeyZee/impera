// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState, type JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { DayField } from './DayField';

afterEach(cleanup);

function Harness({ optional = false }: { optional?: boolean }): JSX.Element {
  const [day, setDay] = useState('2026-11-05');
  const [unreadable, setUnreadable] = useState(false);
  return (
    <>
      <label htmlFor="day">Jour</label>
      {/* An inline callback, as the forms write it: the field reads the latest one. */}
      <DayField
        id="day"
        value={day}
        today="2026-11-05"
        optional={optional}
        onChange={setDay}
        onUnreadable={(bad) => {
          setUnreadable(bad);
        }}
      />
      <output>{unreadable ? 'bloqué' : day === '' ? 'vide' : day}</output>
      <button
        type="button"
        onClick={() => {
          setDay('2026-12-24');
        }}
      >
        Réveillon
      </button>
    </>
  );
}

describe('DayField', () => {
  it('is a text field in French order, never the system’s calendar', () => {
    render(<Harness />);
    const field = screen.getByLabelText('Jour');
    expect(field).toHaveProperty('type', 'text');
    expect(field).toHaveProperty('value', '05/11/2026');
    fireEvent.change(field, { target: { value: '28/3' } });
    expect(screen.getByRole('status').textContent).toBe('2027-03-28');
    fireEvent.blur(field);
    expect(field).toHaveProperty('value', '28/03/2027');
  });

  it('holds the form back while it is no day, and marks it only once left', () => {
    render(<Harness />);
    const field = screen.getByLabelText('Jour');
    fireEvent.change(field, { target: { value: '31/02' } });
    expect(screen.getByRole('status').textContent).toBe('bloqué');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    fireEvent.blur(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field).toHaveProperty('value', '31/02');
    fireEvent.change(field, { target: { value: '28/02' } });
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('2027-02-28');
  });

  it('shows the form’s day when the form sets another, even while one is being typed', () => {
    render(<Harness />);
    const field = screen.getByLabelText('Jour');
    fireEvent.change(field, { target: { value: '2/1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Réveillon' }));
    expect(field).toHaveProperty('value', '24/12/2026');
  });

  it('may be left empty when the form allows it', () => {
    render(<Harness optional />);
    const field = screen.getByLabelText('Jour');
    fireEvent.change(field, { target: { value: '' } });
    expect(screen.getByRole('status').textContent).toBe('vide');
  });
});
