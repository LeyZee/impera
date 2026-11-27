import {
  CREATOR_ALERT_MODES,
  CREATOR_ALERT_ROLES,
  type CreatorAlertFamily,
  type CreatorAlertLine,
  type CreatorAlertMode,
  type CreatorAlertRole,
  type CreatorAlertsView,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { ALERTS_ERRORS, alertsErrorKind, alertsQueryKey, saveCreatorAlert, useCreatorAlerts } from './api';
import {
  ALERT_TEXT,
  FAMILY_TITLES,
  MODE_LABELS,
  MODE_SENTENCES,
  ROLE_LABELS,
  byFamily,
  reachesNobody,
  withMode,
} from './model';

import { Failure } from '@/shell/states';

import './alerts.css';

/**
 * Créatrices › Alertes (ADR 0150), the owner's alone: for each alert of hers, by role, whether it rings (Reçoit),
 * comes without sound (Sourdine) or reaches nobody (Rien). The safety relays always ring, night included: no control,
 * the words. A change is saved at once, line by line; she never sees this tab (her own Notifications are hers).
 */
export function AlertsTab({
  creatorId,
  creatorName,
}: {
  creatorId: string;
  creatorName: string;
}): JSX.Element {
  const read = useCreatorAlerts(creatorId);
  const client = useQueryClient();
  const [status, setStatus] = useState<{ readonly text: string; readonly failed: boolean } | null>(null);
  const view = read.data;

  if (view === undefined) {
    return read.isError ? (
      <Failure onRetry={() => void read.refetch()} />
    ) : (
      <div className="ca-page" aria-busy="true" aria-label="Lecture de ses alertes">
        <div className="nv-plate ps-panel ca-skeleton" />
        <div className="nv-plate ps-panel ca-skeleton ca-skeleton--tall" />
      </div>
    );
  }

  async function change(
    line: CreatorAlertLine,
    role: CreatorAlertRole,
    mode: CreatorAlertMode,
  ): Promise<void> {
    const routes = withMode(line.routes, role, mode);
    const key = alertsQueryKey(creatorId);
    const put = (next: CreatorAlertLine): void => {
      client.setQueryData<CreatorAlertsView>(key, (old) =>
        old === undefined
          ? old
          : { ...old, alerts: old.alerts.map((each) => (each.code === next.code ? next : each)) },
      );
    };
    // Shown at once; the server's answer, or the line as it was, comes after.
    put({ ...line, routes, isDefault: false });
    setStatus(null);
    try {
      put(await saveCreatorAlert(creatorId, line.code, routes));
      setStatus({ text: `${ALERT_TEXT[line.code].title} : enregistré.`, failed: false });
    } catch (error) {
      put(line);
      setStatus({ text: ALERTS_ERRORS[alertsErrorKind(error)], failed: true });
    }
  }

  return (
    <div className="ca-page">
      <section className="nv-plate ps-panel ca-head" aria-labelledby="ca-title">
        <h3 className="nv-h3 ca-head__title" id="ca-title">
          Ses alertes
        </h3>
        <p className="ps-lead ca-head__lead">
          Qui est prévenu quand il se passe quelque chose chez {creatorName} : toi, le manager qui la suit, le
          chatteur en shift sur elle. Elle ne voit pas cet onglet.
        </p>
        <ul className="ca-legend" aria-label="Les trois choix">
          {CREATOR_ALERT_MODES.map((mode) => (
            <li key={mode} className="ca-legend__item">
              <ModeIcon mode={mode} />
              <span>
                <strong>{MODE_LABELS[mode]}</strong> : {MODE_SENTENCES[mode]}
              </span>
            </li>
          ))}
        </ul>
        <p
          className="ca-status"
          role={status?.failed === true ? 'alert' : 'status'}
          data-failed={status?.failed === true ? 'true' : undefined}
        >
          {status?.text ?? ''}
        </p>
      </section>
      {byFamily(view.alerts).map((group) => (
        <section
          key={group.family}
          className="nv-plate ps-panel ca-card"
          aria-labelledby={`ca-family-${group.family}`}
        >
          <header className="ca-card__head">
            <FamilyIcon family={group.family} />
            <h4 className="ca-card__title" id={`ca-family-${group.family}`}>
              {FAMILY_TITLES[group.family]}
            </h4>
            <div className="ca-card__roles" aria-hidden="true">
              {CREATOR_ALERT_ROLES.map((role) => (
                <span key={role}>{ROLE_LABELS[role]}</span>
              ))}
            </div>
          </header>
          <ul className="ca-lines">
            {group.lines.map((line) => (
              <AlertRow
                key={line.code}
                line={line}
                onChange={(role, mode) => {
                  void change(line, role, mode);
                }}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AlertRow({
  line,
  onChange,
}: {
  line: CreatorAlertLine;
  onChange: (role: CreatorAlertRole, mode: CreatorAlertMode) => void;
}): JSX.Element {
  const text = ALERT_TEXT[line.code];
  const nobody = !line.locked && reachesNobody(line.routes);
  return (
    <li className="ca-line" data-locked={line.locked ? 'true' : undefined}>
      <div className="ca-line__text">
        <p className="ca-line__title">{text.title}</p>
        {nobody ? (
          <p className="ca-line__nobody">
            <span className="ca-dot" aria-hidden="true" />
            Personne ne reçoit cette alerte.
          </p>
        ) : (
          <p className="ca-line__sentence">
            {line.locked ? 'Part toujours, à tout le monde, même la nuit. ' : null}
            {text.sentence}
          </p>
        )}
      </div>
      {line.locked ? (
        <p className="ca-line__always">
          <LockIcon />
          Reçoit toujours
        </p>
      ) : (
        <div className="ca-line__roles">
          {CREATOR_ALERT_ROLES.map((role) => (
            <div key={role} className="ca-role">
              <span className="ca-role__name">{ROLE_LABELS[role]}</span>
              <ModeChoice
                label={`${text.title}, ${ROLE_LABELS[role]}`}
                value={line.routes[role]}
                onChange={(mode) => {
                  onChange(role, mode);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

/** Arrow keys of the radio group and the way they move (as the appearance choice). */
const STEPS: Readonly<Record<string, 1 | -1>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Reçoit · Sourdine · Rien for one role: the design system's segmented control, icons on a computer, words on a phone. */
function ModeChoice({
  label,
  value,
  onChange,
}: {
  label: string;
  value: CreatorAlertMode;
  onChange: (mode: CreatorAlertMode) => void;
}): JSX.Element {
  const group = useRef<HTMLDivElement>(null);
  const index = CREATOR_ALERT_MODES.indexOf(value);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = STEPS[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const count = CREATOR_ALERT_MODES.length;
    const next = CREATOR_ALERT_MODES[(index + step + count) % count];
    if (next === undefined) return;
    group.current?.querySelector<HTMLButtonElement>(`[data-value="${next}"]`)?.focus();
    onChange(next);
  };
  return (
    <div
      ref={group}
      className="nv-seg ca-seg"
      role="radiogroup"
      aria-label={label}
      style={{ '--nv-seg-count': CREATOR_ALERT_MODES.length, '--nv-seg-index': index }}
      onKeyDown={onKeyDown}
    >
      <span className="nv-seg__thumb" aria-hidden="true" />
      {CREATOR_ALERT_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          className="nv-seg__opt ca-seg__opt"
          data-value={mode}
          data-tip={`${MODE_LABELS[mode]} : ${MODE_SENTENCES[mode]}`}
          aria-label={MODE_LABELS[mode]}
          aria-checked={mode === value}
          tabIndex={mode === value ? 0 : -1}
          onClick={() => {
            if (mode !== value) onChange(mode);
          }}
        >
          <ModeIcon mode={mode} />
          <span className="ca-seg__word" aria-hidden="true">
            {MODE_LABELS[mode]}
          </span>
        </button>
      ))}
    </div>
  );
}

const SVG = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

function ModeIcon({ mode }: { mode: CreatorAlertMode }): JSX.Element {
  return (
    <svg {...SVG} className={`ca-icon ca-icon--${mode}`}>
      {mode === 'off' ? (
        <path d="M6 12h12" strokeWidth={2.2} />
      ) : (
        <>
          <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
          <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
          {mode === 'deliver' ? (
            <path className="ca-icon__waves" d="M3.5 8.5a9 9 0 0 1 2-3.5M20.5 8.5a9 9 0 0 0-2-3.5" />
          ) : (
            <path d="M4 4l16 16" />
          )}
        </>
      )}
    </svg>
  );
}

function LockIcon(): JSX.Element {
  return (
    <svg {...SVG} className="ca-icon ca-icon--lock">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function FamilyIcon({ family }: { family: CreatorAlertFamily }): JSX.Element {
  return (
    <span className="ca-family-icon" aria-hidden="true">
      <svg {...SVG} className="ca-icon">
        {family === 'safety' ? (
          <>
            <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" />
            <path d="M9 12l2 2 4-4" />
          </>
        ) : family === 'sales' ? (
          <>
            <circle cx="12" cy="12" r="8" />
            <path d="M14.5 9.5a3 3 0 1 0 0 5M8.5 11h5M8.5 13h5" />
          </>
        ) : family === 'conversation' ? (
          <>
            <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H10l-4 4v-4h0.5A2.5 2.5 0 0 1 4 13.5z" />
            <path d="M8.5 10h7" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
          </>
        )}
      </svg>
    </span>
  );
}
