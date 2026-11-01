import {
  PersonaSchema,
  type Persona,
  type PersonaCompletion,
  type PersonaVersionSummary,
} from '@nirvana/contracts';
import { placeTabBarLens } from '@nirvana/design-system';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from 'react';

import { SaveBar, useOnScreen } from '../SaveBar';

import {
  InDepthTab,
  IntimateTab,
  LifestyleTab,
  SampleRepliesTab,
  TastesTab,
  WritingStyleTab,
} from './blocks';
import { FormContext } from './fields';
import {
  blockOf,
  changedFields,
  draftCompletion,
  withIssues,
  hasChange,
  IN_DEPTH_BLOCKS,
  issueCountByTab,
  isPlaceholder,
  localDay,
  nextVersion,
  NOTHING_REFUSED,
  refusedReplyIssues,
  stillRefused,
  TABS,
  tabOf,
  validate,
  withoutPlaceholders,
  type BlockId,
  type FieldIssue,
  type RefusedReplies,
  type TabId,
} from './model';
import { activateVersion, saveVersion, usePersona, type PersonaReady } from './source';
import {
  AdditionalInfoTab,
  BehaviorTab,
  DetailsTab,
  FollowUpsTab,
  LimitsTab,
  NotificationsTab,
  StrategiesTab,
} from './tabs';

import { fullDay } from '@/scheduling/time';
import './persona.css';

/**
 * Créatrices › Persona: the creator persona (ADR 0010), tab by tab like OnlyChat's creator sheet, built on
 * `PersonaSchema`. What dominates is the state of the draft and its one action, saving a new version; the tabs
 * hold the work; secondary blocks stay folded behind their summary line (docs/design/README.md).
 */
export function PersonaSection({
  creatorId,
  canSave,
  isOwner = false,
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
  timezone: string | null;
  /** Her name in Nirvana, which a persona not written yet takes as its first name. */
  creatorName?: string | null;
  /** Told whether the draft holds changes not saved, so that leaving the page can ask first. Must be stable. */
  onDirty?: (dirty: boolean) => void;
}): JSX.Element {
  const { load, reload } = usePersona(creatorId, creatorName);
  /** Said once a save went through, until the next edit. */
  const [notice, setNotice] = useState<string | null>(null);
  /** Kept here, so that a save, which starts the editor again from the new version, stays on the same tab. */
  const [tab, setTab] = useState<TabId>('details');

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
      timezone={timezone}
      notice={notice}
      tab={tab}
      onTab={setTab}
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

const tabIndex = (tab: TabId): number => TABS.findIndex((t) => t.id === tab);

const CONFLICT =
  'Une autre version a été enregistrée pendant que tu modifiais. Recharge pour repartir de la dernière : tes modifications ici seront perdues.';

const ACTIVATION_CONFLICT =
  'Sa version active a changé depuis l’ouverture de cette page, sans doute dans un autre onglet. Rien n’a été activé : recharge pour voir où elle en est.';

const READ_ONLY = 'Lecture seule : seuls le propriétaire et la créatrice modifient sa persona.';

function Editor({
  ready,
  creatorId,
  canSave,
  isOwner,
  timezone,
  notice,
  tab,
  onTab,
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
  timezone: string | null;
  notice: string | null;
  tab: TabId;
  onTab: (tab: TabId) => void;
  onDirty: (dirty: boolean) => void;
  onEdit: () => void;
  onSaved: (version: PersonaVersionSummary) => void;
  onActivated: (version: string) => void;
  onReload: () => void;
}): JSX.Element {
  const saved = ready.persona;
  const [draft, setDraft] = useState(saved);
  const [saving, setSaving] = useState(false);
  /** Why the last save did not go through, and whether reloading is the way out. */
  const [problem, setProblem] = useState<{ text: string; reload: boolean } | null>(null);
  /** Which way the panel slides in: towards the tab picked, like a page turning. */
  const [direction, setDirection] = useState<'left' | 'right' | 'none'>('none');
  /** A field to bring into view once its tab is on screen (« Voir »). */
  const [focusField, setFocusField] = useState<string | null>(null);
  /** The sample replies the server refused at the last save (422), shown on their field until their text changes. */
  const [refused, setRefused] = useState<RefusedReplies>(NOTHING_REFUSED);
  const panelRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);

  const issues = useMemo(() => [...validate(draft), ...stillRefused(refused, draft)], [draft, refused]);
  const completion = useMemo(() => withIssues(draftCompletion(draft), issues), [draft, issues]);
  const changed = useMemo(() => changedFields(saved, draft), [saved, draft]);
  // A persona never written, nothing typed yet: what is still to fill reads as a step, not as faults in amber (CREA-13).
  const quiet = ready.source === 'example' && changed.length === 0;
  const flagged = useMemo(() => (quiet ? [] : issues), [quiet, issues]);
  const form = useMemo(() => ({ issues: flagged, changed }), [flagged, changed]);

  const dirty = changed.length > 0;
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
    setDirection(tabIndex(next) > tabIndex(tab) ? 'right' : 'left');
    onTab(next);
  };

  useEffect(() => {
    if (focusField === null) return;
    // The field whose path holds the issue: `details.hobbies.1` is shown by the field `details.hobbies`.
    const target = [...(panelRef.current?.querySelectorAll<HTMLElement>('[data-path]') ?? [])].find((el) => {
      const path = el.dataset['path'] ?? '';
      return focusField === path || focusField.startsWith(`${path}.`);
    });
    if (target !== undefined) {
      target.closest('details')?.setAttribute('open', '');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const control =
        target.querySelector<HTMLElement>('input, textarea') ?? target.querySelector<HTMLElement>('button');
      control?.focus({ preventScroll: true });
    }
    setFocusField(null);
  }, [focusField, tab]);

  const set = <K extends BlockId>(key: K, value: Persona[K]): void => {
    setDraft((current) => ({ ...current, [key]: value }));
    setProblem(null);
    onEdit();
  };

  const save = async (): Promise<void> => {
    if (creatorId === null) return;
    setSaving(true);
    setProblem(null);
    const taken = [...ready.versions.map((v) => v.version), draft.meta.version];
    // The model reads the zone from the persona; the code goes by the creator's, so the copy follows hers.
    // Her zone and the new number do not go through `validate`: a refusal here is a failed save, never a throw.
    const persona = PersonaSchema.safeParse(
      withoutPlaceholders({
        ...draft,
        details: { ...draft.details, timezone: timezone ?? draft.details.timezone },
        meta: { ...draft.meta, version: nextVersion(taken), created_at: localDay() },
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
      case 'unprocessable':
        setRefused({
          issues: refusedReplyIssues(result.faults),
          replies: draft.sample_replies?.map((reply) => reply.reply) ?? [],
        });
        break;
      case 'forbidden':
        setProblem({
          text: 'Seuls le propriétaire et la créatrice peuvent enregistrer sa persona.',
          reload: false,
        });
        break;
      case 'failed':
        setProblem({
          text: 'L’enregistrement n’a pas abouti. Tes changements restent ici ; réessaie dans un instant.',
          reload: false,
        });
        break;
    }
  };

  const activate = async (): Promise<void> => {
    const version = ready.versions[0];
    if (creatorId === null || version === undefined) return;
    setSaving(true);
    setProblem(null);
    // The active version this page read: if another tab activated one since, the server refuses.
    const expectedActive = ready.versions.find((v) => v.isActive)?.id ?? null;
    const result = await activateVersion(creatorId, version.id, expectedActive).catch(
      () => 'failed' as const,
    );
    setSaving(false);
    if (result === 'activated') onActivated(version.version);
    else if (result === 'conflict') setProblem({ text: ACTIVATION_CONFLICT, reload: true });
    else {
      setProblem({
        text:
          result === 'forbidden'
            ? 'Seuls le propriétaire et la créatrice peuvent activer sa persona.'
            : 'Rien n’a été activé : Nirvana ne répond pas. Réessaie dans un instant.',
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
        : changed.length === 0
          ? 'Rien à enregistrer pour l’instant.'
          : null;
  const props = <K extends BlockId>(key: K) => ({
    value: draft[key],
    onChange: (value: Persona[K]) => {
      set(key, value);
    },
    issues: flagged,
  });
  const reset = (): void => {
    setDraft(saved);
    setProblem(null);
    setRefused(NOTHING_REFUSED);
  };
  /** A block of the persona: its tab, then its folded section opened and brought into view. */
  const show = (field: string): void => {
    const block = blockOf(field);
    if (block === undefined) return;
    select(tabOf(block));
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
          completion={completion}
          changes={changed.length}
          saving={saving}
          blocked={blocked}
          canActivate={canSave && changed.length === 0 && ready.versions[0]?.isActive === false}
          notice={notice}
          problem={problem}
          onSave={() => {
            void save();
          }}
          onActivate={() => {
            void activate();
          }}
          onReload={onReload}
          onReset={reset}
          onShowBlock={show}
          onShowIssue={(issue) => {
            show(issue.field);
          }}
        />

        <Tabs
          active={tab}
          errors={issueCountByTab(flagged)}
          edited={(id) =>
            id === 'in_depth'
              ? IN_DEPTH_BLOCKS.some((block) => hasChange(changed, block))
              : hasChange(changed, id)
          }
          onSelect={select}
        />

        <div
          className="nv-plate ps-panel"
          role="tabpanel"
          id={`ps-panel-${tab}`}
          aria-labelledby={`ps-tab-${tab}`}
          data-direction={direction}
          ref={panelRef}
          key={tab}
        >
          {/* A chatter reads her persona: every field shows, none takes a change. */}
          <fieldset className="ps-fieldset" disabled={!canSave}>
            {tab === 'details' ? (
              <DetailsTab {...props('details')} timezone={timezone} isOwner={isOwner} />
            ) : null}
            {tab === 'additional_info' ? <AdditionalInfoTab {...props('additional_info')} /> : null}
            {tab === 'in_depth' ? (
              <InDepthTab
                issues={flagged}
                missing={completion.missing}
                sections={{
                  lifestyle: <LifestyleTab {...props('lifestyle')} />,
                  tastes: <TastesTab {...props('tastes')} />,
                  intimate: <IntimateTab {...props('intimate')} />,
                  writing_style: <WritingStyleTab {...props('writing_style')} />,
                  sample_replies: <SampleRepliesTab {...props('sample_replies')} />,
                }}
              />
            ) : null}
            {tab === 'behavior' ? <BehaviorTab {...props('behavior')} /> : null}
            {tab === 'strategies' ? <StrategiesTab {...props('strategies')} /> : null}
            {tab === 'follow_ups' ? <FollowUpsTab {...props('follow_ups')} /> : null}
            {tab === 'notifications' ? (
              <NotificationsTab {...props('notifications')} isOwner={isOwner} />
            ) : null}
            {tab === 'limits' ? <LimitsTab {...props('limits')} /> : null}
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

/** How long « Confirmer l'activation » waits for its second click. */
const CONFIRM_MS = 4000;

const plural = (n: number, one: string, many: string): string => `${String(n)} ${n > 1 ? many : one}`;

/** What the note under the head says: where this persona comes from and what a save does. */
function noteOf(ready: PersonaReady, known: boolean): string {
  if (!known) return 'Ceci est un exemple : tu peux tout modifier pour essayer, rien ne sera enregistré.';
  if (ready.source === 'example') {
    return 'Pars de cet exemple : ton premier enregistrement deviendra sa version 0.0.1.';
  }
  const active = ready.versions.find((v) => v.isActive);
  // The agent reads her active version at each draft; without one he writes nothing (recette 28/10, G4).
  return `Chaque enregistrement crée une nouvelle version, inactive, et tu actives la nouvelle quand elle est prête. ${
    active === undefined
      ? 'Aucune version n’est active pour l’instant : l’agent n’écrit rien pour elle, et aucun message ne peut partir avant l’activation d’une version.'
      : `Version active : ${active.version}. C’est avec elle que l’agent écrit ses brouillons.`
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
  completion,
  changes,
  saving,
  blocked,
  canActivate,
  notice,
  problem,
  onSave,
  onActivate,
  onReload,
  onReset,
  onShowIssue,
  onShowBlock,
}: {
  headRef: RefObject<HTMLDivElement | null>;
  draft: Persona;
  ready: PersonaReady;
  known: boolean;
  /** Nothing can change here (a chatter): the state says so instead of what is still to fix. */
  readOnly: boolean;
  issues: readonly FieldIssue[];
  /** Her first version, nothing typed yet: what is missing is a step to take, not a fault (CREA-13). */
  quiet: boolean;
  completion: PersonaCompletion;
  changes: number;
  saving: boolean;
  /** Why saving is not possible now, or null when it is. */
  blocked: string | null;
  /** Her newest version is stored, unchanged here and not yet the one the agent writes with. */
  canActivate: boolean;
  notice: string | null;
  problem: { text: string; reload: boolean } | null;
  onSave: () => void;
  onActivate: () => void;
  onReload: () => void;
  onReset: () => void;
  onShowIssue: (issue: FieldIssue) => void;
  onShowBlock: (block: BlockId) => void;
}): JSX.Element {
  const name = draft.details.first_name.trim();
  /** Activating changes what the agent writes: a second click confirms it. */
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => {
      setConfirming(false);
    }, CONFIRM_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [confirming]);
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
  const created = fullDay(draft.meta.created_at);

  return (
    <div className="nv-plate ps-head" ref={headRef}>
      <div className="ps-head__top">
        <div className="ps-head__who">
          <h2 className="ps-title" data-placeholder={name === '' || isPlaceholder(name) ? 'true' : undefined}>
            {name === '' || isPlaceholder(name) ? 'Prénom à remplir' : name}
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
                <span>Version {draft.meta.version}</span>
                <span aria-hidden="true">·</span>
                <span>{created}</span>
              </>
            )}
          </p>
        </div>
        <div className="ps-head__actions">
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
              onClick={() => {
                if (confirming) {
                  setConfirming(false);
                  onActivate();
                } else setConfirming(true);
              }}
            >
              {confirming ? 'Confirmer l’activation' : `Activer la version ${draft.meta.version}`}
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
              onShowIssue(first);
            }}
          >
            Voir le premier
          </button>
        ) : null}
      </div>
      <Completion completion={completion} onShowBlock={onShowBlock} />
      <p className="ps-muted" id="ps-save-note">
        {noteOf(ready, known)}
      </p>
    </div>
  );
}

/**
 * How much of her the agent can read (`personaCompletion`): the percent in ink beside a neutral gauge, on one line,
 * then the blocks still to write, each opening its place. Nothing is required: it says what is missing, never that a
 * save is blocked, and says nothing more once all is written.
 */
function Completion({
  completion: { percent, missing },
  onShowBlock,
}: {
  completion: PersonaCompletion;
  onShowBlock: (block: BlockId) => void;
}): JSX.Element {
  return (
    <div className="ps-completion">
      <p className="ps-completion__line">
        <span className="ps-completion__label">Complète à</span>
        <span className="ps-completion__percent">{percent} %</span>
        <span
          className="nv-gauge ps-completion__gauge"
          role="progressbar"
          aria-label="Complétude de la persona"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          style={{ '--nv-gauge-value': `${String(percent)}%` }}
        >
          <span className="nv-gauge__fill" />
        </span>
      </p>
      {missing.length === 0 ? null : (
        <p className="ps-completion__missing">
          <span className="ps-muted">À compléter :</span>
          {missing.map(({ block, label }, index) => (
            <span key={block}>
              <button
                type="button"
                className="ps-completion__block"
                onClick={() => {
                  onShowBlock(block);
                }}
              >
                {label}
              </button>
              {index < missing.length - 1 ? ', ' : null}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** How far into a faded edge a tab may reach and still count as seen: past that, its count would be under the fade. */
const EDGE = 48;

/** The tabs out of the bar's view on each side, from its scroll and the places of its tabs. */
export function tabsOutOfView(bar: HTMLElement): TabsHidden {
  const from = bar.scrollLeft;
  const to = from + bar.clientWidth;
  const start: TabId[] = [];
  const end: TabId[] = [];
  if (bar.scrollWidth - bar.clientWidth <= 1) return { start, end };
  const fadeStart = from > 1 ? EDGE : 0;
  const fadeEnd = to < bar.scrollWidth - 1 ? EDGE : 0;
  for (const item of bar.querySelectorAll<HTMLElement>('[data-tab]')) {
    const id = TABS.find((t) => t.id === item.dataset['tab'])?.id;
    if (id === undefined) continue;
    if (item.offsetLeft < from + fadeStart - 1) start.push(id);
    else if (item.offsetLeft + item.offsetWidth > to - fadeEnd + 1) end.push(id);
  }
  return { start, end };
}

interface TabsHidden {
  readonly start: readonly TabId[];
  readonly end: readonly TabId[];
}

const NONE_HIDDEN: TabsHidden = { start: [], end: [] };

const reducedMotion = (): boolean =>
  typeof window.matchMedia !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The eight tabs of the persona on one line that scrolls (recette 28/10, CREA-01). What is past an edge is never
 * silent: that edge fades, a chevron brings the next tabs in, and it carries the amber count of the fields to fix in
 * the tabs it hides. The tab picked comes to the middle of the bar, its neighbours showing on both sides.
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
  const [hidden, setHidden] = useState<TabsHidden>(NONE_HIDDEN);

  const measure = useCallback((): void => {
    const bar = navRef.current;
    if (bar === null) return;
    const next = tabsOutOfView(bar);
    setHidden((current) =>
      current.start.join() === next.start.join() && current.end.join() === next.end.join() ? current : next,
    );
  }, []);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const item = nav?.querySelector('[aria-selected="true"]');
    if (nav === null || !(item instanceof HTMLElement)) return;
    placeTabBarLens(nav, item, placed.current ? (thumbRef.current ?? undefined) : undefined);
    const left = Math.max(0, item.offsetLeft - (nav.clientWidth - item.offsetWidth) / 2);
    if (typeof nav.scrollTo === 'function') {
      nav.scrollTo({ left, behavior: placed.current && !reducedMotion() ? 'smooth' : 'auto' });
    }
    placed.current = true;
    measure();
  }, [active, measure]);

  useEffect(() => {
    const nav = navRef.current;
    if (nav === null) return;
    nav.addEventListener('scroll', measure, { passive: true });
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    resize?.observe(nav);
    return () => {
      nav.removeEventListener('scroll', measure);
      resize?.disconnect();
    };
  }, [measure]);

  const page = (side: 'start' | 'end'): void => {
    const nav = navRef.current;
    if (nav === null || typeof nav.scrollBy !== 'function') return;
    const step = Math.max(120, nav.clientWidth * 0.7);
    nav.scrollBy({ left: side === 'end' ? step : -step, behavior: reducedMotion() ? 'auto' : 'smooth' });
  };
  const more =
    hidden.start.length > 0 && hidden.end.length > 0
      ? 'both'
      : hidden.start.length > 0
        ? 'start'
        : hidden.end.length > 0
          ? 'end'
          : undefined;

  return (
    <div className="ps-tabs" data-more={more}>
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
      <MoreTabs side="start" tabs={hidden.start} errors={errors} onPage={page} />
      <MoreTabs side="end" tabs={hidden.end} errors={errors} onPage={page} />
    </div>
  );
}

/** The chevron over a faded edge: it names the tabs it hides, and counts in amber the fields to fix there. */
function MoreTabs({
  side,
  tabs,
  errors,
  onPage,
}: {
  side: 'start' | 'end';
  tabs: readonly TabId[];
  errors: Record<TabId, number>;
  onPage: (side: 'start' | 'end') => void;
}): JSX.Element | null {
  if (tabs.length === 0) return null;
  const toFix = tabs.reduce((sum, id) => sum + errors[id], 0);
  const names = tabs.map((id) => TABS.find((t) => t.id === id)?.label ?? id).join(', ');
  const label = `${side === 'end' ? 'Onglets suivants' : 'Onglets précédents'} : ${names}${
    toFix > 0 ? `, ${plural(toFix, 'champ', 'champs')} à corriger` : ''
  }`;
  return (
    <button
      type="button"
      className="nv-glass nv-glass--thin ps-tabs__more ps-pop"
      data-side={side}
      aria-label={label}
      title={label}
      // Every tab is in the tab order already: the chevron is a shortcut for the pointer and the finger.
      tabIndex={-1}
      onClick={() => {
        onPage(side);
      }}
    >
      <span className="ps-tabs__chevron" aria-hidden="true" />
      {toFix > 0 ? (
        <span className="nv-subnav__count ps-tabs__alert" aria-hidden="true">
          {toFix}
        </span>
      ) : null}
    </button>
  );
}
