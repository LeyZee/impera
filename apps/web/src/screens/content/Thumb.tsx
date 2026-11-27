import type { DropMediaKind } from '@impera/contracts';
import { useEffect, useState, type JSX } from 'react';

import { clockOf } from './model';

/**
 * A chosen file as she sees it in her gallery, so that she can put her series in order (Charles, 05/11): a photo, the
 * first image of a video, a microphone for a vocal. Read on her phone only (a `blob:` address), never sent. A photo
 * her browser cannot show (HEIC outside Safari) keeps the empty square. A video's length, once read, sits on its
 * corner as in her gallery (Charles, 27/11).
 */
export function Thumb({
  file,
  kind,
  ms = null,
}: {
  file: File;
  kind: DropMediaKind | null;
  ms?: number | null;
}): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    if (kind !== 'image' && kind !== 'video') return undefined;
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => {
      URL.revokeObjectURL(made);
    };
  }, [file, kind]);

  return (
    <span className={kind === 'video' ? 'ct-thumb ct-thumb--video' : 'ct-thumb'} aria-hidden="true">
      {kind === 'audio' ? (
        '🎙️'
      ) : url === null || broken ? null : kind === 'video' ? (
        <video
          src={`${url}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          onError={() => {
            setBroken(true);
          }}
        />
      ) : (
        <img
          src={url}
          alt=""
          onError={() => {
            setBroken(true);
          }}
        />
      )}
      {/* A video tells itself from a photo at a glance: a play mark on its first image (recette CRE-16). */}
      {kind === 'video' ? (
        <svg className="ct-thumb__play" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="10" />
          <path d="M8 6.2v7.6L14 10z" />
        </svg>
      ) : null}
      {kind === 'video' && ms !== null ? (
        <span className="ct-thumb__length nv-num">{clockOf(ms)}</span>
      ) : null}
    </span>
  );
}
