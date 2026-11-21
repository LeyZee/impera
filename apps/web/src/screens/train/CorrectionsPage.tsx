import {
  DRAFT_CORRECTION_REASON_LABELS,
  DRAFT_CORRECTIONS_DAYS,
  type DraftCorrection,
  type DraftCorrectionReason,
} from '@impera/contracts';
import { Link } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { correctionsError, useDraftCorrections } from './corrections/api';
import { correctionsHeadline, REASON_COLOURS, wordDiff, type DiffPart } from './corrections/model';

import { useCreators } from '@/creators/api';
import { Select } from '@/shell/Select';
import { Donut, useLit } from '@/shell/figures/figures';
import { Empty, Failure, Skeleton, SkeletonCard } from '@/shell/states';

import './corrections/corrections.css';

/**
 * Entraîner › Corrections (trou béant 12, recette du 21/11): the drafts a human refused or retouched in her real
 * conversations, by reason, what the agent wrote beside what left. The owner's alone (ADR 0092 § 8). Read only: what
 * to change goes through the Playground and her persona. One creator at a time: the one the menu's selector is set on
 * (ADR 0134 § 3), or on « Toutes » the one picked here, as Trafic does.
 */
export function CorrectionsPage({
  scoped = null,
}: {
  /** The creator the menu's selector is set on, or null on « Toutes »: the page then asks which one. */
  scoped?: string | null;
}): JSX.Element {
  const creators = useCreators();
  const [picked, setPicked] = useState<string | null>(null);
  const list = creators.data ?? [];
  const creatorId = scoped ?? picked ?? list[0]?.id ?? null;

  if (creators.isPending)
    return (
      <Skeleton>
        <SkeletonCard lines={4} />
      </Skeleton>
    );
  if (creators.isError)
    return (
      <Failure
        onRetry={() => {
          void creators.refetch();
        }}
      />
    );
  if (creatorId === null)
    return (
      <Empty plate title="Aucune créatrice pour l’instant">
        Ses brouillons corrigés arrivent ici dès qu’une créatrice est ajoutée dans Créatrices.
      </Empty>
    );
  return (
    <div className="co-page">
      {scoped === null && list.length > 1 ? (
        <div className="co-creator">
          <Select<string>
            ariaLabel="Créatrice"
            value={creatorId}
            options={list.map((one) => ({ value: one.id, label: one.displayName }))}
            onChange={setPicked}
          />
        </div>
      ) : null}
      <CreatorCorrections
        key={creatorId}
        creatorId={creatorId}
        name={list.find((one) => one.id === creatorId)?.displayName ?? null}
      />
    </div>
  );
}

function CreatorCorrections({ creatorId, name }: { creatorId: string; name: string | null }): JSX.Element {
  const corrections = useDraftCorrections(creatorId);
  const [reason, setReason] = useState<DraftCorrectionReason | null>(null);
  const { lit, setLit, row } = useLit();

  if (corrections.isPending)
    return (
      <Skeleton>
        <SkeletonCard lines={4} />
      </Skeleton>
    );
  if (corrections.isError) return <p className="co-state">{correctionsError(corrections.error)}</p>;
  const view = corrections.data;
  if (view.items.length === 0) {
    return (
      <Empty
        plate
        title={`Aucun brouillon refusé ni retouché depuis ${String(DRAFT_CORRECTIONS_DAYS)} jours`}
      >
        Chaque brouillon refusé ou retouché dans le Suivi ou le panneau copilote arrive ici, avec sa raison.
      </Empty>
    );
  }
  const colourOf = (one: DraftCorrectionReason): string => REASON_COLOURS[one];
  const shown = reason === null ? view.items : view.items.filter((item) => item.reason === reason);
  const litCount = lit === null ? undefined : view.counts[lit];
  return (
    <>
      {/* The answer first, in big, then the reasons as a ring that answers the pointer (Charles's screen rule). */}
      <section className="nv-plate nv-plate--pad co-top" aria-label="En bref">
        <div className="co-top__answer">
          <p className="co-headline">{correctionsHeadline(view)}</p>
          <p className="co-lead">
            {`Les ${String(DRAFT_CORRECTIONS_DAYS)} derniers jours${name === null ? '' : ` de ${name}`}`}
            {view.truncated ? `, les ${String(view.items.length)} plus récentes` : ''}.
          </p>
        </div>
        <Donut
          label={`Par raison : ${view.counts
            .map((one) => `${DRAFT_CORRECTION_REASON_LABELS[one.reason]} ${String(one.count)}`)
            .join(', ')}`}
          slices={view.counts.map((one) => ({
            key: one.reason,
            colour: colourOf(one.reason),
            value: one.count,
          }))}
          lit={lit}
          onLit={setLit}
        >
          {litCount === undefined ? (
            <>
              <b className="nv-donut__value nv-num">{String(view.items.length)}</b>
              <span className="nv-donut__sub">corrections</span>
            </>
          ) : (
            <>
              <b className="nv-donut__value nv-num">{String(litCount.count)}</b>
              <span className="nv-donut__sub">{DRAFT_CORRECTION_REASON_LABELS[litCount.reason]}</span>
            </>
          )}
        </Donut>
      </section>
      <div className="co-reasons" role="group" aria-label="Raisons">
        <button
          type="button"
          className="nv-chip"
          aria-pressed={reason === null}
          onClick={() => {
            setReason(null);
          }}
        >
          Toutes · {String(view.items.length)}
        </button>
        {view.counts.map((one, index) => {
          const lighting = row(index);
          return (
            <button
              key={one.reason}
              type="button"
              className={lit === index ? 'nv-chip co-chip is-on' : 'nv-chip co-chip'}
              aria-pressed={reason === one.reason}
              onPointerEnter={lighting.onPointerEnter}
              onPointerLeave={lighting.onPointerLeave}
              onFocus={lighting.onFocus}
              onBlur={lighting.onBlur}
              onClick={() => {
                setReason(reason === one.reason ? null : one.reason);
              }}
            >
              <span className="nv-key" style={{ '--_c': colourOf(one.reason) }} aria-hidden="true" />
              {DRAFT_CORRECTION_REASON_LABELS[one.reason]} · {String(one.count)}
            </button>
          );
        })}
      </div>
      <ul className="co-list">
        {shown.map((item) => (
          <CorrectionCard
            key={`${item.draftId}-${item.kind}`}
            creatorId={creatorId}
            item={item}
            colour={colourOf(item.reason)}
          />
        ))}
      </ul>
    </>
  );
}

const WHEN = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * One draft. A retouch: what the agent wrote beside what left, the words it changed lit on each side (Design 21/11:
 * that is the information). A refusal: « Refusé » and the agent's text full width, nothing left to set beside it.
 */
function CorrectionCard({
  creatorId,
  item,
  colour,
}: {
  creatorId: string;
  item: DraftCorrection;
  colour: string;
}): JSX.Element {
  const diff = item.kind === 'edited' && item.after !== null ? wordDiff(item.before, item.after) : null;
  return (
    <li className="nv-plate nv-plate--pad co-card" style={{ '--_c': colour }}>
      <div className="co-card__head">
        <span className="co-card__reason">
          <span className="nv-key" aria-hidden="true" />
          {DRAFT_CORRECTION_REASON_LABELS[item.reason]}
          {item.kind === 'rejected' ? <span className="co-pill">Refusé</span> : null}
        </span>
        <span className="co-card__meta">
          <Link to="/suivi" search={{ conversation: item.conversationId, creatrice: creatorId }}>
            {item.fanDisplayName === '' ? 'Sa conversation' : item.fanDisplayName}
          </Link>
          {' · '}
          {WHEN.format(new Date(item.at))}
        </span>
      </div>
      {item.note === null ? null : <p className="co-card__note">« {item.note} »</p>}
      {diff === null ? (
        <section className="co-side" aria-label="Avant">
          <h3 className="nv-eyebrow co-side__title">L’agent avait écrit</h3>
          {item.before.map((bubble, index) => (
            <p key={index} className="co-side__bubble">
              {bubble}
            </p>
          ))}
        </section>
      ) : (
        <div className="co-card__sides">
          <section className="co-side" aria-label="Avant">
            <h3 className="nv-eyebrow co-side__title">L’agent avait écrit</h3>
            <p className="co-side__bubble">
              <Parts parts={diff.before} mark="del" />
            </p>
          </section>
          <section className="co-side" aria-label="Après">
            <h3 className="nv-eyebrow co-side__title">Parti à la place</h3>
            <p className="co-side__bubble">
              <Parts parts={diff.after} mark="ins" />
            </p>
          </section>
        </div>
      )}
    </li>
  );
}

/** A side of a retouch, the words it changed marked: taken out before, put in after. */
function Parts({ parts, mark }: { parts: readonly DiffPart[]; mark: 'del' | 'ins' }): JSX.Element {
  return (
    <>
      {parts.map((one, index) =>
        !one.changed ? (
          <span key={index}>{one.text}</span>
        ) : mark === 'del' ? (
          <del key={index} className="co-diff co-diff--out">
            {one.text}
          </del>
        ) : (
          <ins key={index} className="co-diff co-diff--in">
            {one.text}
          </ins>
        ),
      )}
    </>
  );
}
