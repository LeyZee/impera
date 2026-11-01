import type { Dashboard as DashboardData } from '@nirvana/contracts';
import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import './night-banner.css';

/** What the Dashboard knows of Telegram for one creator (`GET /v1/dashboard`). */
export interface TelegramNight {
  /** Null when Telegram is off on the server (no encryption key): no bot can run. */
  readonly coverage: { readonly urgentReachable: boolean } | null;
}

/** From the route's answer to what the banner reads. */
export function telegramNightOf(dashboard: Pick<DashboardData, 'telegramCoverage'>): TelegramNight {
  return { coverage: dashboard.telegramCoverage };
}

interface Banner {
  readonly state: 'off' | 'uncovered';
  readonly title: string;
  readonly text: string;
  /** Null when nothing on the page can fix it (the server's key is the owner's job). */
  readonly action: string | null;
}

/**
 * Nothing when her urgent alerts reach a group (zero noise), or before the data arrives. Otherwise the one thing to
 * know at night: an urgent pause would reach nobody.
 */
export function nightBannerOf(night: TelegramNight | undefined, creatorName: string): Banner | null {
  if (night === undefined) return null;
  if (night.coverage === null) {
    return {
      state: 'off',
      title: 'Les alertes Telegram ne tournent pas',
      text: 'Le serveur n’est pas encore réglé pour envoyer des alertes. La nuit, personne ne serait prévenu d’une urgence.',
      action: null,
    };
  }
  if (night.coverage.urgentReachable) return null;
  return {
    state: 'uncovered',
    title: 'Personne n’est prévenu la nuit',
    text: `Aucun groupe Telegram ne reçoit les urgences de ${creatorName}. Si l’agent se met en pause pour un fan, personne ne le saura avant le matin.`,
    action: 'Choisir un groupe',
  };
}

/** The Dashboard's coverage banner (fiche P3-07): shown only when something is wrong. */
export function NightBanner({
  night,
  creatorName,
}: {
  night: TelegramNight | undefined;
  creatorName: string;
}): JSX.Element | null {
  const banner = nightBannerOf(night, creatorName);
  if (banner === null) return null;
  return (
    <aside className="nv-plate tg-night nv-enter" data-state={banner.state} aria-labelledby="tg-night-title">
      <span className="tg-night__orb" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
        </svg>
      </span>
      <div className="tg-night__body">
        <p id="tg-night-title" className="tg-night__title">
          {banner.title}
        </p>
        <p className="tg-night__text">{banner.text}</p>
      </div>
      {banner.action === null ? null : (
        <Link className="nv-btn nv-btn--soft nv-btn--sm tg-night__go" to="/reglages/telegram">
          {banner.action}
        </Link>
      )}
    </aside>
  );
}
