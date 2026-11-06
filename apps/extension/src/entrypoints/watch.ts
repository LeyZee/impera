import { browser } from 'wxt/browser';

import { FromReaderSchema, HelloAnswerSchema, ToReaderSchema, type FromReader } from '../lib/watch/protocol';
import { WatchReader } from '../lib/watch/runtime';

/**
 * The watch's reader on instagram.com (VEI-02). Registered by the service worker once the browser allows
 * instagram.com, in the extension's isolated world, top frame only, never on messages, stories or account pages
 * (`watch-script.ts`). Idle until « Veille » starts in its tab. Built as an unlisted script, not a WXT content script:
 * WXT's content-script wrapper posts a message to the page and fires events on its document, which the page can hear.
 */
export default defineUnlistedScript(() => {
  const send = (message: FromReader): void => {
    void browser.runtime.sendMessage(FromReaderSchema.parse(message)).catch(() => undefined);
  };
  const reader = new WatchReader({ document, location, send });

  browser.runtime.onMessage.addListener((raw: unknown, sender, respond: (answer: unknown) => void) => {
    // Only the extension's own service worker talks to the reader.
    if (sender.id !== browser.runtime.id) return false;
    const message = ToReaderSchema.safeParse(raw);
    if (!message.success) return false;
    switch (message.data.type) {
      case 'watch/start':
        reader.start();
        respond({ ok: true });
        return false;
      case 'watch/stop':
        reader.stop();
        respond({ ok: true });
        return false;
      case 'watch/on-screen':
        respond({ onScreen: reader.onScreen() });
        return false;
    }
  });

  addEventListener('pagehide', () => {
    reader.flush();
  });
  addEventListener('visibilitychange', () => {
    reader.scan();
  });

  void browser.runtime
    .sendMessage({ type: 'watch/hello' } satisfies FromReader)
    .then((answer: unknown) => {
      if (HelloAnswerSchema.safeParse(answer).data?.watching === true) reader.start();
    })
    .catch(() => undefined);
});
