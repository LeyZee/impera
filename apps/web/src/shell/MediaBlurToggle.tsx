import { playOnce } from '@impera/design-system';
import { useRef, type JSX } from 'react';

import { NavIcon } from './NavIcon';
import { setMediaBlur, useMediaBlur } from './media-blur';

/**
 * « Flou des médias » (SC-04 lot c4): her photos and videos blurred on every screen of the agency, or shown as they
 * are. An eye crossed out while they are blurred, open when they are not. In the rail on a computer, in « Plus » on the
 * phone (its bar has no room); one choice of this browser either way (`media-blur.ts`).
 */
export function MediaBlurToggle({ variant }: { variant: 'rail' | 'sheet' }): JSX.Element {
  const blurred = useMediaBlur();
  const icon = useRef<HTMLSpanElement>(null);
  const state = blurred ? 'Floutés' : 'Nets';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={blurred}
      aria-label="Flou des médias"
      className={variant === 'rail' ? 'nv-rail__blur' : 'nv-more__item nv-more__blur'}
      data-on={blurred}
      title={
        blurred
          ? 'Ses photos et vidéos sont floutées. Clique pour les voir nettes.'
          : 'Ses photos et vidéos sont nettes. Clique pour les flouter.'
      }
      onClick={() => {
        setMediaBlur(!blurred);
        const svg = icon.current?.querySelector('svg');
        if (svg !== null && svg !== undefined) playOnce(svg, 'is-playing');
      }}
    >
      <span className="nv-rail__blur-icon" ref={icon} aria-hidden="true">
        <NavIcon name={blurred ? 'eye-off' : 'eye'} />
      </span>
      <span className="nv-rail__blur-label" aria-hidden="true">
        Flou des médias
      </span>
      <span className="nv-rail__blur-state nv-swap" key={state} aria-hidden="true">
        {state}
      </span>
    </button>
  );
}
