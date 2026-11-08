import { REEL_SECONDS_MAX, REEL_SECONDS_MIN } from '@impera/contracts';
import { useRef, type JSX, type KeyboardEvent, type PointerEvent } from 'react';

import { clampSeconds, REEL_SECONDS_STEP } from './model';

import { reelLength } from '@/screens/agenda/ReelBrief';

/**
 * The reel's duration, from 5 to 90 seconds by steps of 5: a slider drawn by the page, never the browser's own (no
 * native control, docs/design). Dragged, tapped on its track, or moved by the arrows (5 s), Page Up/Down (15 s), Home
 * and End.
 */
export function SecondsSlider({
  id,
  labelledBy,
  value,
  onChange,
}: {
  id: string;
  labelledBy: string;
  value: number;
  onChange: (seconds: number) => void;
}): JSX.Element {
  const track = useRef<HTMLDivElement>(null);
  const share = (value - REEL_SECONDS_MIN) / (REEL_SECONDS_MAX - REEL_SECONDS_MIN);

  const fromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const box = track.current?.getBoundingClientRect();
    if (box === undefined || box.width === 0) return;
    const at = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const next = clampSeconds(REEL_SECONDS_MIN + at * (REEL_SECONDS_MAX - REEL_SECONDS_MIN));
    if (next !== value) onChange(next);
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const steps: Partial<Record<string, number>> = {
      ArrowRight: REEL_SECONDS_STEP,
      ArrowUp: REEL_SECONDS_STEP,
      ArrowLeft: -REEL_SECONDS_STEP,
      ArrowDown: -REEL_SECONDS_STEP,
      PageUp: 3 * REEL_SECONDS_STEP,
      PageDown: -3 * REEL_SECONDS_STEP,
    };
    let next: number | null = null;
    if (event.key === 'Home') next = REEL_SECONDS_MIN;
    else if (event.key === 'End') next = REEL_SECONDS_MAX;
    else {
      const step = steps[event.key];
      if (step !== undefined) next = clampSeconds(value + step);
    }
    if (next === null) return;
    event.preventDefault();
    if (next !== value) onChange(next);
  };

  return (
    <div className="rb-slider">
      <div
        ref={track}
        id={id}
        className="rb-slider__track"
        role="slider"
        tabIndex={0}
        aria-labelledby={labelledBy}
        aria-valuemin={REEL_SECONDS_MIN}
        aria-valuemax={REEL_SECONDS_MAX}
        aria-valuenow={value}
        aria-valuetext={`${String(value)} secondes`}
        style={{ '--rb-share': share }}
        onKeyDown={onKey}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          fromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) fromPointer(event);
        }}
      >
        <span className="rb-slider__fill" aria-hidden="true" />
        <span className="rb-slider__thumb" aria-hidden="true" />
      </div>
      <span className="rb-slider__value nv-num" aria-hidden="true">
        {reelLength(value)}
      </span>
    </div>
  );
}
