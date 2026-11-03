import {
  newId,
  ScriptStructureIdSchema,
  SCRIPT_CARD_INKS,
  scriptCardInk,
  type ScriptColor,
  type ScriptMoment,
  type ScriptStarter,
  type ScriptStructure,
} from '@impera/contracts';
import { useBlocker } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { Workshop, type WorkshopStart } from './Workshop';
import { useStarters, useStructures } from './api';
import { emptyDraft, slotsSummary } from './model';
import './structures.css';

import { LeaveConfirm } from '@/creators/LeaveConfirm';
import '@/creators/persona/persona.css';
import { Page, PageHeader } from '@/shell/layout';

const MOMENT_LABELS: Record<ScriptMoment, string> = { day: 'Jour', night: 'Nuit', both: 'Jour et nuit' };

const gradient = (color: ScriptColor): string =>
  `linear-gradient(135deg, ${color.primary}, ${color.secondary} 55%, ${color.accent})`;

const stagesOf = (segments: ScriptStructure['current']['segments']): string => {
  const stages = segments.filter((segment) => segment.kind === 'stage');
  const slots = stages.flatMap((stage) => stage.mediaSlots);
  return `${String(stages.length)} étape${stages.length > 1 ? 's' : ''} · ${slotsSummary(slots)}`;
};

/**
 * Créatrices › Structures (SC-01 lot c), the owner's: the agency's library of script structures, the starter to copy,
 * and the workshop where a structure is written stage by stage with its card beside it. Leaving with changes not saved
 * asks first.
 */
export function StructuresPage(): JSX.Element {
  const structures = useStructures();
  const starters = useStarters();
  const [open, setOpen] = useState<WorkshopStart | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const blocker = useBlocker({
    shouldBlockFn: () => true,
    disabled: !dirty,
    enableBeforeUnload: dirty,
    withResolver: true,
  });
  const leaving = blocker.status === 'blocked' || pending !== null;

  const openStructure = (structure: ScriptStructure): void => {
    setOpen({
      id: structure.id,
      basedOnVersion: structure.current.version,
      frozen: structure.current.frozen,
      draft: {
        name: structure.current.name,
        moment: structure.current.moment,
        color: structure.current.color,
        reservedCreatorId: structure.reservedCreatorId,
        segments: structure.current.segments,
      },
    });
  };
  const copyStarter = (starter: ScriptStarter): void => {
    setOpen({
      id: newId(ScriptStructureIdSchema),
      basedOnVersion: null,
      frozen: false,
      draft: { ...starter.body, reservedCreatorId: null },
    });
  };
  const close = (): void => {
    if (dirty) {
      setPending(() => () => {
        setOpen(null);
      });
    } else setOpen(null);
  };

  const body = (): JSX.Element => {
    if (open !== null) {
      return <Workshop key={open.id} start={open} onClose={close} onDirty={setDirty} />;
    }
    if (structures.isError) {
      return (
        <section className="ps-page">
          <div className="nv-plate ps-head">
            <p className="ps-title">Les structures ne se chargent pas</p>
            <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
            <button
              type="button"
              className="nv-btn nv-btn--soft ps-self-start"
              onClick={() => void structures.refetch()}
            >
              Réessayer
            </button>
          </div>
        </section>
      );
    }
    if (structures.data === undefined) {
      return (
        <section className="ps-page" aria-busy="true">
          <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" />
        </section>
      );
    }
    return (
      <section className="ps-page">
        {structures.data.length === 0 ? (
          <p className="ps-muted">
            Aucune structure encore. Pars de la structure de départ, ou commence une structure vide.
          </p>
        ) : null}
        <ul className="sc-library">
          {structures.data.map((structure) => (
            <li key={structure.id}>
              <button
                type="button"
                className="nv-plate sc-tile"
                onClick={() => {
                  openStructure(structure);
                }}
              >
                <span
                  className="sc-tile__cover"
                  style={{
                    background: gradient(structure.current.color),
                    color: scriptCardInk(structure.current.color) ?? SCRIPT_CARD_INKS.dark,
                  }}
                >
                  <span className="sc-tile__moment">{MOMENT_LABELS[structure.current.moment]}</span>
                  <span className="sc-tile__title">{structure.current.name}</span>
                </span>
                <span className="sc-tile__body">
                  <span className="sc-tile__sub">{stagesOf(structure.current.segments)}</span>
                  <span className="sc-tile__sub">
                    {`Version ${String(structure.current.version)}${structure.current.frozen ? ' · déjà demandée' : ''}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {(starters.data ?? []).length === 0 ? null : (
          <div className="nv-plate ps-panel sc-starters">
            <p className="nv-eyebrow">Pour démarrer</p>
            {(starters.data ?? []).map((starter) => (
              <div key={starter.key} className="sc-starter">
                <span className="sc-tile__color" style={{ background: gradient(starter.body.color) }} />
                <span className="sc-starter__text">
                  <span className="sc-tile__name">{starter.body.name}</span>
                  <span className="sc-tile__sub">{starter.summary}</span>
                  <span className="sc-tile__sub">
                    {`${MOMENT_LABELS[starter.body.moment]} · ${stagesOf(starter.body.segments)}`}
                  </span>
                </span>
                <button
                  type="button"
                  className="nv-btn nv-btn--soft nv-btn--sm"
                  onClick={() => {
                    copyStarter(starter);
                  }}
                >
                  Dupliquer
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    );
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Créatrices"
        title="Structures de script"
        lead="Les étapes que tes créatrices tournent, leurs cartons et leur couleur. Une structure se tourne carton par carton."
        actions={
          open === null ? (
            <button
              type="button"
              className="nv-btn nv-btn--soft nv-btn--sm"
              onClick={() => {
                setOpen({
                  id: newId(ScriptStructureIdSchema),
                  basedOnVersion: null,
                  frozen: false,
                  draft: emptyDraft(),
                });
              }}
            >
              Nouvelle structure
            </button>
          ) : undefined
        }
      />
      <div className="ps-sheet">
        {leaving ? (
          <LeaveConfirm
            onLeave={() => {
              if (blocker.status === 'blocked') blocker.proceed();
              pending?.();
              setPending(null);
            }}
            onStay={() => {
              if (blocker.status === 'blocked') blocker.reset();
              setPending(null);
            }}
          />
        ) : null}
        {body()}
      </div>
    </Page>
  );
}
