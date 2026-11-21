import {
  newId,
  ScriptStructureIdSchema,
  SCRIPT_CARD_INKS,
  scriptCardInk,
  type ScriptMoment,
  type ScriptStarter,
  type ScriptStructure,
} from '@impera/contracts';
import { Link, useBlocker } from '@tanstack/react-router';
import { useState, type JSX } from 'react';

import { Queues } from './Queues';
import { Workshop, type WorkshopStart } from './Workshop';
import { useStarters, useStructures } from './api';
import { emptyDraft, scriptGradient, stackSummary } from './model';
import './structures.css';

import { LeaveConfirm } from '@/creators/LeaveConfirm';
import { useCreators } from '@/creators/api';
import { Segment } from '@/creators/persona/fields';
import '@/creators/persona/persona.css';
import { Page, PageHeader } from '@/shell/layout';
import { Failure } from '@/shell/states';

const MOMENT_LABELS: Record<ScriptMoment, string> = { day: 'Jour', night: 'Nuit', both: 'Jour et nuit' };

/**
 * Créatrices › Structures (SC-01 lot c), the owner's: the agency's library of script structures, the starter to copy,
 * and the workshop where a structure is written stage by stage with its card beside it. Leaving with changes not saved
 * asks first.
 */
export function StructuresPage(): JSX.Element {
  return <Structures embedded={false} />;
}

/**
 * The same library as a view of a creator's sheet (Scripts › Structures, ADR 0149 § 1): no page nor header of its own,
 * « Nouvelle structure » above the library.
 */
export function StructuresView(): JSX.Element {
  return <Structures embedded />;
}

function Structures({ embedded }: { embedded: boolean }): JSX.Element {
  const structures = useStructures();
  const starters = useStarters();
  const creators = useCreators();
  const [tab, setTab] = useState<'library' | 'queues'>('library');
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

  const create = (): void => {
    setOpen({
      id: newId(ScriptStructureIdSchema),
      basedOnVersion: null,
      frozen: false,
      draft: emptyDraft(),
    });
  };

  const body = (): JSX.Element => {
    if (open !== null) {
      return <Workshop key={open.id} start={open} onClose={close} onDirty={setDirty} />;
    }
    if (structures.isError) {
      return (
        <section className="ps-page">
          <Failure onRetry={() => void structures.refetch()} />
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
    // Inside a creator's sheet the two views and « Nouvelle structure » share one row, under the tab's own selector.
    const tabs = (
      <div className={embedded ? 'st-tabs st-tabs--embedded' : 'st-tabs'}>
        <Segment
          label="Vue des structures"
          value={tab}
          options={[
            { value: 'library', label: 'Bibliothèque' },
            { value: 'queues', label: 'Files des créatrices' },
          ]}
          onChange={setTab}
        />
        {embedded ? (
          <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={create}>
            Nouvelle structure
          </button>
        ) : null}
      </div>
    );
    if (tab === 'queues') {
      return (
        <section className="ps-page">
          {tabs}
          {creators.isError ? (
            <div className="nv-plate ps-panel">
              <p className="ps-muted">Les créatrices ne se chargent pas. Réessaie dans un instant.</p>
            </div>
          ) : creators.data === undefined ? (
            <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" aria-busy="true" />
          ) : (
            <Queues creators={creators.data} structures={structures.data} />
          )}
        </section>
      );
    }
    return (
      <section className="ps-page">
        {tabs}
        {structures.data.length === 0 ? (
          <p className="ps-muted">
            Aucune structure encore. Pars de la structure de départ, ou commence une structure vide.
          </p>
        ) : null}
        <ul className="st-library">
          {structures.data.map((structure) => (
            <li key={structure.id}>
              <button
                type="button"
                className="nv-plate st-tile"
                onClick={() => {
                  openStructure(structure);
                }}
              >
                <span
                  className="st-tile__cover"
                  style={{
                    background: scriptGradient(structure.current.color),
                    color: scriptCardInk(structure.current.color) ?? SCRIPT_CARD_INKS.dark,
                  }}
                >
                  <span className="st-tile__moment">{MOMENT_LABELS[structure.current.moment]}</span>
                  <span className="st-tile__title">{structure.current.name}</span>
                </span>
                <span className="st-tile__body">
                  <span className="st-tile__sub">{stackSummary(structure.current.segments)}</span>
                  <span className="st-tile__sub">
                    {`Version ${String(structure.current.version)}${structure.current.frozen ? ' · déjà demandée' : ''}`}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {(starters.data ?? []).length === 0 ? null : (
          <div className="nv-plate ps-panel st-starters">
            <p className="nv-eyebrow">Pour démarrer</p>
            {(starters.data ?? []).map((starter) => (
              <div key={starter.key} className="st-starter">
                <span className="st-tile__color" style={{ background: scriptGradient(starter.body.color) }} />
                <span className="st-starter__text">
                  <span className="st-tile__name">{starter.body.name}</span>
                  <span className="st-tile__sub">{starter.summary}</span>
                  <span className="st-tile__sub">
                    {`${MOMENT_LABELS[starter.body.moment]} · ${stackSummary(starter.body.segments)}`}
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

  const sheet = (
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
  );
  if (embedded) return sheet;

  return (
    <Page>
      <PageHeader
        // The way back to the list, as on a creator's sheet: the same eyebrow on every screen of Créatrices (COH-01).
        eyebrow={
          <Link to="/creatrices" className="nv-btn nv-btn--plain nv-btn--sm">
            ← Créatrices
          </Link>
        }
        title="Structures de script"
        lead="Les étapes que tes créatrices tournent, leurs cartons et leur couleur. Une structure se tourne carton par carton."
        actions={
          open === null ? (
            <button type="button" className="nv-btn nv-btn--soft nv-btn--sm" onClick={create}>
              Nouvelle structure
            </button>
          ) : undefined
        }
      />
      {sheet}
    </Page>
  );
}
