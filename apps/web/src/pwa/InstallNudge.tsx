import { Link, useLocation } from '@tanstack/react-router';
import { useLayoutEffect, useRef, useState, useSyncExternalStore, type JSX } from 'react';

import {
  addRefusal,
  canPromptInstall,
  isInstalled,
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

const trimSlash = (path: string): string => (path.length > 1 ? path.replace(/\/+$/u, '') : path);

/**
 * « Impera sur ton écran d’accueil » (CR-01): a card at the head of the role's home screen only (choice of 21/11), on a
 * phone that does not run the installed app and does not know it installed. Android installs from the card when
 * Chrome allows it; an iPhone gets the steps (/aide/installer).
 */
export function InstallNudge({ home }: { home: string }): JSX.Element | null {
  const [shown, setShown] = useState(() => {
    const platform = platformOf(navigator.userAgent, navigator.maxTouchPoints);
    // A computer is never asked: nothing more to read.
    if (platform === 'other') return false;
    return shouldNudge({
      platform,
      standalone: isStandalone(),
      installed: isInstalled(),
      refusals: readRefusals(),
      dismissedThisOpening,
    });
  });
  const canPrompt = useSyncExternalStore(onInstallPrompt, canPromptInstall, () => false);
  // Learnt during the opening too: Chrome's `appinstalled`, or its answer on the related apps.
  const installed = useSyncExternalStore(onInstallPrompt, isInstalled, () => false);
  // Only on the role's home screen, never at the head of the others; so neither on the guide nor on Notifications,
  // which offer the install themselves (recette 11/11, CRE-36).
  const atHome = useLocation({ select: (location) => trimSlash(location.pathname) === trimSlash(home) });
  const card = useRef<HTMLElement>(null);
  const visible = shown && !installed && atHome;
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
        {/* On a phone the card is one line, so her day is read first (Design, 27/11): the short title says it there. */}
        <p className="nv-float__title">
          <span className="nv-install__long">Impera sur ton écran d’accueil</span>
          <span className="nv-install__short">Installer Impera</span>
        </p>
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
          <Link to={INSTALL_GUIDE} className="nv-btn nv-btn--sm nv-btn--soft" onClick={hide}>
            Comment faire
          </Link>
        )}
      </div>
    </aside>
  );
}
