import type { DropMediaKind } from '@impera/contracts';
import { useEffect, useState, type JSX } from 'react';

/**
 * A chosen file as she sees it in her gallery, so that she can put her series in order (Charles, 05/11): a photo, the
 * first image of a video, a microphone for a vocal. Read on her phone only (a `blob:` address), never sent. A photo
 * her browser cannot show (HEIC outside Safari) keeps the empty square.
 */
export function Thumb({ file, kind }: { file: File; kind: DropMediaKind | null }): JSX.Element {
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
    <span className="ct-thumb" aria-hidden="true">
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
    </span>
  );
}
