// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import * as arts from './EmptyArt';

import { Empty } from '@/shell/states';

describe('the pictures of an empty screen', () => {
  it.each(Object.entries(arts))('%s is a decorative picture with its own gradient ids', (_name, Picture) => {
    const { container } = render(
      <>
        <Picture />
        <Picture />
      </>,
    );
    const pictures = container.querySelectorAll('svg.nv-art');
    expect(pictures).toHaveLength(2);
    for (const picture of pictures) expect(picture.getAttribute('aria-hidden')).toBe('true');
    const ids = [...container.querySelectorAll('[id]')].map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).not.toContain(':');
  });

  it('takes the place of the icon in an empty state', () => {
    const { container, getByText } = render(
      <Empty title="Rien ici" art={<arts.ChatArt />} icon={<span data-testid="icon" />}>
        Bientôt.
      </Empty>,
    );
    expect(getByText('Rien ici')).toBeTruthy();
    expect(container.querySelector('.nv-empty__art svg.nv-art')).not.toBeNull();
    expect(container.querySelector('[data-testid="icon"]')).toBeNull();
  });
});
