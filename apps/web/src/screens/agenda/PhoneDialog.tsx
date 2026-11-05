import { useState, type JSX } from 'react';

import { CalendarLinkBody, type CalendarLinkWords } from '@/scheduling/CalendarLinkBody';
import { Dialog } from '@/shell/Dialog';

/** Her words (CR-05 lot c2): her agenda, and what stays in Impera. */
const AGENDA_LINK_WORDS: CalendarLinkWords = {
  intro:
    'Ajoute ton agenda au calendrier de ton téléphone : il s’y met à jour tout seul. Le Calendrier d’Apple le relit à peu près toutes les heures ; Google Agenda peut mettre jusqu’à une journée. Tes tâches à heures et celles d’un jour y vont, avec leur titre et à quoi elles servent. Tes routines et tes fiches de tournage restent ici.',
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
      </div>
    </Dialog>
  );
}
