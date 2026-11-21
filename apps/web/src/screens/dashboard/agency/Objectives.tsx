import type { AgencyInsights } from '@impera/contracts';
import { useState, type JSX } from 'react';

import { ObjectiveNotSaved, useSetObjective } from './api';
import { monthLabel } from './period';
import { shareOf } from './view';

import { eurosInput, parseEuros } from '@/settings/billing/model';

type Objectives = NonNullable<AgencyInsights['objectives']>;
type Row = Objectives['creators'][number];

/** « 2 698 € »: the card's figures in whole euros, the same rule for what is done and what is aimed at. */
export function wholeEuros(cents: number): string {
  return `${Math.round(cents / 100).toLocaleString('fr-FR')}\u00a0€`;
}

/** An objective as the owner typed it: whole euros, or its cents when it has some, never rounded up (PRO1-17). */
export function objectiveEuros(cents: number): string {
  if (cents % 100 === 0) return wholeEuros(cents);
  return `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\u00a0€`;
}

/** « environ 5 060 € »: a projection is no reading, so it is said to ten euros (Design, 20/11). */
export function aboutEuros(cents: number): string {
  return `environ ${(Math.round(cents / 1000) * 10).toLocaleString('fr-FR')}\u00a0€`;
}

/** A shortfall: rounded like a projection, but never « environ 0 € » when it is a few euros. */
function gapEuros(cents: number): string {
  return cents < 500 ? 'moins de 10\u00a0€' : aboutEuros(cents);
}

/**
 * How a row stands against its objective (ADR 0092 § 6): on its way or short at this pace, reached or missed once the
 * month is over; nothing to say without an objective.
 */
export function objectiveVerdict(
  row: Pick<Row, 'objectiveMinor' | 'revenueMinor' | 'projectedMinor'>,
): { readonly tone: 'up' | 'down'; readonly text: string } | null {
  if (row.objectiveMinor === null) return null;
  if (row.projectedMinor === null) {
    return row.revenueMinor >= row.objectiveMinor
      ? { tone: 'up', text: 'Objectif atteint' }
      : { tone: 'down', text: `Manqué de ${wholeEuros(row.objectiveMinor - row.revenueMinor)}` };
  }
  return row.projectedMinor >= row.objectiveMinor
    ? { tone: 'up', text: `À ce rythme : ${aboutEuros(row.projectedMinor)} à la fin du mois` }
    : {
        tone: 'down',
        text: `À ce rythme : ${aboutEuros(row.projectedMinor)}, il manquerait ${gapEuros(row.objectiveMinor - row.projectedMinor)}`,
      };
}

const PENCIL = (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
);

/** One line: whose, how far along, and where the pace leads; the owner sets or changes the objective in place. */
function ObjectiveRow({
  name,
  row,
  month,
  pace,
  canEdit,
  reserve,
  lead = false,
}: {
  name: string;
  row: Pick<Row, 'objectiveMinor' | 'revenueMinor' | 'projectedMinor'> & {
    readonly creatorId: string | null;
  };
  month: string;
  /** Where the month stands, from 0 to 100; null once it is over. */
  pace: number | null;
  canEdit: boolean;
  /** Whether the card has edit buttons: a line without one keeps their room, so the figures line up. */
  reserve: boolean;
  lead?: boolean;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const save = useSetObjective();
  const verdict = objectiveVerdict(row);
  const done = row.objectiveMinor === null ? 0 : shareOf(row.revenueMinor, row.objectiveMinor);
  const amount = parseEuros(text);
  const creatorId = row.creatorId;
  const editable = canEdit && creatorId !== null;
  const monthName = monthLabel(month).split(' ')[0]?.toLowerCase() ?? '';
  const open = (): void => {
    setText(row.objectiveMinor === null ? '' : eurosInput(row.objectiveMinor));
    setEditing(true);
  };
  return (
    <li className="ins-goal" data-lead={lead ? '' : undefined}>
      <div className="ins-goal__head">
        <span className="ins-goal__name">{name}</span>
        <span className="ins-goal__figures">
          <b>{wholeEuros(row.revenueMinor)}</b>
          {row.objectiveMinor === null ? null : <> sur {objectiveEuros(row.objectiveMinor)}</>}
          {reserve && !(editable && !editing) ? (
            <span
              className="nv-btn nv-btn--plain nv-btn--sm ins-goal__edit ins-goal__edit-slot"
              aria-hidden="true"
            >
              {PENCIL}
            </span>
          ) : null}
          {editable && !editing ? (
            row.objectiveMinor === null ? (
              <button type="button" className="nv-btn nv-btn--plain nv-btn--sm" onClick={open}>
                Fixer un objectif
              </button>
            ) : (
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm ins-goal__edit"
                aria-label={`Modifier l’objectif de ${name}`}
                title="Modifier l’objectif"
                onClick={open}
              >
                {PENCIL}
              </button>
            )
          ) : null}
        </span>
      </div>
      {row.objectiveMinor === null ? null : (
        <span
          className="ins-goal__track"
          role="img"
          aria-label={
            pace === null
              ? `${String(done)} % de l’objectif`
              : `${String(done)} % de l’objectif, ${String(pace)} % du mois passé`
          }
        >
          <span className="ins-meter">
            <span style={{ '--_w': `${String(Math.min(100, done))}%` }} />
          </span>
          {/* Where the month stands: ahead of it or behind, at a glance, whatever the colour (Design, 20/11). */}
          {pace === null ? null : <i className="ins-goal__pace" style={{ '--_p': `${String(pace)}%` }} />}
        </span>
      )}
      {verdict === null ? (
        <span className="ins-goal__none">Pas d’objectif</span>
      ) : (
        <span className="ins-goal__verdict" data-tone={verdict.tone}>
          {verdict.text}
        </span>
      )}
      {editable && editing ? (
        <form
          className="ins-goal__form"
          onSubmit={(event) => {
            event.preventDefault();
            if (amount === null) return;
            save.mutate(
              { creatorId, month, amountMinor: amount },
              {
                onSuccess: () => {
                  setEditing(false);
                },
              },
            );
          }}
        >
          <label className="ins-goal__label">
            <span>Objectif de {monthName}, en euros</span>
            <span className="ins-goal__field">
              <input
                className="nv-field__control nv-glass nv-num"
                inputMode="decimal"
                autoComplete="off"
                // The field the owner just asked for.
                autoFocus
                aria-invalid={text.trim() !== '' && amount === null}
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                }}
              />
              <span className="ins-goal__suffix" aria-hidden="true">
                €
              </span>
            </span>
          </label>
          <span className="ins-goal__actions">
            <button
              type="submit"
              className="nv-btn nv-btn--neon nv-btn--sm"
              disabled={amount === null || save.isPending}
            >
              Enregistrer
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm"
              onClick={() => {
                setEditing(false);
                save.reset();
              }}
            >
              Annuler
            </button>
          </span>
          {row.objectiveMinor === null ? null : (
            <button
              type="button"
              className="nv-btn nv-btn--plain nv-btn--sm ins-goal__remove"
              disabled={save.isPending}
              onClick={() => {
                save.mutate(
                  { creatorId, month, amountMinor: null },
                  {
                    onSuccess: () => {
                      setEditing(false);
                    },
                  },
                );
              }}
            >
              Retirer l’objectif
            </button>
          )}
          {save.error instanceof ObjectiveNotSaved ? (
            <p className="ins-goal__error" role="alert">
              {save.error.message}
            </p>
          ) : null}
        </form>
      ) : null}
    </li>
  );
}

/** « Novembre 2026 · jour 16 sur 30 · interne à l’agence »: the card's subtitle, the month's day in it. */
export function objectivesSub(objectives: Objectives): string {
  const day =
    objectives.daysGone >= objectives.days
      ? 'mois terminé'
      : `jour ${String(objectives.daysGone)} sur ${String(objectives.days)}`;
  return `${monthLabel(objectives.month)} · ${day} · interne à l’agence`;
}

/**
 * « Objectifs du mois » (ADR 0092 § 6): the agency's objective, the sum of those set, big and first, then each
 * creator's, with how far along, where the month stands and where the pace leads. The owner sets them here; a manager
 * reads them. Never shown to a creator: her account never reads the agency's figures.
 */
export function ObjectivesCard({
  insights,
  objectives,
  canEdit,
}: {
  insights: AgencyInsights;
  objectives: Objectives;
  canEdit: boolean;
}): JSX.Element {
  const names = new Map(insights.creators.map((one) => [one.creatorId, one.name] as const));
  const several = objectives.creators.length > 1;
  const pace =
    objectives.daysGone >= objectives.days ? null : Math.round((objectives.daysGone / objectives.days) * 100);
  return (
    <div className="nv-plate ins-goals">
      <ul className="ins-goals__list">
        {several ? (
          <ObjectiveRow
            name="L’agence"
            lead
            month={objectives.month}
            pace={pace}
            canEdit={false}
            reserve={canEdit}
            row={{
              creatorId: null,
              objectiveMinor: objectives.objectiveMinor,
              revenueMinor: objectives.revenueMinor,
              projectedMinor: objectives.projectedMinor,
            }}
          />
        ) : null}
        {objectives.creators.map((row) => (
          <ObjectiveRow
            key={row.creatorId}
            name={names.get(row.creatorId) ?? 'Créatrice'}
            month={objectives.month}
            pace={pace}
            canEdit={canEdit}
            reserve={canEdit}
            row={row}
          />
        ))}
      </ul>
      {several ? <p className="ins-goals__note">L’objectif de l’agence est la somme de ceux fixés.</p> : null}
    </div>
  );
}
