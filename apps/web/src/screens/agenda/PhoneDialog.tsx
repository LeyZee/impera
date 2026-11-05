import { useState, type JSX } from 'react';

import { CalendarLinkBody, type CalendarLinkWords } from '@/scheduling/CalendarLinkBody';
import { chooseCalendarShifts, useCalendarLink, useRefreshPlanning } from '@/scheduling/api';
import { Dialog } from '@/shell/Dialog';

/** Her words (CR-05 lot c2): her agenda, and what stays in Impera. */
const AGENDA_LINK_WORDS: CalendarLinkWords = {
  intro:
    'Ajoute ton agenda au calendrier de ton téléphone : il s’y met à jour tout seul. Le Calendrier d’Apple le relit à peu près toutes les heures ; Google Agenda peut mettre jusqu’à une journée. Tes tâches à heures et celles d’un jour y vont, avec leur titre et à quoi elles servent. Tes routines et tes fiches de tournage restent ici. Tu pourras y ajouter qui répond à tes fans.',
  made: 'Garde-le pour toi : quiconque l’a voit ton agenda.',
  stopped: 'Le calendrier où tu l’as ajouté ne recevra plus ton agenda.',
};

/**
 * « Dans mon téléphone » (CR-05 lot c2, ADR 0042 § 4): her agenda in the calendar of her phone, through her secret,
 * read-only link, on the same table as the team's (ADR 0045 § 5). Never synchronised back: what she changes there
 * stays there.
 */
export function PhoneDialog({ onClose }: { onClose: () => void }): JSX.Element {
  // Shown once: while her address is on the screen, neither Échap nor a tap beside closes it, only « C’est fait ».
  const [shown, setShown] = useState(false);
  return (
    <Dialog
      title="Mon agenda dans mon téléphone"
      lead="iPhone, Mac, Google Agenda"
      busy={shown}
      onClose={onClose}
    >
      <div className="ag-phone">
        <CalendarLinkBody words={AGENDA_LINK_WORDS} onShown={setShown} />
        <ShiftsChoice />
      </div>
    </Dialog>
  );
}

/**
 * « Qui répond à tes fans » in her phone too (ADR 0045 § 5): her accounts' shifts, by the name in the team, added to
 * her link when she chooses it, and kept when she makes a new address. Shown once her link exists.
 */
function ShiftsChoice(): JSX.Element | null {
  const state = useCalendarLink();
  const refresh = useRefreshPlanning();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const live = state.data?.link ?? null;
  if (live === null) return null;
  return (
    <>
      <label className="nv-notif__row ag-phone__shifts">
        <span className="nv-notif__label">
          <strong>Qui répond à tes fans</strong>
          <span className="nv-notif__hint">
            Les shifts de tes comptes, avec le prénom de qui répond. Rien d’autre de l’équipe.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          className="nv-switch"
          checked={live.withShifts}
          disabled={busy}
          aria-label={`Qui répond à tes fans dans ton téléphone : ${live.withShifts ? 'ajouté' : 'non ajouté'}`}
          onChange={(event) => {
            const on = event.target.checked;
            setBusy(true);
            setFailed(false);
            void chooseCalendarShifts(on).then(async (outcome) => {
              setBusy(false);
              if (outcome.kind !== 'ok') setFailed(true);
              await refresh();
            });
          }}
        />
      </label>
      {failed ? (
        <p role="alert" className="text-sm text-[var(--nv-warning)]">
          Ton choix n’a pas pu être gardé. Réessaie dans un instant.
        </p>
      ) : null}
    </>
  );
}
