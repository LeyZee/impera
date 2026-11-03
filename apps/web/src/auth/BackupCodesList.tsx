import { useEffect, useRef, useState, type JSX, type RefObject } from 'react';

/**
 * Ten backup codes on screen (ADR 0046 § 2), shown once: at the activation and when new ones are made in Réglages ›
 * Sécurité. Copied, or saved as a file; the person keeps them in a password manager or on paper.
 */
export function BackupCodesList({ codes }: { codes: readonly string[] }): JSX.Element {
  const listRef = useRef<HTMLUListElement>(null);
  const text = `Impera : codes de secours (chacun ne sert qu’une fois)\n\n${codes.join('\n')}\n`;
  return (
    <>
      <ul
        ref={listRef}
        className="nv-glass grid grid-cols-2 gap-x-6 gap-y-2 rounded-[var(--nv-radius-md)] px-4 py-3 font-mono text-sm"
        aria-label="Codes de secours"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={text} label="Copier les codes" shown={listRef} />
        <button
          type="button"
          className="nv-btn nv-btn--soft nv-btn--sm"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = 'impera-codes-de-secours.txt';
            // In the document for Firefox, and the URL kept a moment: revoked at once, Safari cancels the download.
            document.body.append(link);
            link.click();
            link.remove();
            setTimeout(() => {
              URL.revokeObjectURL(url);
            }, 1_000);
          }}
        >
          Enregistrer en fichier
        </button>
      </div>
    </>
  );
}

/** How long « Copié » or the fallback stays on the button before its label comes back. */
const COPY_FEEDBACK_MS = 3_000;

/**
 * Copies `text`. Where the browser refuses (some in-app browsers, a page without focus), the text on screen (`shown`)
 * is selected instead and the button says to copy it by hand: the person never believes a copy that did not happen.
 */
export function CopyButton({
  text,
  label,
  shown,
}: {
  text: string;
  label: string;
  shown: RefObject<HTMLElement | null>;
}): JSX.Element {
  const [state, setState] = useState<'idle' | 'copied' | 'selected'>('idle');
  useEffect(() => {
    if (state === 'idle') return undefined;
    const timer = setTimeout(() => {
      setState('idle');
    }, COPY_FEEDBACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);
  return (
    <button
      type="button"
      className="nv-btn nv-btn--soft nv-btn--sm self-start"
      aria-live="polite"
      onClick={() => {
        const refused = () => {
          if (shown.current !== null) window.getSelection()?.selectAllChildren(shown.current);
          setState('selected');
        };
        try {
          navigator.clipboard.writeText(text).then(() => {
            setState('copied');
          }, refused);
        } catch {
          refused();
        }
      }}
    >
      {state === 'copied' ? 'Copié' : state === 'selected' ? 'Sélectionné : copie-le à la main' : label}
    </button>
  );
}
