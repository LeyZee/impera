import {
  CREATOR_TASK_CATEGORY_LABELS,
  SUGGESTION_PAST_UNPROCESSABLE,
  type CreatorAgenda,
  type CreatorSuggestion,
} from '@impera/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type JSX } from 'react';

import { ShootBrief } from './ShootBrief';
import { acceptSuggestion, AGENDA_KEY } from './api';
import { CategoryMark } from './category';
import { undatedOf } from './model';
import { whenWords } from './words';

import { lengthOf } from '@/scheduling/time';
import { Dialog } from '@/shell/Dialog';
import '@/screens/team/team.css';

/** When a suggestion asks for, in her words; « Sans date » when it found no room in her dispos. */
function suggestedWhen(suggestion: CreatorSuggestion, zone: string): string {
  if (suggestion.when !== null) return whenWords(suggestion.when, zone);
  return suggestion.minutes === null
    ? 'Sans date, cette semaine'
    : `Sans date, cette semaine · ${lengthOf(suggestion.minutes * 60_000)}`;
}

/**
 * One of the agency's suggestions in her agenda (ADR 0042 § 4): what it is, what it is for, when. She accepts it as
 * it is, places it herself when it found no room, or says « Non merci ». She never reads where it came from beyond
 * « Proposé par l'agence ».
 */
export function SuggestionCard({
  suggestion,
  zone,
  onDecline,
  onPlace,
}: {
  suggestion: CreatorSuggestion;
  zone: string;
  onDecline: (suggestion: CreatorSuggestion) => void;
  onPlace: (suggestion: CreatorSuggestion) => void;
}): JSX.Element {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const undated = suggestion.when === null;
  const accept = (): void => {
    setBusy(true);
    setFailed(null);
    void acceptSuggestion(suggestion.id, {}).then(async (outcome) => {
      setBusy(false);
      if (outcome.kind === 'ok' || (outcome.kind === 'refused' && outcome.code.endsWith('_conflict'))) {
        await client.invalidateQueries({ queryKey: AGENDA_KEY });
        return;
      }
      setFailed(
        outcome.kind === 'failed'
          ? 'Pas de réseau : réessaie dans un moment.'
          : outcome.code === SUGGESTION_PAST_UNPROCESSABLE
            ? 'Ce moment est déjà passé : tu peux répondre « Non merci ».'
            : 'Cette proposition n’est plus là. Ton agenda est relu.',
      );
      void client.invalidateQueries({ queryKey: AGENDA_KEY });
    });
  };
  return (
    <article className="ag-proposal nv-plate" data-cat={suggestion.category}>
      <div className="ag-proposal__head">
        <CategoryMark category={suggestion.category} />
        <div className="ag-proposal__heading">
          <span className="ag-proposal__tag">Proposé par l’agence</span>
          <b className="ag-proposal__title">
            {suggestion.title}
            {suggestion.essential ? <span className="ag-ess">essentielle</span> : null}
          </b>
          <span className="ag-proposal__meta">
            {CREATOR_TASK_CATEGORY_LABELS[suggestion.category]} ·{' '}
            <span className="nv-num">{suggestedWhen(suggestion, zone)}</span>
          </span>
        </div>
      </div>
      {suggestion.purpose === null ? null : <p className="ag-proposal__purpose">{suggestion.purpose}</p>}
      {suggestion.shootBrief === null ? null : <ShootBrief brief={suggestion.shootBrief} folded />}
      {failed === null ? null : (
        <p className="ag-proposal__failed" role="alert">
          {failed}
        </p>
      )}
      <div className="ag-proposal__actions">
        {undated ? (
          <button
            type="button"
            className="nv-btn nv-btn--neon nv-btn--sm"
            onClick={() => {
              onPlace(suggestion);
            }}
          >
            Choisir un moment
          </button>
        ) : (
          <button
            type="button"
            className="nv-btn nv-btn--neon nv-btn--sm"
            disabled={busy}
            aria-busy={busy}
            onClick={accept}
          >
            Accepter
          </button>
        )}
        <button
          type="button"
          className="nv-btn nv-btn--plain nv-btn--sm"
          disabled={busy}
          onClick={() => {
            onDecline(suggestion);
          }}
        >
          Non merci
        </button>
      </div>
    </article>
  );
}

/** A suggestion touched in Semaine, opened over the grid; it closes once she has accepted it or said « Non merci ». */
export function SuggestionDialog({
  agenda,
  suggestion,
  onClose,
  onDecline,
  onPlace,
}: {
  agenda: CreatorAgenda;
  suggestion: CreatorSuggestion;
  onClose: () => void;
  onDecline: (suggestion: CreatorSuggestion) => void;
  onPlace: (suggestion: CreatorSuggestion) => void;
}): JSX.Element | null {
  const live = agenda.suggestions.find((one) => one.id === suggestion.id);
  useEffect(() => {
    if (live === undefined) onClose();
  }, [live, onClose]);
  if (live === undefined) return null;
  return (
    <Dialog title="Proposé par l’agence" lead={live.title} onClose={onClose}>
      <div className="tm-dialog__body ag-suggestion-dialog">
        <SuggestionCard suggestion={live} zone={agenda.timeZone} onDecline={onDecline} onPlace={onPlace} />
      </div>
    </Dialog>
  );
}

/**
 * « Sans date »: the agency's suggestions that found no room, which she places herself. Above her week, as a list on a
 * phone and above the grid on a computer, and above her day when it is today: wherever she looks, she can reach them.
 */
export function UndatedSuggestions({
  agenda,
  onDecline,
  onPlace,
}: {
  agenda: CreatorAgenda;
  onDecline: (suggestion: CreatorSuggestion) => void;
  onPlace: (suggestion: CreatorSuggestion) => void;
}): JSX.Element | null {
  const undated = undatedOf(agenda);
  if (undated.length === 0) return null;
  return (
    <section className="ag-sec">
      <div className="ag-sec__head">
        <h2>Sans date</h2>
        <span className="ag-count nv-num">{undated.length}</span>
      </div>
      {undated.map((suggestion) => (
        <SuggestionCard
          key={suggestion.id}
          suggestion={suggestion}
          zone={agenda.timeZone}
          onDecline={onDecline}
          onPlace={onPlace}
        />
      ))}
    </section>
  );
}
