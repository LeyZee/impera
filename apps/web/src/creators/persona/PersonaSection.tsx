import {
  PersonaV2Schema,
  type PersonaMove,
  type PersonaSheetCompletion,
  type PersonaV2,
  type PersonaVersionSummary,
} from '@impera/contracts';
import { placeTabBarLens } from '@impera/design-system';
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';

import { SaveBar, useOnScreen } from '../SaveBar';

import { CorrectionsPanel } from './CorrectionsPanel';
import { Versions } from './Versions';
import { FormContext } from './fields';
import {
  changedFields,
  draftCompletion,
  fileRefusal,
  foreignFileQuestion,
  hasChange,
  importedDraft,
  issueCountByTab,
  localDay,
  moveLabel,
  nicknameOf,
  NOTHING_REFUSED,
  panelOf,
  panelOfCorrection,
  panelTitle,
  refusedLineIssues,
  scoped,
  scopedPaths,
  stillRefused,
  TABS,
  tabOfField,
  UNREADABLE_FILE,
  validate,
  versionOnSave,
  withAnswer,
  withIssues,
  withoutPlaceholders,
  type Answer,
  type Draft,
  type FieldIssue,
  type PanelKey,
  type RefusedLines,
  type TabId,
} from './model';
import { SheetPanels } from './sheet';
import { activateVersion, readPersonaFile, saveVersion, usePersona, type PersonaReady } from './source';
import { AgentBehaviorTab, FollowUpsTab, NotificationsTab, RulesTab, StrategiesTab } from './tabs';

import { fullDay } from '@/scheduling/time';
import { PasswordPrompt } from '@/settings/services/PasswordPrompt';
import { Dialog } from '@/shell/Dialog';
import './persona.css';

/**
 * Créatrices › Persona (ADR 0079): her sheet as Desirali asks it, seven panels that fold, then « Réglages de
 * l'agent », what the code applies, versioned with it. What dominates is the state of the draft and its one action,
 * saving a new version; a version stored at format 1 opens converted, and says what it moved.
 */
export function PersonaSection({
  creatorId,
  canSave,
  isOwner = false,
  readsCorrections = false,
  timezone,
  creatorName = null,
  onDirty = ignore,
}: {
  /** Null while no creator is known: the example shows, nothing can be saved. */
  creatorId: string | null;
  /** The owner and the creator herself save versions; chatters read. */
  canSave: boolean;
  /** Only the owner reaches Heures d'activité and Réglages: the others read where a setting lives, without a link. */
  isOwner?: boolean;
  /** The owner and an active manager read the corrections she proposed (CREA-01 b); the owner marks them handled. */
  readsCorrections?: boolean;
  timezone: string | null;
  /** Her name in Impera, which a persona not written yet takes as its nickname. */
  creatorName?: string | null;
  /** Told whether the draft holds changes not saved, so that leaving the page can ask first. Must be stable. */
  onDirty?: (dirty: boolean) => void;
}): JSX.Element {
  const { load, reload } = usePersona(creatorId, creatorName);
  /** Said once a save went through, until the next edit. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Kept here, so that a save, which starts the editor again from the new version, stays on the same tab. */
  const [tab, setTab] = useState<TabId>('sheet');
  /** The panels unfolded, kept across a save for the same reason; her identity first, as at Desirali. */
  const [open, setOpen] = useState<ReadonlySet<PanelKey>>(() => new Set<PanelKey>(['identity']));

  if (load.kind !== 'ready') {
    return (
      <section className="ps-page" aria-busy={load.kind === 'loading'}>
        {load.kind === 'failed' ? (
          <div className="nv-plate ps-head">
            <p className="ps-title">La persona ne se charge pas</p>
            <p className="ps-muted">Le serveur ne répond pas. Réessaie dans un instant.</p>
            <button type="button" className="nv-btn nv-btn--soft ps-self-start" onClick={reload}>
              Réessayer
            </button>
          </div>
        ) : (
          <>
            <div className="nv-plate ps-head ps-skeleton" />
            <div className="nv-plate ps-panel ps-skeleton ps-skeleton--tall" />
          </>
        )}
      </section>
    );
  }
  return (
    <Editor
      key={load.basedOn ?? 'example'}
      ready={load}
      creatorId={creatorId}
      canSave={canSave}
      isOwner={isOwner}
      readsCorrections={readsCorrections}
      creatorName={creatorName}
      timezone={timezone}
      notice={notice}
      tab={tab}
      onTab={setTab}
      open={open}
      onOpen={setOpen}
      onDirty={onDirty}
      onEdit={() => {
        setNotice(null);
      }}
      onSaved={(version) => {
        setNotice(`Version ${version.version} enregistrée, pas encore active`);
        reload();
      }}
      onActivated={(version) => {
        setNotice(`Version ${version} marquée active`);
        reload();
      }}
      onReload={reload}
    />
  );
}

const ignore = (): void => undefined;

const SAVE_FAILED =
  'L’enregistrement n’a pas abouti. Tes changements restent ici ; réessaie dans un instant.';
const CONFLICT =
  'Une autre version a été enregistrée pendant que tu modifiais. Recharge pour repartir de la dernière : tes modifications ici seront perdues.';

const ACTIVATION_CONFLICT =
  'Sa version active a changé depuis l’ouverture de cette page, sans doute dans un autre onglet. Rien n’a été activé : recharge pour voir où elle en est.';

/** A version stored before a guard changed: its typical responses teach what the agent may no longer write. */
const activationRefused = (version: string): string =>
  `La version ${version} n’est pas activée : une de ses réponses typiques contient ce que l’agent n’a plus le droit d’écrire. Corrige-la dans une nouvelle version.`;

const READ_ONLY = 'Lecture seule : seuls le propriétaire et la créatrice modifient sa persona.';

/** What the conversion of a format-1 version, or of a file, put in a nearby question (ADR 0079 § 5). */
interface Moved {
  readonly moves: readonly PersonaMove[];
  /** The file it came from; null for her stored version. */
  readonly file: string | null;
}

function Editor({
  ready,
  creatorId,
  canSave,
  isOwner,
  readsCorrections,
  creatorName,
  timezone,
  notice,
  tab,
  onTab,
  open,
  onOpen,
  onDirty,
  onEdit,
  onSaved,
  onActivated,
  onReload,
}: {
  ready: PersonaReady;
  creatorId: string | null;
  canSave: boolean;
  isOwner: boolean;
  readsCorrections: boolean;
  creatorName: string | null;
  timezone: string | null;
  notice: string | null;
  tab: TabId;
  onTab: (tab: TabId) => void;
  open: ReadonlySet<PanelKey>;
  onOpen: (open: ReadonlySet<PanelKey>) => void;
  onDirty: (dirty: boolean) => void;
  onEdit: () => void;
  onSaved: (version: PersonaVersionSummary) => void;
  onActivated: (version: string) => void;
  onReload: () => void;
}): JSX.Element {
  const saved: Draft = ready.persona;
  const [draft, setDraft] = useState<Draft>(saved);
  const [saving, setSaving] = useState(false);
  /**
   * The version being activated, in its dialog; `password` once the server asked the password and the code again (a
   * sign-in over 10 minutes old): the same dialog asks them, then activates it.
   */
  const [activating, setActivating] = useState<{
    readonly version: PersonaVersionSummary;
    readonly password: boolean;
  } | null>(null);
  /** Why the last save did not go through, and whether reloading is the way out. */
  const [problem, setProblem] = useState<{ text: string; reload: boolean } | null>(null);
  /** Which way the panel slides in: towards the tab picked, like a page turning. */
  const [direction, setDirection] = useState<'left' | 'right' | 'none'>('none');
  /** A field to bring into view once its tab and its panel are on screen (« Voir »). */
  const [focusField, setFocusField] = useState<string | null>(null);
  /** The lines of « Réponses typiques » the server refused at the last save (422), until that text changes. */
  const [refused, setRefused] = useState<RefusedLines>(NOTHING_REFUSED);
  /** The name of the file the draft was imported from (« Importer un fichier »), until it is saved or undone. */
  const [imported, setImported] = useState<string | null>(null);
  /** What a conversion moved: her format-1 version as opened, or the file imported. */
  const [moved, setMoved] = useState<Moved>({ moves: ready.moved, file: null });
  /** A file read as another creator's, waiting for « L’importer quand même » (PRO-27). */
  const [foreign, setForeign] = useState<{
    persona: PersonaV2;
    moves: readonly PersonaMove[];
    name: string;
    question: string;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  // Checked on the date the save will write (`localDay()`), never the draft's older one: a creator who came of age since
  // the last version is not refused on screen while the server takes her (recette PRO-04).
  const issues = useMemo(
    () => [
      ...validate({ ...draft, meta: { ...draft.meta, created_at: localDay() } }),
      ...stillRefused(refused, draft),
    ],
    [draft, refused],
  );
  const completion = useMemo(() => withIssues(draftCompletion(draft), issues), [draft, issues]);
  const changed = useMemo(() => changedFields(saved, draft), [saved, draft]);
  // A persona never written, nothing typed yet: what is still to fill reads as a step, not as faults in amber (CREA-13).
  const quiet = ready.source === 'example' && changed.length === 0;
  const flagged = useMemo(() => (quiet ? [] : issues), [quiet, issues]);
  const form = useMemo(() => ({ issues: flagged, changed }), [flagged, changed]);
  const agentForm = useMemo(
    () => ({ issues: scoped(flagged, 'agent'), changed: scopedPaths(changed, 'agent') }),
    [flagged, changed],
  );
  /** Her newest version is at format 1: saving it as it opens stores it at format 2 (ADR 0079 § 5). */
  const converted = ready.source === 'api' && ready.format === 1;

  const dirty = changed.length > 0;
  /** The number the next save gives: shown before it is made, by the note and after an import. */
  const upcoming = versionOnSave(
    draft.meta.version,
    ready.versions.map((v) => v.version),
    imported !== null,
  );
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(
    () => () => {
      onDirty(false);
    },
    [onDirty],
  );

  const select = (next: TabId): void => {
    if (next === tab) return;
    const at = (id: TabId): number => TABS.findIndex((t) => t.id === id);
    setDirection(at(next) > at(tab) ? 'right' : 'left');
    onTab(next);
  };
  const openPanel = (panel: PanelKey): void => {
    if (!open.has(panel)) onOpen(new Set([...open, panel]));
  };
  const toggle = (panel: PanelKey): void => {
    const next = new Set(open);
    if (next.has(panel)) next.delete(panel);
    else next.add(panel);
    onOpen(next);
  };

  useEffect(() => {
    if (focusField === null) return;
    // The field whose path holds the issue: `agent.behavior.pet_names.1` is shown by `behavior.pet_names` in the
    // agent's tab, whose fields go by their path without `agent.`.
    const local = focusField.startsWith('agent.') ? focusField.slice('agent.'.length) : focusField;
    const target = [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-path]') ?? [])].find((el) => {
      const path = el.dataset['path'] ?? '';
      return local === path || local.startsWith(`${path}.`);
    });
    const place =
      target ?? panelRef.current?.querySelector<HTMLElement>(`[data-panel="${panelOf(focusField) ?? ''}"]`);
    if (place !== undefined && place !== null) {
      place.closest('details')?.setAttribute('open', '');
      place.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const control =
        target?.querySelector<HTMLElement>('input, textarea') ?? target?.querySelector<HTMLElement>('button');
      control?.focus({ preventScroll: true });
    }
    setFocusField(null);
  }, [focusField, tab, open]);

  const change = (next: (current: Draft) => Draft): void => {
    setDraft(next);
    setProblem(null);
    onEdit();
  };
  const setAgent = <K extends keyof PersonaV2['agent']>(key: K, value: PersonaV2['agent'][K]): void => {
    change((current) => ({ ...current, agent: { ...current.agent, [key]: value } }));
  };
  const agentProps = <K extends keyof PersonaV2['agent']>(key: K) => ({
    value: draft.agent[key],
    onChange: (value: PersonaV2['agent'][K]) => {
      setAgent(key, value);
    },
    issues: agentForm.issues,
  });

  const save = async (): Promise<void> => {
    if (creatorId === null) return;
    setSaving(true);
    setProblem(null);
    // The new number does not go through `validate`: a refusal here is a failed save, never a throw.
    const persona = PersonaV2Schema.safeParse(
      withoutPlaceholders({
        ...draft,
        meta: { ...draft.meta, schema: 2, version: upcoming, created_at: localDay() },
      }),
    );
    const result = persona.success
      ? await saveVersion(creatorId, persona.data, ready.basedOn).catch(() => ({ kind: 'failed' as const }))
      : { kind: 'failed' as const };
    setSaving(false);
    switch (result.kind) {
      case 'saved':
        onSaved(result.version);
        break;
      case 'conflict':
        setProblem({ text: CONFLICT, reload: true });
        break;
      case 'unprocessable': {
        const text = textOrNull(draft.sheet.conversation['typical_responses']);
        const issues = refusedLineIssues(result.faults, text);
        if (issues.length > 0) setRefused({ issues, text });
        else setProblem({ text: SAVE_FAILED, reload: false });
        break;
      }
      case 'forbidden':
        setProblem({
          text: 'Seuls le propriétaire et la créatrice peuvent enregistrer sa persona.',
          reload: false,
        });
        break;
      case 'failed':
        setProblem({ text: SAVE_FAILED, reload: false });
        break;
    }
  };

  /**
   * « Importer un fichier »: a persona file written outside Impera (ADR 0010: never in the repository) replaces the
   * draft, field by field, as if typed. A file at format 1 is converted first (ADR 0079 § 5). Nothing is stored until
   * « Enregistrer une version », and a version saved is never active until it is activated.
   */
  const importFile = async (file: File): Promise<void> => {
    if (creatorId === null) return;
    const read = await readPersonaFile(file).catch(() => ({ kind: 'unreadable' as const }));
    if (read.kind !== 'persona') {
      setProblem({
        text: read.kind === 'invalid' ? fileRefusal(read.issues, read.format) : UNREADABLE_FILE,
        reload: false,
      });
      return;
    }
    setProblem(null);
    // Another creator's file is asked about first, never put in her draft unseen (recette 05/11, PRO-27).
    const question = foreignFileQuestion(read.persona, draft, creatorId);
    if (question === null) take(read.persona, read.moved, file.name);
    else setForeign({ persona: read.persona, moves: read.moved, name: file.name, question });
  };
  const take = (persona: PersonaV2, moves: readonly PersonaMove[], name: string): void => {
    if (creatorId === null) return;
    setForeign(null);
    setDraft(importedDraft(persona, creatorId));
    setImported(name);
    setMoved({ moves, file: name });
    setRefused(NOTHING_REFUSED);
    onEdit();
  };

  /** Her newest version from the head, or an older one put back in service from « Ses versions » (AGT-07). */
  const ask = (version: PersonaVersionSummary | undefined): void => {
    if (version === undefined) return;
    setProblem(null);
    setActivating({ version, password: false });
  };
  const activate = async (version: PersonaVersionSummary): Promise<void> => {
    if (creatorId === null) return;
    setSaving(true);
    setProblem(null);
    // The active version this page read: if another tab activated one since, the server refuses.
    const expectedActive = ready.versions.find((v) => v.isActive)?.id ?? null;
    const result = await activateVersion(creatorId, version.id, expectedActive).catch(
      () => 'failed' as const,
    );
    setSaving(false);
    if (result === 'reauth') {
      setActivating({ version, password: true });
      return;
    }
    setActivating(null);
    if (result === 'activated') onActivated(version.version);
    else if (result === 'conflict') setProblem({ text: ACTIVATION_CONFLICT, reload: true });
    else if (result === 'refused') setProblem({ text: activationRefused(version.version), reload: false });
    else {
      setProblem({
        text:
          result === 'forbidden'
            ? 'Seul le propriétaire choisit la version avec laquelle l’agent écrit.'
            : 'Rien n’a été activé : Impera ne répond pas. Réessaie dans un instant.',
        reload: false,
      });
    }
  };

  const blocked = !canSave
    ? READ_ONLY
    : creatorId === null
      ? 'Ajoute d’abord une créatrice pour enregistrer sa persona.'
      : issues.length > 0
        ? 'Corrige d’abord les champs signalés.'
        : changed.length === 0 && !converted
          ? 'Rien à enregistrer pour l’instant.'
          : null;
  const reset = (): void => {
    setDraft(saved);
    setProblem(null);
    setRefused(NOTHING_REFUSED);
    setImported(null);
    setMoved({ moves: ready.moved, file: null });
  };
  /** A field: its tab, its panel unfolded, then the field brought into view and focused. */
  const show = (field: string): void => {
    select(tabOfField(field));
    const panel = panelOf(field);
    if (panel !== undefined) openPanel(panel);
    setFocusField(field);
  };
  const headOnScreen = useOnScreen(headRef);

  return (
    <FormContext.Provider value={form}>
      <section className="ps-page">
        <Head
          headRef={headRef}
          draft={draft}
          ready={ready}
          known={creatorId !== null}
          readOnly={!canSave}
          issues={issues}
          quiet={quiet}
          converted={converted}
          completion={completion}
          changes={changed.length}
          saving={saving}
          blocked={blocked}
          canActivate={canSave && changed.length === 0 && ready.versions[0]?.isActive === false}
          canImport={canSave && creatorId !== null && changed.length === 0}
          imported={changed.length > 0 ? imported : null}
          moved={moved}
          upcoming={upcoming}
          notice={notice}
          problem={problem}
          onSave={() => {
            void save();
          }}
          onActivate={() => {
            ask(ready.versions[0]);
          }}
          onReload={onReload}
          onReset={reset}
          onImport={(file) => {
            void importFile(file);
          }}
          onShowPanel={(panel) => {
            show(`sheet.${panel}`);
          }}
          onShow={show}
        />
        {foreign === null ? null : (
          <div className="nv-confirm" role="alertdialog" aria-labelledby="ps-foreign-text">
            <p id="ps-foreign-text">
              <b>{foreign.question}</b> Rien ne change tant que tu ne l’enregistres pas.
            </p>
            <div className="nv-confirm__actions">
              <button
                type="button"
                className="nv-btn nv-btn--soft"
                onClick={() => {
                  take(foreign.persona, foreign.moves, foreign.name);
                }}
              >
                L’importer quand même
              </button>
              <button
                type="button"
                className="nv-btn nv-btn--soft"
                onClick={() => {
                  setForeign(null);
                }}
              >
                Annuler
              </button>
            </div>
          </div>
        )}
        {ready.source === 'api' ? (
          <Versions versions={ready.versions} canActivate={canSave} busy={saving} onActivate={ask} />
        ) : null}
        {activating === null ? null : (
          <ActivationDialog
            version={activating.version.version}
            active={ready.versions.find((v) => v.isActive)?.version ?? null}
            password={activating.password}
            busy={saving}
            onActivate={() => {
              void activate(activating.version);
            }}
            onCancel={() => {
              setActivating(null);
            }}
          />
        )}
        {creatorId !== null && readsCorrections ? (
          <CorrectionsPanel
            creatorId={creatorId}
            creatorName={creatorName}
            canMark={isOwner}
            onShowSection={(section) => {
              show(`sheet.${panelOfCorrection(section)}`);
            }}
          />
        ) : null}

        <Tabs
          active={tab}
          errors={issueCountByTab(flagged)}
          edited={(id) => hasChange(changed, id)}
          onSelect={select}
        />

        <div
          className="ps-tabpanel"
          role="tabpanel"
          id={`ps-panel-${tab}`}
          aria-labelledby={`ps-tab-${tab}`}
          data-direction={direction}
          ref={panelRef}
          key={tab}
        >
          {/* A chatter reads her persona: every field shows, none takes a change. */}
          <fieldset className="ps-fieldset" disabled={!canSave}>
            {tab === 'sheet' ? (
              <SheetPanels
                sheet={draft.sheet}
                onAnswer={(panel, key, value) => {
                  change((current) => ({ ...current, sheet: withAnswer(current.sheet, panel, key, value) }));
                }}
                open={open}
                onToggle={toggle}
                timezone={timezone}
                isOwner={isOwner}
              />
            ) : (
              <FormContext.Provider value={agentForm}>
                <div className="nv-plate ps-panel">
                  <p className="ps-lead ps-agent-lead">
                    Ce que le code applique pour elle, versionné avec sa fiche : l’agent le respecte à la
                    lettre, quoi qu’il écrive.
                  </p>
                  <StrategiesTab {...agentProps('strategies')} />
                  <FollowUpsTab {...agentProps('follow_ups')} />
                  <NotificationsTab {...agentProps('notifications')} isOwner={isOwner} />
                  <AgentBehaviorTab {...agentProps('behavior')} />
                  <RulesTab {...agentProps('rules')} />
                </div>
              </FormContext.Provider>
            )}
          </fieldset>
        </div>
        <SaveBar
          show={canSave && changed.length > 0 && !headOnScreen}
          warn={issues.length > 0}
          text={
            issues.length > 0
              ? `${plural(issues.length, 'champ', 'champs')} à corriger`
              : plural(changed.length, 'modification', 'modifications')
          }
          saveLabel="Enregistrer une version"
          saving={saving}
          blocked={blocked}
          onReset={reset}
          onSave={() => {
            void save();
          }}
        />
      </section>
    </FormContext.Provider>
  );
}

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n > 1 ? many : one}`;

/**
 * « Activer la version N » opens this dialog, never a second click on the same button that a hurried hand misses
 * (recette persona Messa 06/11: an activation thought done had sent nothing). It says what changes for her fans, then
 * « Activer » sends it. On a sign-in over 10 minutes old (audit de sécurité du 02/11, M1) the same dialog asks the
 * password and the code, as « Passer en Automatique », and activates once they are confirmed.
 */
function ActivationDialog({
  version,
  active,
  password,
  busy,
  onActivate,
  onCancel,
}: {
  version: string;
  /** Her active version now, which this one replaces; null while none is. */
  active: string | null;
  password: boolean;
  busy: boolean;
  onActivate: () => void;
  onCancel: () => void;
}): JSX.Element {
  const [checking, setChecking] = useState(false);
  const instead = active === null ? '' : `, à la place de la version ${active}`;
  return (
    <Dialog
      title={`Activer la version ${version}`}
      lead={
        password
          ? `L’agent écrira avec elle à tous ses fans${instead}. Pour l’activer, confirme ton mot de passe et ton code.`
          : active === null
            ? 'L’agent écrira avec elle à tous ses fans : aucun message ne part pour elle avant cette activation.'
            : `L’agent écrira avec elle à tous ses fans${instead}. Tu pourras revenir à l’autre dans «\u00a0Ses versions\u00a0».`
      }
      busy={busy || checking}
      onClose={onCancel}
    >
      {password ? (
        <PasswordPrompt
          layout="dialog"
          lead={null}
          onConfirmed={onActivate}
          onCancel={onCancel}
          onBusyChange={setChecking}
        />
      ) : (
        <div className="tm-dialog__body">
          <div className="tm-dialog__foot">
            <button type="button" className="nv-btn nv-btn--plain" disabled={busy} onClick={onCancel}>
              Annuler
            </button>
            <button
              type="button"
              className="nv-btn nv-btn--neon"
              data-autofocus
              disabled={busy}
              aria-busy={busy}
              onClick={onActivate}
            >
              {busy ? 'Activation…' : 'Activer'}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

/** What the note under the head says: where this persona comes from and what a save does. */
function noteOf(ready: PersonaReady, known: boolean, upcoming: string): string {
  if (!known) return 'Ceci est un exemple : tu peux tout modifier pour essayer, rien ne sera enregistré.';
  if (ready.source === 'example') {
    return `Pars de cet exemple ou importe un fichier : ton premier enregistrement deviendra sa version ${upcoming}.`;
  }
  const active = ready.versions.find((v) => v.isActive);
  // The agent reads her active version at each draft; without one he writes nothing (recette 28/10, G4).
  return `Chaque enregistrement crée une nouvelle version, inactive, et tu actives la nouvelle quand elle est prête. ${
    active === undefined
      ? 'Aucune version n’est active pour l’instant : l’agent n’écrit rien pour elle, et aucun message ne peut partir avant l’activation d’une version.'
      : `Version active\u00a0: ${active.version}. C’est avec elle que l’agent écrit ses brouillons.`
  }`;
}

/**
 * The first thing read: whose persona, which version, what waits in the draft, and the one action. A line says the
 * state only when it has something to say (CREA-05): changes, fields to fix, a save done, a problem.
 */
function Head({
  headRef,
  draft,
  ready,
  known,
  readOnly,
  issues,
  quiet,
  converted,
  completion,
  changes,
  saving,
  blocked,
  canActivate,
  canImport,
  imported,
  moved,
  upcoming,
  notice,
  problem,
  onSave,
  onActivate,
  onReload,
  onReset,
  onImport,
  onShow,
  onShowPanel,
}: {
  headRef: RefObject<HTMLDivElement | null>;
  draft: Draft;
  ready: PersonaReady;
  known: boolean;
  /** Nothing can change here (a chatter): the state says so instead of what is still to fix. */
  readOnly: boolean;
  issues: readonly FieldIssue[];
  /** Her first version, nothing typed yet: what is missing is a step to take, not a fault (CREA-13). */
  quiet: boolean;
  /** Her newest version was stored at format 1 and opens converted: saving it stores it at format 2. */
  converted: boolean;
  completion: PersonaSheetCompletion;
  changes: number;
  saving: boolean;
  /** Why saving is not possible now, or null when it is. */
  blocked: string | null;
  /** Her newest version is stored, unchanged here and not yet the one the agent writes with. */
  canActivate: boolean;
  /** Nothing waits in the draft, and it can be saved: a file may replace it. */
  canImport: boolean;
  /** The file the draft comes from, while its import waits to be saved. */
  imported: string | null;
  moved: Moved;
  /** The number the next save gives. */
  upcoming: string;
  notice: string | null;
  problem: { text: string; reload: boolean } | null;
  onSave: () => void;
  onActivate: () => void;
  onReload: () => void;
  onReset: () => void;
  onImport: (file: File) => void;
  onShow: (field: string) => void;
  onShowPanel: (panel: PanelKey) => void;
}): JSX.Element {
  const name = nicknameOf(draft);
  const fileRef = useRef<HTMLInputElement>(null);
  const first = issues[0];
  const current = ready.versions[0];
  const state =
    problem !== null
      ? { dot: 'warn', text: problem.text }
      : readOnly
        ? { dot: 'idle', text: READ_ONLY }
        : first !== undefined
          ? quiet
            ? {
                dot: 'idle',
                text: `${plural(issues.length, 'champ', 'champs')} à remplir avant d’enregistrer`,
              }
            : { dot: 'warn', text: `${plural(issues.length, 'champ', 'champs')} à corriger` }
          : changes > 0
            ? blocked === null
              ? {
                  dot: 'ok',
                  text: `${plural(changes, 'modification', 'modifications')}, prête à enregistrer`,
                }
              : { dot: 'idle', text: `${plural(changes, 'modification', 'modifications')} : ${blocked}` }
            : notice !== null
              ? { dot: 'ok', text: notice }
              : null;
  const created = fullDay(ready.persona.meta.created_at);
  // What moved is said while it matters: her format-1 version not yet saved again, or a file not yet saved.
  const showMoves =
    moved.moves.length > 0 && (moved.file === null ? converted : imported !== null && changes > 0);

  return (
    <div className="nv-plate ps-head" ref={headRef}>
      <div className="ps-head__top">
        <div className="ps-head__who">
          <h2 className="ps-title" data-placeholder={name === '' ? 'true' : undefined}>
            {name === '' ? 'Surnom à remplir' : name}
          </h2>
          <p className="ps-head__meta">
            {/* The example's own number and date are not hers: nothing is stored yet. */}
            {ready.source === 'example' ? (
              <span className="nv-tag nv-tag--inferred ps-example">Jamais enregistrée</span>
            ) : (
              <>
                <span
                  className="nv-tag nv-tag--declared"
                  data-active={current?.isActive === true ? 'true' : undefined}
                >
                  {current?.isActive === true ? 'Active' : 'Pas encore active'}
                </span>
                {/* Her newest stored version: an imported draft carries its own number and date until saved. */}
                <span>Version {ready.persona.meta.version}</span>
                <span aria-hidden="true">·</span>
                <span>{created}</span>
              </>
            )}
          </p>
        </div>
        <div className="ps-head__actions">
          {canImport && !saving ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".yaml,.yml"
                hidden
                aria-label="Fichier de persona"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Emptied, so that the same file picked again after a fix is read again.
                  event.target.value = '';
                  if (file !== undefined) onImport(file);
                }}
              />
              <button
                type="button"
                className="nv-btn nv-btn--plain nv-btn--sm ps-pop"
                title="Un fichier YAML de persona remplace ce qui est à l’écran, à relire avant d’enregistrer."
                onClick={() => {
                  fileRef.current?.click();
                }}
              >
                Importer un fichier
              </button>
            </>
          ) : null}
          {changes > 0 && !saving ? (
            <button type="button" className="nv-btn nv-btn--plain nv-btn--sm ps-pop" onClick={onReset}>
              Tout annuler
            </button>
          ) : null}
          {canActivate ? (
            <button
              type="button"
              className="nv-btn nv-btn--soft ps-pop"
              disabled={saving}
              title="Elle devient sa version active, à la place de la précédente."
              onClick={onActivate}
            >
              {`Activer la version ${draft.meta.version}`}
            </button>
          ) : null}
          <button
            type="button"
            className="nv-btn nv-btn--neon"
            disabled={blocked !== null || saving}
            title={blocked ?? undefined}
            aria-describedby="ps-save-note"
            aria-busy={saving}
            onClick={onSave}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer une version'}
          </button>
        </div>
      </div>
      <div className="ps-head__state" aria-live="polite">
        {state === null ? null : (
          <>
            <span className="ps-dot" data-dot={state.dot} />
            <span className="ps-head__text" key={state.text}>
              {state.text}
            </span>
          </>
        )}
        {problem?.reload === true ? (
          <button type="button" className="nv-btn nv-btn--plain nv-btn--sm ps-pop" onClick={onReload}>
            Recharger
          </button>
        ) : first !== undefined && problem === null && !readOnly ? (
          <button
            type="button"
            className="nv-btn nv-btn--plain nv-btn--sm ps-pop"
            onClick={() => {
              onShow(first.field);
            }}
          >
            Voir le premier
          </button>
        ) : null}
      </div>
      {imported === null ? null : (
        <p className="ps-muted ps-pop">
          Importé de « {imported} » : relis chaque panneau avant d’enregistrer. Ce sera la version {upcoming},
          inactive jusqu’à ce que tu l’actives.
        </p>
      )}
      {showMoves ? <Moves moved={moved} upcoming={upcoming} onShow={onShow} /> : null}
      <Completion completion={completion} onShowPanel={onShowPanel} />
      <p className="ps-muted" id="ps-save-note">
        {noteOf(ready, known, upcoming)}
      </p>
    </div>
  );
}

/**
 * What a conversion to the new sheet put in a nearby question (ADR 0079 § 5): nothing is lost in silence. Folded
 * behind one line, each move opens its field.
 */
function Moves({
  moved,
  upcoming,
  onShow,
}: {
  moved: Moved;
  upcoming: string;
  onShow: (field: string) => void;
}): JSX.Element {
  const count = moved.moves.length;
  const placed = plural(count, 'réponse a été placée', 'réponses ont été placées');
  // « Relis-les » never splits at its hyphen, its colon never starts a line.
  const reread = <span className="ps-nowrap">Relis-les</span>;
  const lead =
    moved.file === null ? (
      <>
        Sa dernière version suit l’ancienne fiche. Elle s’ouvre ici dans la nouvelle, et {placed} dans la
        question la plus proche. {reread}
        {`\u00a0: enregistrer en fait la version ${upcoming}.`}
      </>
    ) : (
      <>
        {`Ce fichier suit l’ancienne fiche\u00a0: ${placed} dans la question la plus proche. `}
        {reread} avant d’enregistrer.
      </>
    );
  return (
    <details className="nv-disclosure ps-moves">
      <summary>
        <span className="nv-disclosure__title">Passage à la nouvelle fiche</span>
        <span className="nv-disclosure__sum">{plural(count, 'réponse déplacée', 'réponses déplacées')}</span>
      </summary>
      <div className="nv-disclosure__body ps-moves__body">
        <p className="ps-muted">{lead}</p>
        <ul className="ps-moves__list">
          {moved.moves.map((move, index) => (
            <li key={`${move.from}-${String(index)}`}>
              <button
                type="button"
                className="ps-completion__block"
                onClick={() => {
                  onShow(`sheet.${move.to.section}.${move.to.key}`);
                }}
              >
                {moveLabel(move)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * How much of her sheet is answered, out of 59 (ADR 0079 § 6): the percent in ink beside a neutral gauge, on one line,
 * then the panels with questions left, each opening its place. Nothing is required but three answers: it says what is
 * missing, never that a save is blocked, and says nothing more once all is answered.
 */
function Completion({
  completion: { percent, answered, total, missing },
  onShowPanel,
}: {
  completion: PersonaSheetCompletion;
  onShowPanel: (panel: PanelKey) => void;
}): JSX.Element {
  return (
    <div className="ps-completion">
      <p className="ps-completion__line">
        <span className="ps-completion__label">Complète à</span>
        <span className="ps-completion__percent">{percent} %</span>
        <span
          className="nv-gauge ps-completion__gauge"
          role="progressbar"
          aria-label="Complétude de la fiche"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-valuetext={`${String(answered)} questions sur ${String(total)}`}
          style={{ '--nv-gauge-value': `${String(percent)}%` }}
        >
          <span className="nv-gauge__fill" />
        </span>
        <span className="ps-completion__count">
          {answered} sur {total}
        </span>
      </p>
      {missing.length === 0 ? null : (
        <p className="ps-completion__missing">
          <span className="ps-muted">{'À compléter\u00a0:'}</span>
          {missing.map(({ section, left }, index) => (
            <Fragment key={section}>
              {/* The space between two panels is where the line may break; each keeps its comma. */}{' '}
              <span>
                <button
                  type="button"
                  className="ps-completion__block"
                  onClick={() => {
                    onShowPanel(section);
                  }}
                >
                  {panelTitle(section)} ({left})
                </button>
                {index < missing.length - 1 ? ',' : null}
              </span>
            </Fragment>
          ))}
        </p>
      )}
    </div>
  );
}

/**
 * Two tabs: her sheet and the agent's settings (ADR 0079 § 4). Each counts in amber what is left to fix in it, and a
 * dot says it holds changes.
 */
function Tabs({
  active,
  errors,
  edited,
  onSelect,
}: {
  active: TabId;
  errors: Record<TabId, number>;
  edited: (tab: TabId) => boolean;
  onSelect: (tab: TabId) => void;
}): JSX.Element {
  const navRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const item = nav?.querySelector('[aria-selected="true"]');
    if (nav === null || !(item instanceof HTMLElement)) return;
    placeTabBarLens(nav, item, placed.current ? (thumbRef.current ?? undefined) : undefined);
    placed.current = true;
  }, [active]);

  return (
    <div className="ps-tabs">
      <div className="nv-subnav ps-tabs__bar" role="tablist" aria-label="Sections de la persona" ref={navRef}>
        <span className="nv-subnav__thumb" ref={thumbRef} aria-hidden="true" />
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`ps-tab-${tab.id}`}
            data-tab={tab.id}
            aria-controls={`ps-panel-${tab.id}`}
            aria-selected={tab.id === active}
            className="nv-subnav__item ps-tabs__item"
            onClick={() => {
              onSelect(tab.id);
            }}
          >
            {tab.label}
            {errors[tab.id] > 0 ? (
              <span className="nv-subnav__count" aria-label={`${String(errors[tab.id])} à corriger`}>
                {errors[tab.id]}
              </span>
            ) : edited(tab.id) ? (
              <span className="ps-changed ps-changed--on" aria-label="modifié" />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}

const textOrNull = (answer: Answer | undefined): string | null =>
  typeof answer === 'string' ? answer : null;
