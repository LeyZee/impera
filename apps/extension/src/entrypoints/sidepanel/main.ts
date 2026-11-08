import '@impera/design-system/styles.css';
import './sidepanel.css';

import { FanCardGroupSchema, type FanCardGroup } from '@impera/contracts';
import { browser } from 'wxt/browser';

import { readDraftView, readFanCard, type CardRead } from '../../lib/copilot/api';
import { openConversationOf } from '../../lib/copilot/open-conversation';
import { storedOrigin } from '../../lib/crm-origin-store';

import { render, type PanelScreen } from './view';

/**
 * The copilot side panel's browser side (ADR 0086, lot b): it follows the conversation open in Reveal in this window,
 * reads with the CRM's session what Impera knows of it every 5 s while the panel is shown, and the fan's card after.
 * It never touches Reveal's page, never takes the focus, makes no sound (§ 10). The draft and its gestures come next.
 */

const DRAFT_EVERY_MS = 5_000;
const CARD_EVERY_MS = 30_000;
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
let openGroups = new Set<FanCardGroup>();
let screen: PanelScreen = { kind: 'loading' };
let drawn = '';
/** Each read carries the turn it started on: a late answer for a conversation left since is dropped. */
let turn = 0;

const actions = {
  openCrm: () => void browser.tabs.create({ url: `${origin}/` }),
  toggleGroup: (group: FanCardGroup, open: boolean) => {
    if (open === openGroups.has(group)) return;
    openGroups = new Set(openGroups);
    if (open) openGroups.add(group);
    else openGroups.delete(group);
    void browser.storage.local.set({ [GROUPS_KEY]: [...openGroups] }).catch(() => undefined);
  },
};

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
    cardOn,
    card: card === null ? null : card.kind === 'card' ? card.card : card.kind,
    openGroups,
    now: new Date(),
  };
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
  const { creatorId, fanId, switches } = read.view.conversation;
  if (fan?.fanId !== fanId || fan.creatorId !== creatorId) {
    fan = { creatorId, fanId };
    card = null;
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
