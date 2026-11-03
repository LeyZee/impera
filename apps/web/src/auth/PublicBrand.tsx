import { useEffect, type JSX } from 'react';

/**
 * The name at the head of every public page, drawn as the rail draws it (NAV-14): the mark and the wordmark face, so
 * the brand does not change from the sign-in to the app. It names the browser tab after the page too (NAV-12): after
 * a sign-out, the tab no longer says the last section.
 */
export function PublicBrand({ page }: { page: string }): JSX.Element {
  useEffect(() => {
    document.title = `${page} · Impera`;
  }, [page]);
  return (
    <p className="nv-wordmark flex items-center gap-2 text-4xl">
      <img src="/impera-mark.svg" alt="" width={34} height={34} />
      Impera
    </p>
  );
}
