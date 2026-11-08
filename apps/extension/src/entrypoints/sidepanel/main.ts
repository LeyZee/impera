import '@impera/design-system/styles.css';
import './sidepanel.css';

import {
  FanCardGroupSchema,
  type CopilotDraftView,
  type CopilotVerdictBody,
  type DraftId,
  type FanCardGroup,
  type RejectReason,
} from '@impera/contracts';
import { browser } from 'wxt/browser';

import { readDraftView, readFanCard, readStanding, type CardRead } from '../../lib/copilot/api';
import { openConversationOf } from '../../lib/copilot/open-conversation';
import { standingOf, type Standing } from '../../lib/copilot/standing';
import { VerdictSentSchema, type FromPanel } from '../../lib/copilot/verdict';
import { storedOrigin } from '../../lib/crm-origin-store';

import { render, type DraftPart, type GestureDone, type PanelScreen } from './view';

/**
 * The copilot side panel's browser side (ADR 0086, lot b): it follows the conversation open in Reveal in this window,
 * reads with the CRM's session what Impera knows of it every 5 s while the panel is shown, and the fan's card after.
 * It never touches Reveal's page, never takes the focus, makes no sound (§ 10). The draft's gestures copy the text for
 * Reveal (the field itself is written once the Reveal capture says where it is, § 4) and are counted through the
 * service worker, which holds the person's link (§ 8).
 */

const DRAFT_EVERY_MS = 5_000;
const CARD_EVERY_MS = 30_000;
const STANDING_EVERY_MS = 30_000;
const GROUPS_KEY = 'copilotOpenGroups';
const LIGHT = window.matchMedia('(prefers-color-scheme: light)');

function applyTheme(): void {
  if (LIGHT.matches) document.documentElement.dataset['theme'] = 'light';
  else delete document.documentElement.dataset['theme'];
}
applyTheme();
LIGHT.addEventListener('change', applyTheme);

const root = document.getElementById('app');
if (root === null) throw new Error('sidepanel: #app is missing');

let origin = '';
let windowId: number | undefined;
let conversationId: string | null = null;
let fan: { creatorId: string; fanId: string } | null = null;
let card: CardRead | null = null;
let cardReadAt = 0;
let standing: Standing | null = null;
let standingReadAt = 0;
let view: Extract<CopilotDraftView, { conversation: unknown }> | null = null;
/** The chatter's gesture on the draft shown; dropped when another draft takes its place. */
interface Gesture {
  readonly draftId: DraftId;
  readonly mode: 'idle' | 'editing' | 'rejecting';
  readonly text: string;
  readonly reason: RejectReason | null;
  readonly done: GestureDone | null;
}
let gesture: Gesture | null = null;
let openGroups = new Set<FanCardGroup>();
let screen: PanelScreen = { kind: 'loading' };
let drawn = '';
/** Each read carries the turn it started on: a late answer for a conversation left since is dropped. */
let turn = 0;

function setGesture(next: Gesture): void {
  gesture = next;
  redraw();
}

async function count(draftId: DraftId, body: CopilotVerdictBody): Promise<void> {
  const message: FromPanel = { type: 'panel/verdict', draftId, body };
  const answer: unknown = await browser.runtime.sendMessage(message).catch(() => 'unreachable');
  const sent = VerdictSentSchema.safeParse(answer);
  if (gesture?.draftId !== draftId || gesture.done === null) return;
  setGesture({ ...gesture, done: { ...gesture.done, sent: sent.success ? sent.data : 'unreachable' } });
}

/** `a` or `e` (§ 4): the text goes to Reveal, here through the clipboard, and the chatter sends it himself. */
async function place(edited: boolean): Promise<void> {
  if (view?.state !== 'ready' || gesture?.done !== null) return;
  const { draftId } = gesture;
  const bubbles = edited
    ? gesture.text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')
    : view.draft.bubbles;
  if (bubbles.length === 0) return;
  const copyFailed = await navigator.clipboard.writeText(bubbles.join('\n')).then(
    () => false,
    () => true,
  );
  setGesture({ ...gesture, mode: 'idle', done: { outcome: 'placed', copyFailed, sent: 'sending' } });
  await count(draftId, { kind: 'placed', creatorId: view.conversation.creatorId, edited });
}

const actions = {
  openCrm: () => void browser.tabs.create({ url: `${origin}/` }),
  toggleGroup: (group: FanCardGroup, open: boolean) => {
    if (open === openGroups.has(group)) return;
    openGroups = new Set(openGroups);
    if (open) openGroups.add(group);
    else openGroups.delete(group);
    void browser.storage.local.set({ [GROUPS_KEY]: [...openGroups] }).catch(() => undefined);
  },
  place: (edited: boolean) => void place(edited),
  edit: () => {
    if (view?.state !== 'ready' || gesture?.done !== null) return;
    setGesture({ ...gesture, mode: 'editing', text: view.draft.bubbles.join('\n') });
    document.querySelector<HTMLTextAreaElement>('.cp-draft__area')?.focus();
  },
  editText: (text: string) => {
    // Kept without a redraw: the field under his fingers is never drawn again while he types.
    if (gesture !== null) gesture = { ...gesture, text };
    const button = document.querySelector<HTMLButtonElement>('[data-gesture="place-edited"]');
    if (button !== null) button.disabled = text.trim() === '';
  },
  reject: () => {
    if (gesture?.done !== null) return;
    setGesture({ ...gesture, mode: 'rejecting' });
  },
  pickReason: (reason: RejectReason) => {
    if (gesture !== null) setGesture({ ...gesture, reason });
  },
  sendReject: (note: string) => {
    if (view?.state !== 'ready' || gesture?.reason == null || gesture.done !== null) return;
    const { draftId, reason } = gesture;
    const trimmed = note.trim();
    setGesture({
      ...gesture,
      mode: 'idle',
      done: { outcome: 'rejected', copyFailed: false, sent: 'sending' },
    });
    void count(draftId, {
      kind: 'rejected',
      creatorId: view.conversation.creatorId,
      reason,
      ...(trimmed === '' ? {} : { note: trimmed.slice(0, 1000) }),
    });
  },
  cancel: () => {
    if (gesture !== null) setGesture({ ...gesture, mode: 'idle', reason: null });
  },
};

/** The shortcuts work once the panel has the focus; it never takes Reveal's focus by itself (§ 10). */
document.addEventListener('keydown', (event) => {
  const typing = event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement;
  if (event.key === 'Escape' && gesture !== null && gesture.mode !== 'idle') {
    actions.cancel();
    return;
  }
  if (typing) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && gesture?.mode === 'editing') {
      event.preventDefault();
      actions.place(true);
    }
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || gesture?.mode !== 'idle') return;
  const run = {
    a: () => {
      actions.place(false);
    },
    e: actions.edit,
    r: actions.reject,
  }[event.key.toLowerCase()];
  if (run === undefined) return;
  event.preventDefault();
  run();
});

function draftPart(): DraftPart {
  if (view === null || view.state === 'off' || view.state === 'none') return { kind: 'hidden' };
  if (view.state === 'writing') return { kind: 'writing' };
  const { draft } = view;
  if (gesture?.draftId !== draft.draftId)
    gesture = { draftId: draft.draftId, mode: 'idle', text: '', reason: null, done: null };
  return {
    kind: 'ready',
    bubbles: draft.bubbles,
    placed: draft.placedAt !== null,
    mode: gesture.mode,
    text: gesture.text,
    reason: gesture.reason,
    done: gesture.done,
  };
}

/** Draws only what changed: an answer equal to the last one leaves the panel as it is, under his eyes (§ 10). */
function show(next: PanelScreen): void {
  screen = next;
  const key = JSON.stringify(next, (name, value: unknown) =>
    name === 'now' ? undefined : value instanceof Set ? [...value] : value,
  );
  if (key === drawn || root === null) return;
  drawn = key;
  render(root, screen, actions);
}

function cardScreen(cardOn: boolean): PanelScreen {
  return {
    kind: 'conversation',
    standing,
    cardOn,
    card: card === null ? null : card.kind === 'card' ? card.card : card.kind,
    openGroups,
    draft: draftPart(),
    now: new Date(),
  };
}

function redraw(): void {
  if (screen.kind === 'conversation' && view !== null) show(cardScreen(view.conversation.switches.fanCard));
}

async function activeUrl(): Promise<string | undefined> {
  const [tab] = await browser.tabs.query({ active: true, windowId }).catch(() => []);
  return tab?.url;
}

async function refresh(): Promise<void> {
  turn += 1;
  const mine = turn;
  const next = openConversationOf(await activeUrl());
  if (next !== conversationId) {
    conversationId = next;
    fan = null;
    card = null;
    standing = null;
    view = null;
    gesture = null;
  }
  if (conversationId === null) {
    show({ kind: 'no_conversation' });
    return;
  }
  const read = await readDraftView(origin, conversationId, null);
  if (mine !== turn) return;
  if (read.kind !== 'view') {
    show({ kind: read.kind });
    return;
  }
  if (read.view.state === 'unknown') {
    show({ kind: 'unknown' });
    return;
  }
  view = read.view;
  const { creatorId, fanId, switches } = read.view.conversation;
  if (fan?.fanId !== fanId || fan.creatorId !== creatorId) {
    fan = { creatorId, fanId };
    card = null;
    standing = null;
  }
  if (standing === null || Date.now() - standingReadAt >= STANDING_EVERY_MS) {
    const answer = await readStanding(origin, creatorId, read.view.conversation.conversationId, fanId);
    if (mine !== turn) return;
    standing = standingOf(answer.flags, answer.band);
    standingReadAt = Date.now();
  }
  if (!switches.fanCard) {
    show(cardScreen(false));
    return;
  }
  if (card === null || Date.now() - cardReadAt >= CARD_EVERY_MS) {
    if (card === null) show(cardScreen(true));
    const answer = await readFanCard(origin, creatorId, fanId);
    if (mine !== turn) return;
    card = answer;
    cardReadAt = Date.now();
  }
  show(cardScreen(true));
}

let timer: ReturnType<typeof setInterval> | undefined;

/** Reads every 5 s while the panel is shown, never while it is hidden (§ 9). */
function schedule(): void {
  clearInterval(timer);
  if (document.visibilityState !== 'visible') return;
  timer = setInterval(() => void refresh(), DRAFT_EVERY_MS);
  void refresh();
}

async function start(): Promise<void> {
  origin = await storedOrigin();
  // In the browser's side panel, its own window; in the small window of the fallback, the one it was opened from.
  const asked = Number(new URLSearchParams(window.location.search).get('window'));
  windowId =
    Number.isInteger(asked) && asked > 0
      ? asked
      : (await browser.windows.getCurrent().catch(() => undefined))?.id;
  const stored: Record<string, unknown> = await browser.storage.local.get(GROUPS_KEY).catch(() => ({}));
  const groups = FanCardGroupSchema.array().safeParse(stored[GROUPS_KEY]);
  if (groups.success) openGroups = new Set(groups.data);
  // Zero gesture to follow (§ 10): another tab, another conversation in the same tab, and the fan changes.
  browser.tabs.onActivated.addListener((info) => {
    if (info.windowId === windowId) void refresh();
  });
  browser.tabs.onUpdated.addListener((_id, change, tab) => {
    if (tab.active && tab.windowId === windowId && change.url !== undefined) void refresh();
  });
  document.addEventListener('visibilitychange', schedule);
  schedule();
}

void start();
