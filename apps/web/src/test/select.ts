import { fireEvent, screen, within } from '@testing-library/react';

/** Opens a list of the design system (`Select`) as a person does, and gives its choices. */
export function openList(field: HTMLElement): HTMLElement {
  if (field.getAttribute('aria-expanded') !== 'true') fireEvent.click(field);
  return screen.getByRole('listbox');
}

/** Picks a choice of a list of the design system (`Select`) as a person does: opens it, clicks the choice. */
export function choose(field: HTMLElement, name: string | RegExp): void {
  fireEvent.click(within(openList(field)).getByRole('option', { name }));
}

/** The values a list of the design system (`Select`) offers, in order; the list is closed again after. */
export function valuesOf(field: HTMLElement): string[] {
  const values = within(openList(field))
    .getAllByRole('option')
    .map((option) => option.getAttribute('data-value') ?? '');
  fireEvent.keyDown(field, { key: 'Escape' });
  return values;
}

/** Picks the choice of a list of the design system (`Select`) that keeps `value`, as a person does. */
export function chooseValue(field: HTMLElement, value: string): void {
  const option = within(openList(field))
    .getAllByRole('option')
    .find((one) => one.getAttribute('data-value') === value);
  if (option === undefined) throw new Error(`No choice keeps ${value}`);
  fireEvent.click(option);
}
