import type { JSX } from 'react';

/**
 * « Afficher » beside a service key or a bot token (recette 05/11, PRO-29): the three secrets of Réglages are masked
 * alike while pasted and checked (CSS `sv-key__secret`, never `type=password`, which password managers would fill or
 * offer to save), and can be read once to compare with the provider's console.
 */
export function RevealKey({
  shown,
  onToggle,
  disabled = false,
}: {
  shown: boolean;
  onToggle: () => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className="nv-btn nv-btn--plain nv-btn--sm"
      aria-pressed={shown}
      disabled={disabled}
      onClick={onToggle}
    >
      {shown ? 'Masquer' : 'Afficher'}
    </button>
  );
}
