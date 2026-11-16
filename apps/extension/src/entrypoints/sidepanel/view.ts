import {
  REJECT_REASONS,
  type FanCardEntry,
  type FanCardFieldSpec,
  type FanCardGroup,
  type FanCardView,
  type RejectReason,
} from '@impera/contracts';

import {
  entryOf,
  ESSENTIALS,
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
  valueText,
} from '../../lib/copilot/card';
import { DESIRE_WORDS, REJECT_WORDS, type Standing } from '../../lib/copilot/standing';
import type { VerdictSent } from '../../lib/copilot/verdict';
import { h } from '../../lib/dom';

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
 * The agent's draft at the foot of the panel (§ 3.3), never above the card: a draft that arrives pushes nothing (§ 10).
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
    { title: string; text: string; tone?: 'amber' }
  >
> = {
  signed_out: {
    title: 'Connecte-toi au CRM',
    text: 'Le panneau lit la fiche du fan avec ta session du CRM.',
  },
  no_conversation: {
    title: 'Ouvre une conversation dans Reveal',
    text: 'Le panneau suit la conversation ouverte, sans clic de ta part.',
  },
  unknown: {
    title: 'Impera n’a pas encore lu cette conversation',
    text: 'Elle apparaîtra ici dès qu’Impera l’aura lue.',
  },
  off_shift: {
    title: 'Tu n’es pas en poste sur cette créatrice',
    text: 'Le panneau s’ouvre pendant ton shift.',
  },
  forbidden: {
    title: 'Cette créatrice ne t’est pas ouverte',
    text: 'Demande à ton responsable si c’est une erreur.',
  },
  conflict: {
    title: 'Deux créatrices ont cette conversation',
    text: 'Ouvre-la depuis le CRM pour savoir laquelle.',
    tone: 'amber',
  },
  down: { title: 'Le CRM ne répond pas', text: 'Le panneau réessaie tout seul.', tone: 'amber' },
};

function notice(kind: keyof typeof NOTICES): HTMLElement {
  const { title, text, tone } = NOTICES[kind];
  return h(
    'section',
    {
      class: 'cp-notice',
      'data-kind': kind,
      'data-tone': tone,
      role: tone === 'amber' ? 'status' : undefined,
    },
    h('p', { class: 'cp-notice__title' }, title),
    h('p', { class: 'cp-notice__text' }, text),
    kind === 'signed_out'
      ? h(
          'button',
          { type: 'button', class: 'nv-btn nv-btn--soft nv-btn--sm', 'data-action': 'crm' },
          'Ouvrir le CRM',
        )
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
 * A field in two lines (EXT-04): its label with where the value comes from, then the value. A source the field above
 * already said is not said again: `said` carries the last one shown in the list.
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
    current === null
      ? h(
          'span',
          { class: 'cp-field__empty' },
          spec.learning === 'observe' ? 'Pas encore deviné' : 'Pas encore su',
        )
      : h('span', { class: 'cp-field__value' }, valueText(spec.field, current.items)),
    current === null ? null : quote(current.sourceQuote),
    ...toCheck.map((value) =>
      h(
        'span',
        { class: 'cp-field__check' },
        `À vérifier : l’agent a lu « ${valueText(spec.field, value.items)} »`,
        quote(value.sourceQuote),
      ),
    ),
  );
}

/**
 * Who he is in one line, « Alpha · 34 ans · Lyon », and where it comes from said once (EXT-04): three words read in
 * one glance instead of nine lines. A part not known yet is said as a question, in the faint ink.
 */
function identity(card: FanCardView, marks: Marks): HTMLElement {
  const entries = IDENTITY.map((name) => ({ name, entry: entryOf(card.fields, name) }));
  const line = h('span', { class: 'cp-ident__line' });
  if (entries.every(({ entry }) => entry.current === null))
    line.append(h('span', { class: 'cp-field__empty' }, 'Prénom, âge et ville pas encore sus'));
  else
    entries.forEach(({ name, entry }, index) => {
      if (index > 0) line.append(h('span', { class: 'cp-ident__dot', 'aria-hidden': 'true' }, '·'));
      const label = specOf(name)?.label;
      line.append(
        entry.current === null
          ? h(
              'span',
              { class: 'cp-field__empty', 'data-field': name, title: label },
              `${IDENTITY_WORDS[name]} ?`,
            )
          : h(
              'span',
              { class: 'cp-field__value', 'data-field': name, title: label },
              identityText(name, entry.current.items),
            ),
      );
    });
  const fresh = entries.some(({ entry }) => entry.current !== null && isNew(entry.current.observedAt, marks));
  return h(
    'li',
    { class: 'cp-field cp-ident', 'data-field': 'identity', 'aria-label': 'Prénom, âge et ville' },
    h('span', { class: 'cp-field__top' }, line, fresh ? newMark() : null),
    ...identitySources(card.fields, marks.now).map((text) => h('span', { class: 'cp-field__source' }, text)),
    ...entries.map(({ name, entry }) => quote(entry.current?.sourceQuote ?? null, IDENTITY_WORDS[name])),
    ...entries.flatMap(({ name, entry }) =>
      entry.toCheck.map((value) =>
        h(
          'span',
          { class: 'cp-field__check' },
          `À vérifier, ${IDENTITY_WORDS[name]} : l’agent a lu « ${valueText(name, value.items)} »`,
          quote(value.sourceQuote),
        ),
      ),
    ),
  );
}

function cardNodes(
  card: FanCardView,
  openGroups: ReadonlySet<FanCardGroup>,
  marks: Marks,
  actions: PanelActions,
): HTMLElement[] {
  const checks = toCheckCount(card.fields);
  const said: { last: string | null } = { last: null };
  const essentials = [
    identity(card, marks),
    ...ESSENTIALS.filter((name) => !IDENTITY.some((part) => part === name))
      .map((name) => {
        const spec = specOf(name);
        return spec === undefined ? null : field(spec, entryOf(card.fields, name), marks, said);
      })
      .filter((node): node is HTMLElement => node !== null),
  ];
  return [
    h(
      'header',
      { class: 'cp-head' },
      h('h1', { class: 'cp-head__title' }, 'Fiche du fan'),
      checks === 0 ? null : h('span', { class: 'cp-head__check' }, `${String(checks)} à vérifier`),
    ),
    h('ul', { class: 'cp-fields cp-fields--essentials', 'aria-label': 'L’essentiel' }, ...essentials),
    ...PANEL_GROUPS.map(({ group, title }) => {
      const groupSaid: { last: string | null } = { last: null };
      const details = h(
        'details',
        { class: 'cp-group', 'data-group': group, open: openGroups.has(group) },
        h(
          'summary',
          {},
          h('span', { class: 'cp-group__title' }, title),
          h('span', { class: 'cp-group__sum' }, groupLine(card.fields, group)),
        ),
        h(
          'ul',
          { class: 'cp-fields' },
          ...restOf(group).map((spec) => field(spec, entryOf(card.fields, spec.field), marks, groupSaid)),
        ),
      );
      details.addEventListener('toggle', () => {
        actions.toggleGroup(group, details.open);
      });
      return details;
    }),
  ];
}

/**
 * « Où on en est », one line (§ 3.1): red for what forbids the sale, amber for what holds it back, then his desire.
 * Nothing to say is said, so a chatter knows it was read.
 */
function standingLine(standing: Standing | null): HTMLElement {
  if (standing === null) return h('p', { class: 'cp-standing', 'aria-busy': 'true' }, '…');
  const parts: HTMLElement[] = [
    ...standing.stops.map((text) => h('span', { class: 'cp-standing__stop' }, text)),
    ...standing.cares.map((text) => h('span', { class: 'cp-standing__care' }, text)),
  ];
  if (standing.unread) parts.push(h('span', { class: 'cp-standing__care' }, 'Limites non lues'));
  if (parts.length === 0) parts.push(h('span', { class: 'cp-standing__calm' }, 'Rien à signaler'));
  if (standing.band !== null)
    parts.push(
      h(
        'span',
        { class: 'cp-standing__band' },
        `désir ${DESIRE_WORDS[standing.band]}${standing.band === 'playful' ? ' 😏' : standing.band === 'hot' ? ' 🔥' : ''}`,
      ),
    );
  const line = h('p', { class: 'cp-standing', 'aria-label': 'Où on en est' });
  parts.forEach((part, index) => {
    if (index > 0) line.append(h('span', { class: 'cp-standing__dot', 'aria-hidden': 'true' }, '·'));
    line.append(part);
  });
  return line;
}

function cardPart(
  screen: Extract<PanelScreen, { kind: 'conversation' }>,
  actions: PanelActions,
): HTMLElement[] {
  if (!screen.cardOn)
    return [
      h(
        'section',
        { class: 'cp-notice', 'data-kind': 'card_off' },
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
  return cardNodes(screen.card, screen.openGroups, { now: screen.now, newSince: screen.newSince }, actions);
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
    lines.push(
      h(
        'p',
        { class: 'cp-draft__next' },
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
    unlinked: 'Ce geste n’a pas compté : relie l’extension dans son popup (« Relier »).',
    refused: 'Ce brouillon n’est plus à jour : l’agent en refait un.',
    unreachable: 'Le CRM ne répond pas : ce geste n’a pas compté.',
  };
  const text = status[done.sent];
  if (text !== null) lines.push(h('p', { class: 'cp-draft__warn', role: 'status' }, text));
  return lines;
}

/** « Ne plus lui écrire » (EXT-05): red, the limit forbids; only the refusal is left to the chatter. */
const noContactLine = (): HTMLElement =>
  h(
    'p',
    { class: 'cp-draft__stop', role: 'status' },
    'Ne plus lui écrire : rien ne part vers lui. Refuse ce brouillon.',
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

function draftPart(draft: DraftPart, noContact: boolean, actions: PanelActions): HTMLElement | null {
  if (draft.kind === 'hidden') return null;
  if (draft.kind === 'writing')
    return h(
      'section',
      { class: 'cp-draft', 'aria-label': 'Brouillon de l’agent', 'data-state': 'writing' },
      h('p', { class: 'cp-draft__writing' }, 'L’agent écrit…'),
    );
  const head = h(
    'header',
    { class: 'cp-draft__head' },
    h('span', { class: 'cp-draft__title' }, 'Brouillon de l’agent'),
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
      noContact
        ? noContactLine()
        : h('p', { class: 'cp-draft__hint' }, 'Une bulle par ligne. Ctrl+Entrée copie le texte.'),
      h(
        'div',
        { class: 'cp-draft__actions' },
        noContact
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
        h(
          'button',
          { type: 'button', class: 'nv-btn nv-btn--plain nv-btn--sm', 'data-gesture': 'cancel' },
          'Annuler',
        ),
      ),
    );
    return section;
  }
  const shown = draft.done?.bubbles ?? draft.bubbles;
  const copied = draft.done?.outcome === 'placed' ? draft.done.copied : 0;
  const bubbles = h(
    'ol',
    { class: 'cp-bubbles' },
    ...shown.map((bubble, index) =>
      h('li', { class: 'cp-bubble', 'data-copied': index < copied ? 'true' : undefined }, bubble),
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
    section.append(
      head,
      bubbles,
      h(
        'div',
        { class: 'cp-draft__reasons', role: 'radiogroup', 'aria-label': 'Pourquoi tu le refuses' },
        ...REJECT_REASONS.map((reason) =>
          h(
            'button',
            {
              type: 'button',
              role: 'radio',
              class: 'nv-chip',
              'aria-checked': draft.reason === reason ? 'true' : 'false',
              'data-reason': reason,
            },
            REJECT_WORDS[reason],
          ),
        ),
      ),
      note,
      h(
        'div',
        { class: 'cp-draft__actions' },
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
        h(
          'button',
          { type: 'button', class: 'nv-btn nv-btn--plain nv-btn--sm', 'data-gesture': 'cancel' },
          'Annuler',
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
      h('p', { class: 'cp-draft__next' }, 'Placé dans Reveal : il compte quand ton message part.'),
    );
    return section;
  }
  const refuse = h(
    'button',
    { type: 'button', class: 'nv-btn nv-btn--plain nv-btn--sm', 'data-gesture': 'reject' },
    'Refuser ',
    key('R'),
  );
  if (noContact) {
    section.append(noContactLine(), h('div', { class: 'cp-draft__actions' }, refuse));
    return section;
  }
  section.append(
    h(
      'div',
      { class: 'cp-draft__actions' },
      // It copies, it does not send: the chatter sends in Reveal himself (EXT-13).
      h(
        'button',
        { type: 'button', class: 'nv-btn nv-btn--sm cp-send', 'data-gesture': 'place' },
        'Copier pour Reveal ',
        key('A'),
      ),
      h(
        'button',
        { type: 'button', class: 'nv-btn nv-btn--soft nv-btn--sm', 'data-gesture': 'edit' },
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
  for (const chip of root.querySelectorAll<HTMLElement>('[data-reason]')) {
    const reason = REJECT_REASONS.find((one) => one === chip.dataset['reason']);
    if (reason !== undefined)
      chip.addEventListener('click', () => {
        actions.pickReason(reason);
      });
  }
}

/** What a drawn draft shows, but the text being retouched: that text lives in its field, under his fingers. */
const drawnDrafts = new WeakMap<Element, string>();
const draftKey = (draft: DraftPart, noContact: boolean): string =>
  JSON.stringify([draft.kind === 'ready' ? { ...draft, text: null } : draft, noContact]);

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

/** Which conversation the panel shows: his name on the platform (EXT-14), in a band that never scrolls. */
function whoBand(fanName: string | null): HTMLElement | null {
  return fanName === null
    ? null
    : h('header', { class: 'cp-who' }, h('span', { class: 'cp-who__fan' }, fanName));
}

export function render(root: HTMLElement, screen: PanelScreen, actions: PanelActions): void {
  // The card scrolls; « où on en est » above it and the draft under it stay in view (§ 10).
  const scroller = root.querySelector('.cp-scroll');
  const scroll = scroller?.scrollTop ?? 0;
  const focused = focusOf(root);
  if (screen.kind === 'conversation') {
    const body = h('div', { class: 'cp-scroll' }, ...cardPart(screen, actions));
    const noContact = screen.standing?.noContact === true;
    const top = [whoBand(screen.fanName), standingLine(screen.standing)].filter(
      (node): node is HTMLElement => node !== null,
    );
    const key = draftKey(screen.draft, noContact);
    const shown = root.querySelector(':scope > .cp-draft');
    if (shown !== null && drawnDrafts.get(shown) === key) {
      // The same draft in the same state: it stays in place, never detached, so a field he types in keeps its focus,
      // its text and its caret while the card above it is drawn again (recette du 16/11, EXT-01).
      for (const child of [...root.children]) if (child !== shown) child.remove();
      shown.before(...top, body);
      body.scrollTop = scroll;
      for (const node of [...top, body]) wire(node, actions);
      refocus(root, focused);
      return;
    }
    // A reason picked draws the draft again: the note he started stays.
    const note = root.querySelector<HTMLInputElement>('.cp-draft__note')?.value ?? '';
    const draft = draftPart(screen.draft, noContact, actions);
    if (draft !== null) drawnDrafts.set(draft, key);
    root.replaceChildren(...top, body, ...(draft === null ? [] : [draft]));
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
