import { NotificationPreferencesSchema, type NotificationPreferences } from '@impera/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type JSX } from 'react';

import {
  PUSH_KEY_URL,
  pushState,
  readServerKey,
  turnOffPush,
  turnOnPush,
  type PushState,
  type TurnOnOutcome,
} from './push';

import { TimeField, useUnreadableTimes } from '@/scheduling/TimeField';
import { clockOf } from '@/scheduling/time';
import { Page, PageHeader, Panel, PanelSection } from '@/shell/layout';

/**
 * /notifications (CR-01): for every role, from the account's menu. This device: on or off, and a test. The account:
 * quiet hours and the daily cap, which the server applies to every device (ADR 0042 § 7).
 */

const PREFERENCES_URL = '/v1/notifications/preferences';
const preferencesQuery = {
  queryKey: ['notifications', 'preferences'],
  queryFn: async (): Promise<NotificationPreferences> => {
    const response = await fetch(PREFERENCES_URL, { credentials: 'include' });
    if (!response.ok) throw new Error(`preferences_${String(response.status)}`);
    return NotificationPreferencesSchema.parse(await response.json());
  },
} as const;

const DEFAULT_QUIET = { startMinute: 22 * 60, endMinute: 8 * 60 } as const;
const QUIET_OFF = { startMinute: 0, endMinute: 0 } as const;
const EMPTY_RANGE = 'Une plage doit commencer et finir à des heures différentes.';

const STATE_WORDS: Readonly<Record<PushState, string>> = {
  on: 'Cet appareil reçoit les notifications d’Impera.',
  off: 'Les notifications sont coupées sur cet appareil.',
  denied:
    'Les notifications d’Impera sont refusées sur cet appareil. Pour les rouvrir : réglages du téléphone ou du navigateur, puis Impera, puis Notifications.',
  needs_install: 'Sur iPhone, les notifications n’arrivent que dans Impera installée sur l’écran d’accueil.',
  unsupported: 'Ce navigateur ne reçoit pas de notifications.',
};

const FAILURE_WORDS: Readonly<Record<Exclude<TurnOnOutcome, 'on'>, string>> = {
  denied: 'Refusé : rien ne sonnera sur cet appareil.',
  failed: 'L’activation n’a pas abouti. Réessaie dans un instant.',
  needs_install: STATE_WORDS.needs_install,
  unsupported: STATE_WORDS.unsupported,
};

function ThisDevice(): JSX.Element {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Read before the touch on « Activer », so that the question leaves at once (iOS, see push.ts).
  const serverKey = useQuery({
    queryKey: [PUSH_KEY_URL],
    queryFn: readServerKey,
    enabled: state === 'off',
    staleTime: Infinity,
  });
  const key = serverKey.data;

  useEffect(() => {
    let live = true;
    void pushState().then((read) => {
      if (live) setState(read);
    });
    return () => {
      live = false;
    };
  }, []);

  const act = async (work: () => Promise<string | null>): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      setNote(await work());
      setState(await pushState());
    } finally {
      setBusy(false);
    }
  };

  const test = async (): Promise<string> => {
    const response = await fetch('/v1/notifications/test', { method: 'POST', credentials: 'include' });
    if (response.status === 404) return 'Aucun appareil abonné sur ce compte : active d’abord.';
    return response.ok ? 'Envoyée : elle arrive dans quelques secondes.' : 'L’envoi n’a pas abouti.';
  };

  return (
    <Panel title="Cet appareil">
      <PanelSection className="nv-notif__device">
        <p className="nv-notif__state" data-state={state ?? 'reading'}>
          {state === null ? 'Lecture…' : STATE_WORDS[state]}
        </p>
        <div className="nv-notif__actions">
          {state === 'off' ? (
            <button
              type="button"
              className="nv-btn nv-btn--neon"
              disabled={busy || key === undefined}
              onClick={() => {
                if (key === undefined) return;
                void act(async () => {
                  const outcome = await turnOnPush(key);
                  return outcome === 'on' ? null : FAILURE_WORDS[outcome];
                });
              }}
            >
              Activer les notifications
            </button>
          ) : null}
          {state === 'on' ? (
            <>
              <button
                type="button"
                className="nv-btn nv-btn--neon"
                disabled={busy}
                onClick={() => {
                  void act(test);
                }}
              >
                Envoyer un test
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--plain"
                disabled={busy}
                onClick={() => {
                  void act(async () => {
                    await turnOffPush();
                    return null;
                  });
                }}
              >
                Couper sur cet appareil
              </button>
            </>
          ) : null}
          {state === 'needs_install' ? (
            <Link to="/aide/installer" className="nv-btn nv-btn--neon">
              Installer Impera
            </Link>
          ) : null}
        </div>
        {note === null ? null : (
          <p className="nv-notif__note" role="status">
            {note}
          </p>
        )}
        {state === 'off' && serverKey.isError ? (
          <p className="nv-notif__note" role="status">
            Impera ne répond pas pour l’instant : rouvre cette page dans un instant pour activer.
          </p>
        ) : null}
      </PanelSection>
    </Panel>
  );
}

function QuietHours({ saved }: { saved: NotificationPreferences }): JSX.Element {
  const client = useQueryClient();
  const [draft, setDraft] = useState(saved);
  // Its own switch (recette 05/11, PRO-01): start equal to end while an hour is typed is a range to correct, never
  // quiet hours switched off under the user's fingers. Off is written as start = end only when it is saved.
  const [quietOn, setQuietOn] = useState(saved.quietHours.startMinute !== saved.quietHours.endMinute);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const { unreadable, onUnreadable } = useUnreadableTimes();
  const emptyRange = quietOn && draft.quietHours.startMinute === draft.quietHours.endMinute;
  const toSave: NotificationPreferences = quietOn ? draft : { ...draft, quietHours: QUIET_OFF };
  const changed = JSON.stringify(toSave) !== JSON.stringify(saved);

  const save = async (): Promise<void> => {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(PREFERENCES_URL, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(NotificationPreferencesSchema.parse(toSave)),
      });
      if (!response.ok) {
        setNote('Pas enregistré. Réessaie dans un instant.');
        return;
      }
      client.setQueryData(
        preferencesQuery.queryKey,
        NotificationPreferencesSchema.parse(await response.json()),
      );
      setNote('Enregistré.');
    } finally {
      setBusy(false);
    }
  };

  const setCap = (dailyCap: number): void => {
    setDraft({ ...draft, dailyCap: Math.min(30, Math.max(1, dailyCap)) });
  };

  return (
    <Panel title="Quand ça sonne">
      <PanelSection>
        <label className="nv-notif__row">
          <span className="nv-notif__label">
            <strong>Heures calmes</strong>
            <span className="nv-notif__hint">
              Rien ne sonne. Un récapitulatif t’attend à la fin. Le début de ton propre shift sonne quand
              même.
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            className="nv-switch"
            checked={quietOn}
            aria-label={`Heures calmes : ${quietOn ? 'actives' : 'coupées'}`}
            onChange={(event) => {
              setQuietOn(event.target.checked);
              // Back on after a save that switched them off: the usual night, rather than an empty range.
              if (event.target.checked && draft.quietHours.startMinute === draft.quietHours.endMinute) {
                setDraft({ ...draft, quietHours: DEFAULT_QUIET });
              }
            }}
          />
        </label>
        {quietOn ? (
          <div className="nv-notif__hours">
            <span className="nv-notif__hint">De</span>
            <TimeField
              value={draft.quietHours.startMinute}
              label="Début des heures calmes"
              onChange={(startMinute) => {
                setDraft({ ...draft, quietHours: { ...draft.quietHours, startMinute } });
              }}
              onUnreadable={onUnreadable}
            />
            {/* « à 08:00 le lendemain » stays together, and goes to the next line as one piece. */}
            <span className="nv-notif__end">
              <span className="nv-notif__hint">à</span>
              <TimeField
                value={draft.quietHours.endMinute}
                label="Fin des heures calmes"
                onChange={(endMinute) => {
                  setDraft({ ...draft, quietHours: { ...draft.quietHours, endMinute } });
                }}
                onUnreadable={onUnreadable}
              />
              {draft.quietHours.endMinute < draft.quietHours.startMinute ? (
                <span className="nv-notif__hint">le lendemain</span>
              ) : null}
            </span>
            {emptyRange ? (
              <p className="nv-notif__error" role="alert">
                {EMPTY_RANGE}
              </p>
            ) : null}
          </div>
        ) : null}
      </PanelSection>
      <PanelSection>
        <div className="nv-notif__row">
          <span className="nv-notif__label">
            <strong>Au plus par jour</strong>
            <span className="nv-notif__hint">
              Rappels, routine, équipe. Les ventes et le début de ton shift ne comptent pas.
            </span>
          </span>
          <div className="nv-notif__stepper" role="group" aria-label="Notifications au plus par jour">
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              aria-label="Une de moins"
              disabled={draft.dailyCap <= 1}
              onClick={() => {
                setCap(draft.dailyCap - 1);
              }}
            >
              −
            </button>
            <output className="nv-num" aria-live="polite">
              {draft.dailyCap}
            </output>
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              aria-label="Une de plus"
              disabled={draft.dailyCap >= 30}
              onClick={() => {
                setCap(draft.dailyCap + 1);
              }}
            >
              +
            </button>
          </div>
        </div>
      </PanelSection>
      <PanelSection className="nv-notif__save">
        {note === null ? (
          <span className="nv-notif__hint">
            {quietOn
              ? `Calme de ${clockOf(draft.quietHours.startMinute)} à ${clockOf(draft.quietHours.endMinute)}, à ton heure.`
              : 'Sans heures calmes, tout sonne à toute heure.'}
          </span>
        ) : (
          <span className="nv-notif__hint" role="status">
            {note}
          </span>
        )}
        <button
          type="button"
          className="nv-btn nv-btn--neon"
          disabled={!changed || unreadable || emptyRange || busy}
          onClick={() => {
            void save();
          }}
        >
          Enregistrer
        </button>
      </PanelSection>
    </Panel>
  );
}

export function NotificationsPage(): JSX.Element {
  const preferences = useQuery(preferencesQuery);
  return (
    <Page>
      <PageHeader title="Notifications" lead="Ce qui sonne sur tes appareils, et quand ça se tait." />
      <div className="nv-notif">
        <ThisDevice />
        {preferences.data === undefined ? (
          <Panel title="Quand ça sonne">
            <PanelSection>
              <p className="nv-notif__hint">
                {preferences.isError ? 'Réglages illisibles pour l’instant.' : 'Lecture…'}
              </p>
            </PanelSection>
          </Panel>
        ) : (
          <QuietHours key={JSON.stringify(preferences.data)} saved={preferences.data} />
        )}
      </div>
    </Page>
  );
}
