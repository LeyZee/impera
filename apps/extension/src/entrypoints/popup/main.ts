import '@impera/design-system/styles.css';
import './popup.css';

import { browser } from 'wxt/browser';

import {
  crmOriginOf,
  DEFAULT_CRM_ADDRESS,
  isGrantedAtInstall,
  permissionPatternOf,
} from '../../lib/crm-address';
import { readCrmSession } from '../../lib/session';
import { placeOf } from '../../lib/tab';

import { render, type Actions, type Screen } from './view';

/**
 * The popup's browser side (ADR 0066): the CRM address from chrome.storage.local, the session read from the CRM,
 * the open tab through activeTab. It opens tabs and asks the browser for a site; it never writes to the API.
 */

const ADDRESS_KEY = 'crmOrigin';
const LIGHT = window.matchMedia('(prefers-color-scheme: light)');

/** Nuit or Jour as the browser or the computer is set (ADR 0066 § 8). */
function applyTheme(): void {
  if (LIGHT.matches) document.documentElement.dataset['theme'] = 'light';
  else delete document.documentElement.dataset['theme'];
}
applyTheme();
LIGHT.addEventListener('change', applyTheme);

const root = document.getElementById('app');
if (root === null) throw new Error('popup: #app is missing');

let origin = DEFAULT_CRM_ADDRESS;
let screen: Screen = { kind: 'loading' };
let previous: Screen = screen;

function show(next: Screen): void {
  if (next.kind !== 'address') previous = next;
  screen = next;
  if (root === null) return;
  render(
    root,
    screen,
    { origin, version: browser.runtime.getManifest().version, hour: new Date().getHours() },
    actions,
  );
}

async function storedOrigin(): Promise<string> {
  const stored: Record<string, unknown> = await browser.storage.local.get(ADDRESS_KEY).catch(() => ({}));
  const value = stored[ADDRESS_KEY];
  return typeof value === 'string' ? (crmOriginOf(value) ?? DEFAULT_CRM_ADDRESS) : DEFAULT_CRM_ADDRESS;
}

async function allowed(at: string): Promise<boolean> {
  if (isGrantedAtInstall(at)) return true;
  return browser.permissions.contains({ origins: [permissionPatternOf(at)] }).catch(() => false);
}

async function activeTabUrl(): Promise<string | undefined> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  return tab?.url;
}

async function refresh(): Promise<void> {
  show({ kind: 'loading' });
  if (!(await allowed(origin))) {
    show({ kind: 'permission' });
    return;
  }
  const [session, url] = await Promise.all([readCrmSession(origin), activeTabUrl()]);
  switch (session.kind) {
    case 'signed_in':
      show({ kind: 'signed_in', me: session.me, place: placeOf(url, origin) });
      return;
    case 'signed_out':
      show({ kind: 'signed_out' });
      return;
    case 'second_factor_required':
      show({ kind: 'second_factor' });
      return;
    case 'unreachable':
      show({ kind: 'unreachable' });
      return;
  }
}

/**
 * Opens a page of the CRM: in the open tab when it already shows the CRM, else in the CRM tab of this window if
 * there is one, else in a new tab. The popup closes behind it.
 */
async function openCrm(path: string): Promise<void> {
  const url = `${origin}${path}`;
  const [active] = await browser.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  const [crmTab] = await browser.tabs
    .query({ url: permissionPatternOf(origin), currentWindow: true })
    .catch(() => []);
  const target = active?.url?.startsWith(`${origin}/`) === true ? active : crmTab;
  if (target?.id === undefined) await browser.tabs.create({ url });
  else await browser.tabs.update(target.id, { url, active: true });
  window.close();
}

/** Saves an address the person typed; a deployed CRM asks the browser for that site alone, in the same click. */
function saveAddress(value: string): void {
  const next = crmOriginOf(value);
  if (next === null) {
    show({
      kind: 'address',
      draft: value,
      error: 'Une adresse en https, ou localhost sur ce PC (exemple : crm.exemple.fr).',
    });
    return;
  }
  origin = next;
  // Stored first, without waiting: the permission request must stay inside the click (user gesture).
  void browser.storage.local.set({ [ADDRESS_KEY]: next });
  if (isGrantedAtInstall(next)) {
    void refresh();
    return;
  }
  void browser.permissions
    .request({ origins: [permissionPatternOf(next)] })
    .catch(() => false)
    .then(() => refresh());
  show({ kind: 'loading' });
}

const actions: Actions = {
  signIn: () => void openCrm('/'),
  open: (path) => void openCrm(path),
  retry: () => void refresh(),
  grant: () => {
    void browser.permissions
      .request({ origins: [permissionPatternOf(origin)] })
      .catch(() => false)
      .then(() => refresh());
  },
  editAddress: () => {
    show({ kind: 'address', draft: origin.replace(/^https?:\/\//u, ''), error: null });
  },
  saveAddress,
  resetAddress: () => {
    saveAddress(DEFAULT_CRM_ADDRESS);
  },
  cancelAddress: () => {
    show(previous);
  },
};

void storedOrigin().then((stored) => {
  origin = stored;
  return refresh();
});
