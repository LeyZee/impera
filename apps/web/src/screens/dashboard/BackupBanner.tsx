import { Link } from '@tanstack/react-router';
import type { JSX } from 'react';

import { backupBannerOf, useBackupStatus } from './backups';

/**
 * The owner's banner on the daily export and its restore test (OPS-02): shown only when one is missing, amber, and
 * leading to Réglages › Sauvegardes, where a restore test is noted (DASH-19).
 */
export function BackupBanner({ enabled }: { enabled: boolean }): JSX.Element | null {
  const status = useBackupStatus(enabled);
  const banner = enabled && status !== undefined ? backupBannerOf(status) : null;
  if (banner === null) return null;
  return (
    <aside className="nv-plate db-backup nv-enter" role="status" aria-labelledby="db-backup-title">
      <span className="db-backup__orb" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <ellipse cx="12" cy="5" rx="8" ry="3" />
          <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
          <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
        </svg>
      </span>
      <div className="db-backup__body">
        <p id="db-backup-title" className="db-backup__title">
          {banner.title}
        </p>
        <p className="db-backup__text">{banner.text}</p>
        {banner.restore === null ? null : <p className="db-backup__text">{banner.restore}</p>}
      </div>
      <Link className="nv-btn nv-btn--soft nv-btn--sm db-backup__go" to="/reglages/sauvegardes">
        Voir les sauvegardes
      </Link>
    </aside>
  );
}
