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
      /** « Où on en est » (§ 3.1); null while it is read the first time. */
      readonly standing: Standing | null;
      /** Her switch « Fiche du fan dans l'extension » (§ 6). */
      readonly cardOn: boolean;
      /** Null while it is read the first time. */
      readonly card: FanCardView | 'forbidden' | 'down' | null;
      readonly openGroups: ReadonlySet<FanCardGroup>;
      readonly draft: DraftPart;
      readonly now: Date;
    };

/** What a gesture left: the text copied for Reveal, and whether the gesture counted on the server. */
export interface GestureDone {
  readonly outcome: 'placed' | 'rejected';
  /** The text could not be put in the clipboard: it stays selectable above. */
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

/** His words a value rests on (ADR 0085 § 5): shown as his, after « Il a écrit ». */
function quote(text: string | null): HTMLElement | null {
  return text === null ? null : h('span', { class: 'cp-field__quote' }, 'Il a écrit : ', h('q', {}, text));
}

function field(spec: FanCardFieldSpec, entry: FanCardEntry, now: Date): HTMLElement {
  const { current, toCheck } = entry;
  return h(
    'li',
    { class: 'cp-field', 'data-field': spec.field },
    h('span', { class: 'cp-field__label' }, spec.label),
    current === null
      ? h(
          'span',
          { class: 'cp-field__empty' },
          spec.learning === 'observe' ? 'Pas encore deviné' : 'Pas encore su',
        )
      : h('span', { class: 'cp-field__value' }, valueText(spec.field, current.items)),
    current === null ? null : h('span', { class: 'cp-field__source' }, sourceLine(current, now)),
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

function cardNodes(
  card: FanCardView,
  openGroups: ReadonlySet<FanCardGroup>,
  now: Date,
  actions: PanelActions,
): HTMLElement[] {
  const checks = toCheckCount(card.fields);
  const essentials = ESSENTIALS.map((name) => {
    const spec = specOf(name);
    return spec === undefined ? null : field(spec, entryOf(card.fields, name), now);
  }).filter((node): node is HTMLElement => node !== null);
  return [
    h(
      'header',
      { class: 'cp-head' },
      h('h1', { class: 'cp-head__title' }, 'Fiche du fan'),
      checks === 0 ? null : h('span', { class: 'cp-head__check' }, `${String(checks)} à vérifier`),
    ),
    h('ul', { class: 'cp-fields cp-fields--essentials', 'aria-label': 'L’essentiel' }, ...essentials),
    ...PANEL_GROUPS.map(({ group, title }) => {
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
          ...restOf(group).map((spec) => field(spec, entryOf(card.fields, spec.field), now)),
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
        h('p', { class: 'cp-notice__text' }, 'Elle s’allume dans Créatrices › Agent.'),
      ),
    ];
  if (screen.card === null)
    return [h('p', { class: 'cp-loading', 'aria-busy': 'true' }, 'Lecture de la fiche…')];
  if (screen.card === 'forbidden') return [notice('forbidden')];
  if (screen.card === 'down') return [notice('down')];
  return cardNodes(screen.card, screen.openGroups, screen.now, actions);
}

const key = (letter: string): HTMLElement => h('span', { class: 'nv-kbd' }, letter);

/** What a gesture left, in one or two quiet lines: the next step in Reveal, and whether it counted (§ 5, § 8). */
function doneLines(done: GestureDone): HTMLElement[] {
  const lines: HTMLElement[] = [];
  if (done.outcome === 'placed')
    lines.push(
      h(
        'p',
        { class: 'cp-draft__next' },
        done.copyFailed
          ? 'Le texte n’a pas pu être copié : sélectionne-le ci-dessus, colle-le dans Reveal et envoie.'
          : 'Texte copié : colle-le dans Reveal (Ctrl+V), relis, et envoie.',
      ),
    );
  else lines.push(h('p', { class: 'cp-draft__next' }, 'Refusé : écris ta propre réponse dans Reveal.'));
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

function draftPart(draft: DraftPart, actions: PanelActions): HTMLElement | null {
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
      rows: Math.min(6, Math.max(2, draft.text.split('\n').length)),
    });
    area.value = draft.text;
    area.addEventListener('input', () => {
      actions.editText(area.value);
    });
    const empty = draft.text.trim() === '';
    section.append(
      head,
      area,
      h('p', { class: 'cp-draft__hint' }, 'Une bulle par ligne. Ctrl+Entrée place le texte.'),
      h(
        'div',
        { class: 'cp-draft__actions' },
        h(
          'button',
          {
            type: 'button',
            class: 'nv-btn nv-btn--sm cp-send',
            'data-gesture': 'place-edited',
            disabled: empty,
          },
          'Placer dans Reveal',
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
  const bubbles = h(
    'ol',
    { class: 'cp-bubbles' },
    ...draft.bubbles.map((bubble) => h('li', { class: 'cp-bubble' }, bubble)),
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
  section.append(
    h(
      'div',
      { class: 'cp-draft__actions' },
      h(
        'button',
        { type: 'button', class: 'nv-btn nv-btn--sm cp-send', 'data-gesture': 'place' },
        'Envoyer ',
        key('A'),
      ),
      h(
        'button',
        { type: 'button', class: 'nv-btn nv-btn--soft nv-btn--sm', 'data-gesture': 'edit' },
        'Retoucher ',
        key('E'),
      ),
      h(
        'button',
        { type: 'button', class: 'nv-btn nv-btn--plain nv-btn--sm', 'data-gesture': 'reject' },
        'Refuser ',
        key('R'),
      ),
    ),
  );
  return section;
}

function wire(root: HTMLElement, actions: PanelActions): void {
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

export function render(root: HTMLElement, screen: PanelScreen, actions: PanelActions): void {
  // The card scrolls; « où on en est » above it and the draft under it stay in view (§ 10).
  const scroller = root.querySelector('.cp-scroll');
  const scroll = scroller?.scrollTop ?? 0;
  const note = root.querySelector<HTMLInputElement>('.cp-draft__note')?.value ?? '';
  if (screen.kind === 'conversation') {
    const body = h('div', { class: 'cp-scroll' }, ...cardPart(screen, actions));
    const draft = draftPart(screen.draft, actions);
    root.replaceChildren(standingLine(screen.standing), body, ...(draft === null ? [] : [draft]));
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
}
