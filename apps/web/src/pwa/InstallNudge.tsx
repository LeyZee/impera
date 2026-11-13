import { Link, useLocation } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react';

import {
  addRefusal,
  canPromptInstall,
  isStandalone,
  onInstallPrompt,
  platformOf,
  promptInstall,
  readRefusals,
  shouldNudge,
} from './install';

const INSTALL_GUIDE = '/aide/installer';

/** Dismissed for this opening of the app (module state: a reload or a new opening offers it again). */
let dismissedThisOpening = false;

/**
 * « Installe Impera sur ton téléphone » (CR-01): a card at the head of the page, on a phone that does not run the
 * installed app. Android installs from the card when Chrome allows it; an iPhone gets the steps (/aide/installer).
 */
export function InstallNudge(): JSX.Element | null {
  const [shown, setShown] = useState(() => {
    const platform = platformOf(navigator.userAgent, navigator.maxTouchPoints);
    // A computer is never asked: nothing more to read.
    if (platform === 'other') return false;
    return shouldNudge({
      platform,
      standalone: isStandalone(),
      refusals: readRefusals(),
      dismissedThisOpening,
    });
  });
  const canPrompt = useSyncExternalStore(onInstallPrompt, canPromptInstall, () => false);
  // The guide itself says it all: no card on top of it.
  const onGuide = useLocation({ select: (location) => location.pathname.startsWith(INSTALL_GUIDE) });
  const card = useRef<HTMLElement>(null);
  const visible = shown && !onGuide;
  // The room the card takes at the head of a phone's page, for a fill page (Suivi) to give it back (SOC-14).
  useLayoutEffect(() => {
    const element = card.current;
    if (!visible || element === null) return undefined;
    const root = document.documentElement;
    const measure = (): void => {
      const style = getComputedStyle(element);
      const room =
        style.position === 'fixed' ? 0 : element.offsetHeight + Number.parseFloat(style.marginBottom || '0');
      root.style.setProperty('--nv-install-room', `${String(room)}px`);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--nv-install-room');
    };
  }, [visible]);
  if (!visible) return null;
  const hide = (): void => {
    dismissedThisOpening = true;
    setShown(false);
  };
  return (
    <aside ref={card} className="nv-float nv-install nv-glass nv-glass--thick" aria-label="Installer Impera">
      <img className="nv-float__icon" src="/icons/icon-192.png" alt="" width={44} height={44} />
      <div className="nv-float__body">
        <p className="nv-float__title">Impera sur ton écran d’accueil</p>
        <p className="nv-float__text">Ouverture en un geste, plein écran, et les notifications.</p>
      </div>
      <div className="nv-float__actions">
        <button
          type="button"
          className="nv-btn nv-btn--sm nv-btn--plain"
          onClick={() => {
            addRefusal();
            hide();
          }}
        >
          Plus tard
        </button>
        {canPrompt ? (
          <button
            type="button"
            className="nv-btn nv-btn--sm nv-btn--neon"
            onClick={() => {
              void promptInstall().then((installed) => {
                if (installed) hide();
              });
            }}
          >
            Installer
          </button>
        ) : (
          <Link to={INSTALL_GUIDE} className="nv-btn nv-btn--sm nv-btn--neon" onClick={hide}>
            Comment faire
          </Link>
        )}
      </div>
    </aside>
  );
}
