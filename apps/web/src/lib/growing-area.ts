import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Whether the browser grows a text field with its text by itself (Chromium, Edge, Safari 18.4+). */
const SIZED_BY_CONTENT = typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content');

/**
 * A text field that grows with its text, no handle, no scroll bar (`field-sizing: content` in its CSS). Where the
 * browser does not know that rule (Firefox, older Safari on iPhone), the field takes the height of its text at each
 * change, so that nothing past its first lines is cut out of sight.
 */
export function useGrowingArea(value: string): RefObject<HTMLTextAreaElement | null> {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const area = ref.current;
    if (area === null || SIZED_BY_CONTENT) return;
    area.style.height = '';
    if (area.scrollHeight > 0) area.style.height = `${String(area.scrollHeight + 2)}px`;
  }, [value]);
  return ref;
}
