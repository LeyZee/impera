import {
  REJECT_REASONS,
  type CopilotAssist,
  type CopilotCut,
  type DesireBand,
  type FanCardEntry,
  type FanCardFieldSpec,
  type FanCardGroup,
  type FanCardView,
  type RejectReason,
} from '@impera/contracts';

import {
  CUT_LINES,
  cutOf,
  draftNotes,
  moveLines,
  saleLine,
  saleRows,
  stepDots,
} from '../../lib/copilot/assist';
import { bandBadges, type Badge } from '../../lib/copilot/band';
import {
  entryOf,
  ESSENTIALS,
  groupChecks,
  groupLine,
  IDENTITY,
  IDENTITY_WORDS,
  identitySources,
  identityText,
  PANEL_GROUPS,
  restOf,
  sourceLine,
  specOf,
  toCheckCount,
  toDiscover,
  valueText,
} from '../../lib/copilot/card';
import { REJECT_WORDS, withheldOf, type Standing, type Withheld } from '../../lib/copilot/standing';
import type { VerdictSent } from '../../lib/copilot/verdict';
import { h } from '../../lib/dom';
import { icon, type IconName } from '../../lib/icons';

/**
 * One screen of the copilot side panel (ADR 0086). Pure: the same state draws the same nodes; main.ts follows the tab
 * and reads the CRM. Text always goes in as text: a value of the card, his words, are data, never markup.
 */
export type PanelScreen =
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed_out' }
  /** The tab is not a Reveal conversation. */
  | { readonly kind: 'no_conversation' }
  /** § 2: a conversation Impera has not read yet. */
  | { readonly kind: 'unknown' }
  /** § 7: a chatter out of his shift on her. */
  | { readonly kind: 'off_shift' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'down' }
  | {
      readonly kind: 'conversation';
      /** His name on the platform, so the panel says which conversation it shows (EXT-14); null until read. */
      readonly fanName: string | null;
      /** « Où on en est » (§ 3.1); null while it is read the first time. */
      readonly standing: Standing | null;
      /** Her switch « Fiche du fan dans l'extension » (§ 6). */
      readonly cardOn: boolean;
      /** Whether the reader has Créatrices, where that switch is: else his manager turns it on (EXT-17). */
      readonly opensCreators: boolean;
      /** Null while it is read the first time. */
      readonly card: FanCardView | 'forbidden' | 'down' | null;
      readonly openGroups: ReadonlySet<FanCardGroup>;
      /** A value noted after this moment is marked « nouveau » (§ 10, EXT-14); null marks nothing. */
      readonly newSince: string | null;
      readonly draft: DraftPart;
      /** What the agent computed (ADR 0141, lot a); null from a server that does not send it yet. */
      readonly assist: CopilotAssist | null;
      /** The sale line's detail, closed by default (§ 14). */
      readonly saleOpen: boolean;
      /** « N à découvrir », closed by default (Design 16/11, lot 0141-3). */
      readonly discoverOpen: boolean;
      /** The band past its first three badges (§ 14). */
      readonly signalsOpen: boolean;
      readonly now: Date;
    };

/**
 * What a gesture left: the bubbles copied for Reveal one at a time, as Reveal sends them (ADR 0086 § 4, EXT-13), and
 * whether the gesture counted on the server.
 */
export interface GestureDone {
  readonly outcome: 'placed' | 'rejected';
  /** What was placed, one bubble each (the retouched text, line by line), or the draft refused. */
  readonly bubbles: readonly string[];
  /** How many bubbles are copied so far, from the first: 0 for a refusal. */
  readonly copied: number;
  /** The last bubble could not be put in the clipboard: it stays selectable above. */
  readonly copyFailed: boolean;
  readonly sent: VerdictSent | 'sending';
}

/**
 * The agent's draft, in the core right under the band (Design 16/11, lot 0141-3): what to do, the text, its copy. While
 * the agent writes, it holds the room of a draft, so a draft that arrives pushes the card little (ADR 0086 § 10).
 * `hidden`: her drafts are off, or none is waiting.
 */
export type DraftPart =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'writing' }
  | {
      readonly kind: 'ready';
      readonly bubbles: readonly string[];
      /** Placed in Reveal by a chatter, waiting for what leaves (§ 5). */
      readonly placed: boolean;
      readonly mode: 'idle' | 'editing' | 'rejecting';
      /** The text being retouched, one bubble per line. */
      readonly text: string;
      readonly reason: RejectReason | null;
      readonly done: GestureDone | null;
    };

export interface PanelActions {
  readonly openCrm: () => void;
  readonly toggleGroup: (group: FanCardGroup, open: boolean) => void;
  readonly toggleSale: (open: boolean) => void;
  readonly toggleDiscover: (open: boolean) => void;
  /** « +N »: the signals past the first three badges. */
  readonly showSignals: () => void;
  /** `a`, or the retouched text with `e` (§ 4). */
  readonly place: (edited: boolean) => void;
  /** `a` again: the next bubble of what was placed. */
  readonly copyNext: () => void;
  readonly edit: () => void;
  readonly editText: (text: string) => void;
  readonly reject: () => void;
  readonly pickReason: (reason: RejectReason) => void;
  readonly sendReject: (note: string) => void;
  readonly cancel: () => void;
}

const NOTICES: Readonly<
  Record<
    Exclude<PanelScreen['kind'], 'conversation' | 'loading'>,
    { title: string; text: string; icon: IconName; tone?: 'amber' }
  >
> = {
  signed_out: {
    icon: 'key',
    title: 'Connecte-toi au CRM',
    text: 'Le panneau lit la fiche du fan avec ta session du CRM.',
  },
  no_conversation: {
    icon: 'message',
    title: 'Ouvre une conversation dans Reveal',
    text: 'Le panneau suit la conversation ouverte, sans clic de ta part.',
  },
  unknown: {
    icon: 'eye',
    title: 'Impera n’a pas encore lu cette conversation',
    text: 'Elle apparaîtra ici dès qu’Impera l’aura lue.',
  },
  off_shift: {
    icon: 'planning',
    title: 'Tu n’es pas en poste sur cette créatrice',
    text: 'Le panneau s’ouvre pendant ton shift.',
  },
  forbidden: {
    icon: 'shield',
    title: 'Cette créatrice ne t’est pas ouverte',
    text: 'Demande à ton responsable si c’est une erreur.',
  },
  conflict: {
    icon: 'alert',
    title: 'Deux créatrices ont cette conversation',
    text: 'Ouvre-la depuis le CRM pour savoir laquelle.',
    tone: 'amber',
  },
  down: {
    icon: 'alert',
    title: 'Le CRM ne répond pas',
    // The popup's voice for the same notice (V-EXT-15): what to check, then what the panel does.
    text: 'Vérifie que le CRM est lancé. Le panneau réessaie tout seul.',
    tone: 'amber',
  },
};

/** A notice in the popup's shape (V-EXT-15): its icon in a tile, its title, one sentence, a full-width button. */
function notice(kind: keyof typeof NOTICES): HTMLElement {
  const { title, text, tone, icon: name } = NOTICES[kind];
  return h(
    'section',
    {
      class: 'cp-notice',
      'data-kind': kind,
      'data-tone': tone,
      role: tone === 'amber' ? 'status' : undefined,
    },
    // The popup's form for a notice (V-EXT-15): its picture in a tile, its title, its sentence, a button across.
    h('span', { class: 'cp-notice__icon', 'aria-hidden': 'true' }, icon(name, 18)),
    h('p', { class: 'cp-notice__title' }, title),
    h('p', { class: 'cp-notice__text' }, text),
    kind === 'signed_out'
      ? h('button', { type: 'button', class: 'nv-btn nv-btn--soft', 'data-action': 'crm' }, 'Ouvrir le CRM')
      : null,
  );
}

/** His words a value rests on (ADR 0085 § 5): shown as his, after « Il a écrit » (« Prénom : il a écrit »). */
function quote(text: string | null, part?: string): HTMLElement | null {
  return text === null
    ? null
    : h(
        'span',
        { class: 'cp-field__quote' },
        part === undefined ? 'Il a écrit : ' : `${capital(part)} : il a écrit `,
        h('q', {}, text),
      );
}

const capital = (text: string): string => text.charAt(0).toLocaleUpperCase('fr-FR') + text.slice(1);

/** What the card shows of a value: when it is newer than the panel's first reading of the card, it says so (§ 10). */
interface Marks {
  readonly now: Date;
  readonly newSince: string | null;
}

const isNew = (observedAt: string, marks: Marks): boolean =>
  marks.newSince !== null && Date.parse(observedAt) > Date.parse(marks.newSince);

const newMark = (): HTMLElement => h('span', { class: 'cp-field__new' }, 'nouveau');

/**
 * A field of the card in a group (EXT-04): its label as a muted overline with where the value comes from to its right,
 * then the value in ink. A source the field above already said is not said again: `said` carries the last one shown.
 */
function field(
  spec: FanCardFieldSpec,
  entry: FanCardEntry,
  marks: Marks,
  said: { last: string | null },
): HTMLElement {
  const { current, toCheck } = entry;
  const source = current === null ? null : sourceLine(current, marks.now);
  const sayIt = source !== null && source !== said.last;
  if (source !== null) said.last = source;
  return h(
    'li',
    { class: 'cp-field', 'data-field': spec.field },
    h(
      'span',
      { class: 'cp-field__top' },
      h('span', { class: 'cp-field__label' }, spec.label),
      current !== null && isNew(current.observedAt, marks) ? newMark() : null,
      sayIt ? h('span', { class: 'cp-field__source' }, source) : null,
    ),
    current === null ? null : h('span', { class: 'cp-field__value' }, valueText(spec.field, current.items)),
    current === null ? null : quote(current.sourceQuote),
    ...checksOf(spec.field, toCheck),
  );
}

/** What the agent read and a chatter must check (ADR 0085 § 6), with his words. */
const checksOf = (
  name: FanCardEntry['field'],
  toCheck: FanCardEntry['toCheck'],
  part?: string,
): HTMLElement[] =>
  toCheck.map((value) =>
    h(
      'span',
      { class: 'cp-field__check' },
      part === undefined
        ? `À vérifier : l’agent a lu « ${valueText(name, value.items)} »`
        : `À vérifier, ${part} : l’agent a lu « ${valueText(name, value.items)} »`,
      quote(value.sourceQuote),
    ),
  );

/**
 * Who he is in one line, « Alpha · 34 ans · Lyon », only what is known, the first name in bold (Design 16/11, lot
 * 0141-3). Where it comes from is said once under it; while his age is contested, a red « contesté » next to his age
 * takes the place of that source, so the line never states as a fact what is in doubt.
 */
function identity(card: FanCardView, marks: Marks, ageDisputed: boolean): HTMLElement | null {
  const entries = IDENTITY.map((name) => ({ name, entry: entryOf(card.fields, name) }));
  const known = entries.filter(({ entry }) => entry.current !== null);
  if (known.length === 0 && !ageDisputed) {
    const checks = entries.flatMap(({ name, entry }) => checksOf(name, entry.toCheck, IDENTITY_WORDS[name]));
    return checks.length === 0
      ? null
      : h('li', { class: 'cp-field cp-ident', 'data-field': 'identity' }, ...checks);
  }
  const line = h('span', { class: 'cp-ident__line' });
  const parts: HTMLElement[] = [];
  for (const { name, entry } of entries) {
    const contested = name === 'age' && ageDisputed;
    if (entry.current === null && !contested) continue;
    const text = entry.current === null ? null : identityText(name, entry.current.items);
    parts.push(
      h(
        'span',
        {
          class: name === 'first_name' ? 'cp-ident__name' : 'cp-ident__part',
          'data-field': name,
        },
        text,
        contested
          ? h('span', { class: 'cp-ident__contested' }, text === null ? 'âge contesté' : 'contesté')
          : null,
      ),
    );
  }
  parts.forEach((part, index) => {
    if (index > 0) line.append(h('span', { class: 'cp-ident__dot', 'aria-hidden': 'true' }, '·'));
    line.append(part);
  });
  const fresh = known.some(({ entry }) => entry.current !== null && isNew(entry.current.observedAt, marks));
  return h(
    'li',
    { class: 'cp-field cp-ident', 'data-field': 'identity', 'aria-label': 'Prénom, âge et ville' },
    h('span', { class: 'cp-field__top' }, line, fresh ? newMark() : null),
    ...(ageDisputed
      ? []
      : identitySources(card.fields, marks.now).map((text) =>
          h('span', { class: 'cp-ident__source' }, text),
        )),
    ...entries.map(({ name, entry }) => quote(entry.current?.sourceQuote ?? null, IDENTITY_WORDS[name])),
    ...entries.flatMap(({ name, entry }) => checksOf(name, entry.toCheck, IDENTITY_WORDS[name])),
  );
}

/** What is masked while his age is contested (ADR 0141 § 9, Agent 16/11): said the same way on both rows. */
const MASKED = 'Masqué tant que son âge est contesté.';

/** « Ses fantasmes » masked: its label, then only why, in the muted ink. Nothing of its value, source or checks. */
const maskedField = (spec: FanCardFieldSpec): HTMLElement =>
  h(
    'li',
    { class: 'cp-field', 'data-field': spec.field, 'data-masked': 'true' },
    h('span', { class: 'cp-field__top' }, h('span', { class: 'cp-field__label' }, spec.label)),
    h('span', { class: 'cp-field__masked' }, MASKED),
  );

/** « Intime » masked: a row that does not open, its title and why. */
const maskedGroup = (group: FanCardGroup, title: string): HTMLElement =>
  h(
    'div',
    { class: 'cp-group', 'data-group': group, 'data-masked': 'true' },
    h(
      'div',
      { class: 'cp-group__row' },
      h('span', { class: 'cp-group__title' }, title),
      h('span', { class: 'cp-group__sum' }, MASKED),
    ),
  );

/**
 * While his age is contested, his fantasies and the intimate group are masked by the panel itself, closed by default:
 * even if a server still sent their values, none is drawn, and their checks are not counted.
 */
const isMasked = (masked: boolean, spec: FanCardFieldSpec): boolean => masked && spec.group === 'intimate';

/**
 * A field of the brief (Design 16/11, lot 0141-3): its label as a muted overline, its source to the right, then what
 * is known as short bullets, one per item. Nothing when nothing is known: no « Pas encore su » here.
 */
function briefField(spec: FanCardFieldSpec, entry: FanCardEntry, marks: Marks): HTMLElement | null {
  const { current, toCheck } = entry;
  if (current === null && toCheck.length === 0) return null;
  return h(
    'li',
    { class: 'cp-field', 'data-field': spec.field },
    h(
      'span',
      { class: 'cp-field__top' },
      h('span', { class: 'cp-field__label' }, spec.label),
      current !== null && isNew(current.observedAt, marks) ? newMark() : null,
      current === null ? null : h('span', { class: 'cp-field__source' }, sourceLine(current, marks.now)),
    ),
    current === null
      ? null
      : h(
          'ul',
          { class: 'cp-items' },
          ...current.items.map((item) =>
            h('li', { class: 'cp-field__value' }, valueText(spec.field, [item])),
          ),
        ),
    current === null ? null : quote(current.sourceQuote),
    ...checksOf(spec.field, toCheck),
  );
}

/**
 * Him, in brief (Design 16/11, lot 0141-3): a short card of what is known and helps to answer, first name, age and
 * town, what he likes, what he does not want, what happens in his life. What is not known waits behind « à découvrir ».
 */
function briefCard(card: FanCardView, marks: Marks, masked: boolean, ageDisputed: boolean): HTMLElement {
  const checks = toCheckCount(
    card.fields.filter((entry) => {
      const spec = specOf(entry.field);
      return spec === undefined || !isMasked(masked, spec);
    }),
  );
  const rows = [
    identity(card, marks, ageDisputed),
    ...ESSENTIALS.filter((name) => !IDENTITY.some((part) => part === name)).map((name) => {
      const spec = specOf(name);
      if (spec === undefined) return null;
      // « Ses fantasmes » is masked; « Ce qu'il ne veut pas » stays read: it protects him (Agent 16/11).
      return spec.field === 'desires' && isMasked(masked, spec)
        ? maskedField(spec)
        : briefField(spec, entryOf(card.fields, name), marks);
    }),
  ].filter((node): node is HTMLElement => node !== null);
  return h(
    'section',
    { class: 'cp-brief', 'aria-label': 'Fiche du fan' },
    h(
      'header',
      { class: 'cp-brief__head' },
      h('h1', { class: 'cp-overline' }, 'Fiche du fan'),
      checks === 0 ? null : h('span', { class: 'cp-head__check' }, `${String(checks)} à vérifier`),
    ),
    rows.length === 0
      ? h('p', { class: 'cp-brief__none' }, 'Rien de su sur lui pour l’instant.')
      : h('ul', { class: 'cp-fields cp-fields--essentials', 'aria-label': 'L’essentiel' }, ...rows),
  );
}

/** « N à découvrir » (Design 16/11, lot 0141-3): one muted line that opens what is not known of him yet. */
function discoverFold(
  card: FanCardView,
  masked: boolean,
  open: boolean,
  actions: PanelActions,
): HTMLElement | null {
  const sections = toDiscover(card.fields, masked);
  const count = sections.reduce((total, { labels }) => total + labels.length, 0);
  if (count === 0) return null;
  const details = h(
    'details',
    { class: 'cp-discover', 'data-group': 'discover', open },
    h(
      'summary',
      {},
      h('span', { class: 'cp-discover__count' }, `${String(count)} à découvrir`),
      h('span', { class: 'cp-group__chevron', 'aria-hidden': 'true' }, icon('chevronRight', 16)),
    ),
    h(
      'ul',
      { class: 'cp-discover__list' },
      ...sections.map(({ title, labels }) =>
        h(
          'li',
          {},
          h('span', { class: 'cp-overline' }, title),
          h('span', { class: 'cp-discover__labels' }, `${labels.join(', ')}.`),
        ),
      ),
    ),
  );
  details.addEventListener('toggle', () => {
    actions.toggleDiscover(details.open);
  });
  return details;
}

/** The groups « Lui », « Elle, vue par lui », « Intime », folded at the very bottom with their counts. */
function groupFolds(
  card: FanCardView,
  openGroups: ReadonlySet<FanCardGroup>,
  marks: Marks,
  actions: PanelActions,
  masked: boolean,
): HTMLElement[] {
  return PANEL_GROUPS.map(({ group, title }) => {
    if (masked && group === 'intimate') return maskedGroup(group, title);
    const groupSaid: { last: string | null } = { last: null };
    const toCheck = groupChecks(card.fields, group);
    // A group shows what is known or waits for a check; what is not known is named under « à découvrir ».
    const shown = restOf(group).filter((spec) => {
      const entry = entryOf(card.fields, spec.field);
      return entry.current !== null || entry.toCheck.length > 0;
    });
    const details = h(
      'details',
      { class: 'cp-group', 'data-group': group, open: openGroups.has(group) },
      h(
        'summary',
        {},
        h('span', { class: 'cp-group__title' }, title),
        h(
          'span',
          { class: 'cp-group__sum' },
          groupLine(card.fields, group),
          // Where the count on top sends him (V-EXT-07).
          toCheck === 0 ? null : h('span', { class: 'cp-group__check' }, ` · ${String(toCheck)} à vérifier`),
        ),
        // The fold says it opens (V-EXT-06).
        h('span', { class: 'cp-group__chevron', 'aria-hidden': 'true' }, icon('chevronRight', 16)),
      ),
      h(
        'ul',
        { class: 'cp-fields' },
        ...(shown.length === 0
          ? [h('li', { class: 'cp-field cp-field--unknown' }, 'Rien de su pour l’instant.')]
          : shown.map((spec) => field(spec, entryOf(card.fields, spec.field), marks, groupSaid))),
      ),
    );
    details.addEventListener('toggle', () => {
      actions.toggleGroup(group, details.open);
    });
    return details;
  });
}

/** A badge of the band: its icon and one or two words, the whole said in words to a screen reader. */
function badgeNode(badge: Badge): HTMLElement {
  return h(
    'span',
    {
      class: 'nv-status cp-badge',
      role: 'img',
      'aria-label': badge.label,
      'data-tone': badge.tone,
      'data-kind': badge.kind,
    },
    icon(badge.icon, 14),
    h('span', { class: 'cp-badge__words' }, badge.words),
    badge.trend === null ? null : icon(badge.trend === 'up' ? 'arrowUp' : 'arrowDown', 14),
  );
}

/**
 * The status band, stuck on top, one line (Design 16/11, lot 0141-3): his name on the platform on the left, so the
 * panel says which conversation it shows (EXT-14), and on the right at most three badges, what forbids or holds back
 * first, then his desire, then the signals not to miss (ADR 0141 § 4). Nothing to say draws no badge.
 */
function statusBand(
  fanName: string | null,
  standing: Standing | null,
  assist: CopilotAssist | null,
  cut: CopilotCut | null,
  open: boolean,
): HTMLElement {
  const badges = h('div', { class: 'cp-badges', 'aria-label': 'Où on en est' });
  if (standing === null) badges.append(h('span', { class: 'cp-badges__wait', 'aria-busy': 'true' }, '…'));
  else {
    const { badges: shown, hidden } = bandBadges(standing, assist, cut, open);
    badges.append(...shown.map(badgeNode));
    if (hidden > 0)
      badges.append(
        h(
          'button',
          {
            type: 'button',
            class: 'cp-badges__more',
            'data-action': 'more-signals',
            'aria-label': `Voir ${String(hidden)} de plus`,
          },
          `+${String(hidden)}`,
        ),
      );
  }
  return h(
    'header',
    { class: 'cp-band' },
    fanName === null ? null : h('span', { class: 'cp-band__fan' }, fanName),
    badges,
  );
}

/**
 * « Quoi faire » and « pourquoi », on top of the core (ADR 0141 § 1, § 2, § 12; Design 16/11, lot 0141-3): the gesture
 * the code decided, the largest text of the panel, verb first; why, small and muted. A cut replaces it in the same
 * place with one sentence in its tone (§ 9): the sale gestures are gone, never greyed.
 */
function moveBand(
  assist: CopilotAssist | null,
  cut: CopilotCut | null,
  band: DesireBand | null,
): HTMLElement | null {
  if (cut !== null) {
    const { text, tone } = CUT_LINES[cut];
    return h(
      'section',
      { class: 'cp-move', 'data-tone': tone, 'data-cut': cut, role: 'status', 'aria-label': 'Quoi faire' },
      h('p', { class: 'cp-move__cut' }, text),
    );
  }
  if (assist?.nextMove == null) return null;
  const { what, why, tone } = moveLines(assist.nextMove, assist.reasons, { band, sale: assist.sale });
  return h(
    'section',
    { class: 'cp-move', 'data-tone': tone, 'data-move': assist.nextMove.kind, 'aria-label': 'Quoi faire' },
    h('p', { class: 'cp-move__what' }, what),
    why === null ? null : h('p', { class: 'cp-move__why' }, why),
  );
}

/**
 * The sale in one line under the core (ADR 0141 § 3, § 14; Design 16/11, lot 0141-3): one dot per step, the script and
 * its step, the next step and its price. A click opens the detail: refused steps, objections served, an open order.
 */
function saleFold(
  assist: CopilotAssist | null,
  cut: CopilotCut | null,
  open: boolean,
  actions: PanelActions,
): HTMLElement | null {
  const sale = assist?.sale ?? null;
  if (sale === null || cut !== null) return null;
  // Under « Ne rien vendre » the line does not announce the next step and its price; the detail still says it.
  const lineSaysNext = assist?.nextMove?.kind !== 'no_sale';
  const rows = saleRows(sale, { withNext: !lineSaysNext });
  const dots = stepDots(sale);
  const details = h(
    'details',
    { class: 'cp-sale', 'data-group': 'sale', open },
    h(
      'summary',
      { 'aria-label': `Où en est la vente : ${saleLine(sale, { withNext: lineSaysNext })}` },
      dots.length === 0
        ? null
        : h(
            'span',
            { class: 'cp-steps', 'aria-hidden': 'true' },
            ...dots.map((state) => h('span', { class: 'cp-step', 'data-step': state })),
          ),
      h('span', { class: 'cp-sale__line' }, saleLine(sale, { withNext: lineSaysNext })),
      h('span', { class: 'cp-group__chevron', 'aria-hidden': 'true' }, icon('chevronRight', 16)),
    ),
    h(
      'ul',
      { class: 'cp-fields' },
      ...(rows.length === 0
        ? [
            h(
              'li',
              { class: 'cp-field cp-field--unknown' },
              'Rien de refusé ni d’objection servie pour l’instant.',
            ),
          ]
        : rows.map(({ label, value }) =>
            h(
              'li',
              { class: 'cp-field' },
              h('span', { class: 'cp-field__top' }, h('span', { class: 'cp-field__label' }, label)),
              h('span', { class: 'cp-field__value' }, value),
            ),
          )),
    ),
  );
  details.addEventListener('toggle', () => {
    actions.toggleSale(details.open);
  });
  return details;
}

function cardPart(
  screen: Extract<PanelScreen, { kind: 'conversation' }>,
  actions: PanelActions,
  masked: boolean,
): HTMLElement[] {
  if (!screen.cardOn)
    return [
      h(
        'section',
        { class: 'cp-notice', 'data-kind': 'card_off' },
        // Off, so the eye is struck through (Design, lot -2).
        h('span', { class: 'cp-notice__icon', 'aria-hidden': 'true' }, icon('eyeOff', 18)),
        h('p', { class: 'cp-notice__title' }, 'La fiche du fan est éteinte pour cette créatrice'),
        h(
          'p',
          { class: 'cp-notice__text' },
          screen.opensCreators
            ? 'Elle s’allume dans Créatrices › Agent.'
            : 'Demande à ton manager de l’allumer.',
        ),
      ),
    ];
  if (screen.card === null)
    return [h('p', { class: 'cp-loading', 'aria-busy': 'true' }, 'Lecture de la fiche…')];
  if (screen.card === 'forbidden') return [notice('forbidden')];
  if (screen.card === 'down') return [notice('down')];
  const marks = { now: screen.now, newSince: screen.newSince };
  const ageDisputed = screen.standing?.ageDisputed === true;
  const discover = discoverFold(screen.card, masked, screen.discoverOpen, actions);
  return [
    briefCard(screen.card, marks, masked, ageDisputed),
    ...(discover === null ? [] : [discover]),
    ...groupFolds(screen.card, screen.openGroups, marks, actions, masked),
  ];
}

const key = (letter: string): HTMLElement => h('span', { class: 'nv-kbd' }, letter);

/**
 * What a gesture left, in one or two quiet lines: the next step in Reveal, and whether it counted (§ 5, § 8). Several
 * bubbles go one at a time, as Reveal sends them (EXT-13): the next one waits on its button, under `a`.
 */
function doneLines(done: GestureDone): HTMLElement[] {
  const lines: HTMLElement[] = [];
  const total = done.bubbles.length;
  if (done.outcome === 'rejected')
    lines.push(h('p', { class: 'cp-draft__next' }, 'Refusé : écris ta propre réponse dans Reveal.'));
  else if (done.copyFailed)
    // What blocks him, so in amber (V-EXT-19).
    lines.push(
      h(
        'p',
        { class: 'cp-draft__warn', role: 'status' },
        total > 1
          ? `La bulle ${String(done.copied)} n’a pas pu être copiée : sélectionne-la ci-dessus, colle-la dans Reveal et envoie.`
          : 'Le texte n’a pas pu être copié : sélectionne-le ci-dessus, colle-le dans Reveal et envoie.',
      ),
    );
  else if (total <= 1)
    lines.push(
      h('p', { class: 'cp-draft__next' }, 'Texte copié : colle-le dans Reveal (Ctrl+V), relis, et envoie.'),
    );
  else
    lines.push(
      h(
        'p',
        { class: 'cp-draft__next' },
        done.copied < total
          ? `Bulle ${String(done.copied)} sur ${String(total)} copiée : colle-la dans Reveal (Ctrl+V), envoie, puis copie la suivante.`
          : `Bulle ${String(total)} sur ${String(total)} copiée : colle-la dans Reveal (Ctrl+V) et envoie. C’était la dernière.`,
      ),
    );
  if (done.outcome === 'placed' && done.copied < total)
    lines.push(
      h(
        'div',
        { class: 'cp-draft__actions' },
        h(
          'button',
          { type: 'button', class: 'nv-btn nv-btn--sm cp-send', 'data-gesture': 'copy-next' },
          `Copier la bulle ${String(done.copied + 1)} `,
          key('A'),
        ),
      ),
    );
  const status: Record<GestureDone['sent'], string | null> = {
    sending: null,
    sent: null,
    unlinked:
      'Ce geste n’a pas compté : relie l’extension (clique sur l’icône Impera, puis «\u00a0Relier\u00a0»).',
    refused: 'Ce brouillon n’est plus à jour : l’agent en refait un.',
    unreachable: 'Le CRM ne répond pas : ce geste n’a pas compté.',
  };
  const text = status[done.sent];
  if (text !== null) lines.push(h('p', { class: 'cp-draft__warn', role: 'status' }, text));
  return lines;
}

/**
 * Another stop next to the draft (V-EXT-03): the line on top is 600 px away from the button, so it is said again here,
 * in red, and the send is no longer the ink button. The rule itself is the server's.
 */
const stopsLine = (stops: readonly string[]): HTMLElement =>
  h('p', { class: 'cp-draft__stop', role: 'status' }, `${stops.join(' · ')} : relis-le avant de l’envoyer.`);

/**
 * Why nothing is offered to copy: « Ne plus lui écrire » (EXT-05) in red, the limit forbids; limits not read in amber,
 * they may come back. Only the refusal is left to the chatter.
 */
const withheldLine = (withheld: Withheld): HTMLElement =>
  withheld === 'no_contact'
    ? h(
        'p',
        { class: 'cp-draft__stop', role: 'status' },
        'Ne plus lui écrire : rien ne part vers lui. Refuse ce brouillon.',
      )
    : h(
        'p',
        { class: 'cp-draft__warn', role: 'status' },
        'Impossible de lire ses limites pour l’instant\u00a0: rien à copier tant que ce n’est pas rétabli. Tu peux refuser ce brouillon.',
      );

/** Rows for the retouched text, from its length as well as its lines: a long bubble is read whole (EXT-20). */
const rowsOf = (text: string): number =>
  Math.min(
    8,
    Math.max(
      3,
      text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / 32)), 0),
    ),
  );

/** What « où on en est » forbids, as the draft reads it. */
interface DraftStops {
  readonly withheld: Withheld | null;
  readonly stops: readonly string[];
  /** A cut said right above the draft: the draft adds no line of its own (each cut said once, Design 16/11). */
  readonly saidAbove: boolean;
  /** Notes on the draft's text recorded with it (« Réécrit une fois par une garde »), in the server's words. */
  readonly notes: readonly string[];
}

function draftPart(
  draft: DraftPart,
  { withheld, stops, saidAbove, notes }: DraftStops,
  actions: PanelActions,
): HTMLElement | null {
  if (draft.kind === 'hidden') return null;
  if (draft.kind === 'writing')
    return h(
      'section',
      { class: 'cp-draft', 'aria-label': 'Brouillon de l’agent', 'data-state': 'writing' },
      h('p', { class: 'cp-draft__writing' }, 'L’agent écrit…'),
    );
  // A note on the text goes with the draft, never in « pourquoi » (Design 16/11).
  const head = h(
    'header',
    { class: 'cp-draft__head' },
    h('span', { class: 'cp-overline' }, 'Brouillon de l’agent'),
    notes.length === 0 ? null : h('span', { class: 'cp-draft__about' }, notes.join(' · ')),
  );
  const section = h('section', {
    class: 'cp-draft',
    'aria-label': 'Brouillon de l’agent',
    'data-state': draft.mode,
  });
  if (draft.mode === 'editing') {
    const area = h('textarea', {
      class: 'nv-field__control cp-draft__area',
      'aria-label': 'Retoucher le brouillon',
      rows: rowsOf(draft.text),
    });
    area.value = draft.text;
    area.addEventListener('input', () => {
      actions.editText(area.value);
    });
    const empty = draft.text.trim() === '';
    section.append(
      head,
      area,
      withheld !== null
        ? withheldLine(withheld)
        : h('p', { class: 'cp-draft__hint' }, 'Une bulle par ligne. Ctrl+Entrée copie le texte.'),
      h(
        'div',
        { class: 'cp-draft__actions cp-draft__actions--pair' },
        // « Annuler » first and the gesture on the right, as in the CRM's confirmations (V-EXT-14).
        h(
          'button',
          { type: 'button', class: 'nv-btn nv-btn--plain nv-btn--sm', 'data-gesture': 'cancel' },
          'Annuler',
        ),
        withheld !== null
          ? null
          : h(
              'button',
              {
                type: 'button',
                class: 'nv-btn nv-btn--sm cp-send',
                'data-gesture': 'place-edited',
                disabled: empty,
              },
              'Copier pour Reveal',
            ),
      ),
    );
    return section;
  }
  const shown = draft.done?.bubbles ?? draft.bubbles;
  const copied = draft.done?.outcome === 'placed' ? draft.done.copied : 0;
  // A draft he may not or no longer use is put out, so it never looks like one to place (Design, lot -1).
  const off = withheld !== null || draft.done?.outcome === 'rejected';
  const bubbles = h(
    'ol',
    { class: 'cp-bubbles', 'data-off': off ? 'true' : undefined },
    ...shown.map((bubble, index) =>
      index < copied
        ? h(
            'li',
            { class: 'cp-bubble', 'data-copied': 'true' },
            h('span', { class: 'cp-bubble__done' }, icon('check', 12), 'copiée'),
            bubble,
          )
        : h('li', { class: 'cp-bubble' }, bubble),
    ),
  );
  if (draft.mode === 'rejecting') {
    const note = h('input', {
      type: 'text',
      class: 'nv-field__control cp-draft__note',
      'aria-label': 'Note facultative',
      placeholder: 'Note facultative',
      maxlength: 1000,
    });
    // The question is written, and the reasons are one stop of the keyboard, walked with the arrows (V-EXT-20).
    const picked = draft.reason ?? REJECT_REASONS[0];
    section.append(
      head,
      bubbles,
      h('p', { class: 'cp-draft__hint', id: 'cp-reject-question' }, 'Pourquoi tu le refuses ?'),
      h(
        'div',
        { class: 'cp-draft__reasons', role: 'radiogroup', 'aria-labelledby': 'cp-reject-question' },
        ...REJECT_REASONS.map((reason) =>
          h(
            'button',
            {
              type: 'button',
              role: 'radio',
              class: 'nv-chip',
              'aria-checked': draft.reason === reason ? 'true' : 'false',
              tabindex: reason === picked ? 0 : -1,
              'data-reason': reason,
            },
            REJECT_WORDS[reason],
          ),
        ),
      ),
      note,
      h(
        'div',
        { class: 'cp-draft__actions cp-draft__actions--pair' },
        h(
          'button',
          { type: 'button', class: 'nv-btn nv-btn--plain nv-btn--sm', 'data-gesture': 'cancel' },
          'Annuler',
        ),
        h(
          'button',
          {
            type: 'button',
            class: 'nv-btn nv-btn--sm cp-send',
            'data-gesture': 'send-reject',
            disabled: draft.reason === null,
          },
          'Refuser',
        ),
      ),
    );
    return section;
  }
  section.append(head, bubbles);
  if (draft.done !== null) {
    section.append(...doneLines(draft.done));
    return section;
  }
  if (draft.placed) {
    section.append(
      h('p', { class: 'cp-draft__next' }, 'Déjà copié pour Reveal : il compte quand le message part.'),
    );
    return section;
  }
  const refuse = h(
    'button',
    { type: 'button', class: 'nv-btn nv-btn--plain nv-btn--sm', 'data-gesture': 'reject' },
    'Refuser ',
    key('R'),
  );
  if (withheld !== null) {
    // The one action left, on the secondary plate across the width: not a grey text that reads as off.
    refuse.className = 'nv-btn nv-btn--soft nv-btn--sm';
    section.append(withheldLine(withheld), h('div', { class: 'cp-draft__actions' }, refuse));
    return section;
  }
  const stopped = stops.length > 0 || saidAbove;
  if (stops.length > 0 && !saidAbove) section.insertBefore(stopsLine(stops), bubbles);
  section.append(
    h(
      'div',
      { class: 'cp-draft__actions' },
      // Charles's word (recette visuelle V-EXT-02): it says what it does, the text goes to the clipboard and the chatter
      // pastes and sends in Reveal himself; one verb for this gesture everywhere.
      h(
        'button',
        {
          type: 'button',
          // Under a stop the gesture is the secondary plate (V-EXT-03), outlined so it never reads as off (Design, lot
          // 0141-3): the sentence above asks to reread, the button still works.
          class: stopped
            ? 'nv-btn nv-btn--soft nv-btn--sm cp-place cp-place--quiet'
            : 'nv-btn nv-btn--sm cp-send cp-place',
          'data-gesture': 'place',
        },
        'Copier pour Reveal ',
        key('A'),
      ),
      // « Copier pour Reveal » is the one filled button; the two others are light (Design 16/11, lot 0141-3).
      h(
        'button',
        { type: 'button', class: 'nv-btn nv-btn--plain nv-btn--sm', 'data-gesture': 'edit' },
        'Retoucher ',
        key('E'),
      ),
      refuse,
    ),
  );
  return section;
}

function wire(root: ParentNode, actions: PanelActions): void {
  root.querySelector('[data-action="crm"]')?.addEventListener('click', actions.openCrm);
  root.querySelector('[data-action="more-signals"]')?.addEventListener('click', actions.showSignals);
  const on = (gesture: string, run: () => void): void => {
    root.querySelector(`[data-gesture="${gesture}"]`)?.addEventListener('click', run);
  };
  on('place', () => {
    actions.place(false);
  });
  on('place-edited', () => {
    actions.place(true);
  });
  on('copy-next', actions.copyNext);
  on('edit', actions.edit);
  on('reject', actions.reject);
  on('cancel', actions.cancel);
  on('send-reject', () => {
    const note = root.querySelector<HTMLInputElement>('.cp-draft__note');
    actions.sendReject(note?.value ?? '');
  });
  const chips = [...root.querySelectorAll<HTMLElement>('[data-reason]')];
  chips.forEach((chip, index) => {
    const reason = REJECT_REASONS.find((one) => one === chip.dataset['reason']);
    if (reason === undefined) return;
    chip.addEventListener('click', () => {
      actions.pickReason(reason);
    });
    // A radio group: the arrows pick the previous or the next reason, and the focus follows it.
    chip.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      const next = REJECT_REASONS[(index + step + REJECT_REASONS.length) % REJECT_REASONS.length];
      if (next !== undefined) actions.pickReason(next);
    });
  });
}

/** What a drawn draft shows, but the text being retouched: that text lives in its field, under his fingers. */
const drawnDrafts = new WeakMap<Element, string>();
const draftKey = (draft: DraftPart, stops: DraftStops): string =>
  JSON.stringify([draft.kind === 'ready' ? { ...draft, text: null } : draft, stops]);

/**
 * Where the keyboard is in the panel, as a selector of the same control drawn again (EXT-16): a group's line, a gesture,
 * a reason, the note. Our own names only, never a value of the card.
 */
function focusOf(root: HTMLElement): string | null {
  const active = root.ownerDocument.activeElement;
  if (!(active instanceof HTMLElement) || !root.contains(active)) return null;
  if (active.tagName === 'SUMMARY') {
    const group = active.closest<HTMLElement>('[data-group]')?.dataset['group'];
    return group === undefined ? null : `[data-group="${group}"] > summary`;
  }
  for (const name of ['gesture', 'reason', 'action'] as const) {
    const value = active.dataset[name];
    if (value !== undefined) return `[data-${name}="${value}"]`;
  }
  return active.classList.contains('cp-draft__note') ? '.cp-draft__note' : null;
}

function refocus(root: HTMLElement, selector: string | null): void {
  if (selector === null) return;
  const target = root.querySelector<HTMLElement>(selector);
  if (target !== null && root.ownerDocument.activeElement !== target) target.focus({ preventScroll: true });
}

/**
 * A cut the draft already says in its own line, right under it (« Ne plus lui écrire », limits not read): said once.
 * With no draft shown, the cut stands alone.
 */
function sameAsDraft(cut: CopilotCut | null, draft: DraftPart, withheld: Withheld | null): boolean {
  if (draft.kind !== 'ready' || withheld === null) return false;
  const saysIt = draft.mode === 'editing' || (draft.mode === 'idle' && draft.done === null && !draft.placed);
  if (!saysIt) return false;
  return (
    (cut === 'do_not_contact' && withheld === 'no_contact') ||
    (cut === 'limits_unread' && withheld === 'unread')
  );
}

/** What makes a draft new to his eyes: its bubbles. Picking a reason or retouching draws it again, it stays the same. */
const drawnBubbles = new WeakMap<Element, string>();
const bubblesOf = (draft: DraftPart): string =>
  draft.kind === 'ready' ? JSON.stringify(draft.bubbles) : draft.kind;

export function render(root: HTMLElement, screen: PanelScreen, actions: PanelActions): void {
  // The card scrolls; the band and the core above it stay in view (Design 16/11, lot 0141-3).
  const scroller = root.querySelector('.cp-scroll');
  const scroll = scroller?.scrollTop ?? 0;
  const focused = focusOf(root);
  if (screen.kind === 'conversation') {
    // Nothing of the sale while « où on en est » is read the first time: it may hold a cut (§ 9).
    const cut = screen.standing === null ? null : cutOf(screen.assist, screen.standing);
    const assist = screen.standing === null ? null : screen.assist;
    const fold = saleFold(assist, cut, screen.saleOpen, actions);
    // While his age is contested, what is intimate is masked, by the panel itself too (§ 9, closed by default).
    const ageCut = cut === 'age_doubt';
    // Under the core: the sale line, then him in brief, what is left to discover, the folded groups. With a long
    // draft, the sale line is what goes under the fold, never the button.
    const body = h(
      'div',
      { class: 'cp-scroll' },
      ...(fold === null ? [] : [fold]),
      ...cardPart(screen, actions, ageCut),
    );
    const withheld = withheldOf(screen.standing);
    // The core, right under the band: what to do, the draft and its copy, read without scrolling. A cut is said once:
    // by the draft when its own line already says it, otherwise by the sentence in the gesture's place, and the draft
    // then adds no line. It never lets the sale gesture through.
    const draftSaysCut = cut !== null && sameAsDraft(cut, screen.draft, withheld);
    const move = draftSaysCut ? null : moveBand(assist, cut, screen.standing?.band ?? null);
    const stops: DraftStops = {
      withheld,
      stops: screen.standing?.stops ?? [],
      saidAbove: cut !== null && !draftSaysCut,
      notes: assist === null ? [] : draftNotes(assist.reasons),
    };
    const band = statusBand(screen.fanName, screen.standing, assist, cut, screen.signalsOpen);
    const pinned = move === null ? [] : [move];
    const key = draftKey(screen.draft, stops);
    const shown = root.querySelector(':scope > .cp-draft');
    if (shown !== null && drawnDrafts.get(shown) === key) {
      // The same draft in the same state: it stays in place, never detached, so a field he types in keeps its focus,
      // its text and its caret while the rest is drawn again (recette du 16/11, EXT-01).
      for (const child of [...root.children]) if (child !== shown) child.remove();
      shown.before(band, ...pinned);
      shown.after(body);
      body.scrollTop = scroll;
      for (const node of [band, body, ...pinned]) wire(node, actions);
      refocus(root, focused);
      return;
    }
    // A reason picked draws the draft again: the note he started stays.
    const note = root.querySelector<HTMLInputElement>('.cp-draft__note')?.value ?? '';
    const draft = draftPart(screen.draft, stops, actions);
    if (draft !== null) {
      drawnDrafts.set(draft, key);
      drawnBubbles.set(draft, bubblesOf(screen.draft));
      // A new draft after another (his new message): only the core refreshes, in a short fade; the card stays still.
      if (
        shown !== null &&
        screen.draft.kind === 'ready' &&
        drawnBubbles.get(shown) !== bubblesOf(screen.draft)
      )
        for (const node of [draft, ...pinned]) node.dataset['fresh'] = 'true';
    }
    root.replaceChildren(band, ...pinned, ...(draft === null ? [] : [draft]), body);
    // Kept open groups keep their place: the panel draws over itself, without scrolling back up (§ 10).
    body.scrollTop = scroll;
    const kept = root.querySelector<HTMLInputElement>('.cp-draft__note');
    if (kept !== null) kept.value = note;
  } else {
    root.replaceChildren(
      h(
        'div',
        { class: 'cp-scroll' },
        screen.kind === 'loading'
          ? h('p', { class: 'cp-loading', 'aria-busy': 'true' }, 'Un instant…')
          : notice(screen.kind),
      ),
    );
  }
  wire(root, actions);
  refocus(root, focused);
}
