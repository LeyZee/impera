import type { ScriptCardPreviewBody } from '@impera/contracts';
import { useEffect, useState } from 'react';

import { previewCard } from './api';

/** How long the typing rests before the card is drawn again: one call per pause, not per key. */
const REST_MS = 250;

/**
 * The card of the segment being written, as an image address (`data:image/svg+xml`), drawn again a quarter second after
 * the last change. The last card drawn stays on screen while a field is empty: `waiting` says the card is behind.
 */
export function usePreview(body: ScriptCardPreviewBody | null): { src: string | null; waiting: boolean } {
  const [src, setSrc] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const wanted = body === null ? null : JSON.stringify(body);

  useEffect(() => {
    if (wanted === null || body === null) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void previewCard(body, controller.signal).then((svg) => {
        if (controller.signal.aborted) return;
        if (svg === null) {
          setWaiting(true);
          return;
        }
        setSrc(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
        setWaiting(false);
      });
    }, REST_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `wanted` stands for `body`: a new object with the same content draws nothing again.
  }, [wanted]);

  return { src, waiting };
}
