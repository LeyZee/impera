import { useEffect, useRef, type JSX } from 'react';

/** Asked in the page, never with `confirm()` (docs/design/README.md): drop the changes not saved, or stay. */
export function LeaveConfirm({ onLeave, onStay }: { onLeave: () => void; onStay: () => void }): JSX.Element {
  const stayRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stayRef.current?.focus();
  }, []);
  return (
    <div className="nv-confirm ps-leave" role="alertdialog" aria-labelledby="ps-leave-text">
      <p id="ps-leave-text">
        <b>Tes modifications ne sont pas enregistrées.</b> Si tu quittes cette fiche, elles seront perdues.
      </p>
      <div className="nv-confirm__actions">
        <button type="button" className="nv-btn nv-btn--soft nv-btn--destructive" onClick={onLeave}>
          Les abandonner
        </button>
        {/* Soft, not neon: the one neon of the screen stays on « Enregistrer » (CREA-07). */}
        <button type="button" className="nv-btn nv-btn--soft" ref={stayRef} onClick={onStay}>
          Rester
        </button>
      </div>
    </div>
  );
}
