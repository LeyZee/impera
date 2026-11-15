import type { Me } from '@impera/contracts';
import type { JSX } from 'react';

import { usePreferences } from './api';

/**
 * « Sons » (ADR 0104 § 19, ADR 0107): whether a reveal plays its chime. The account's own choice, kept with the
 * account, so it follows them from the computer to the phone. On by default.
 */
export function SoundsToggle({ user }: { user: Me }): JSX.Element {
  const { preferences, save } = usePreferences(user);
  return (
    <label className="rw-sounds">
      <span className="rw-sounds__label">{preferences.sounds ? 'Activés' : 'Coupés'}</span>
      <input
        type="checkbox"
        role="switch"
        className="nv-switch"
        checked={preferences.sounds}
        aria-label={`Sons : ${preferences.sounds ? 'activés' : 'coupés'}`}
        onChange={(event) => {
          save({ ...preferences, sounds: event.target.checked });
        }}
      />
    </label>
  );
}
