/*
 * The chime of a reward's reveal: a short whoosh, a rising arpeggio of bells and one chord, made in the browser
 * (nothing sampled, no file). Under two seconds. Never played in a hidden tab; a browser that refuses sound before
 * a gesture simply stays silent.
 */

const NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.5] as const;

/** Plays the chime once; returns what stops it. */
export function playChime(): () => void {
  if (typeof document === 'undefined' || document.hidden) return () => undefined;
  if (typeof AudioContext === 'undefined') return () => undefined;
  const context = new AudioContext();
  const out = context.createGain();
  out.gain.value = 0.5;
  out.connect(context.destination);
  const start = context.currentTime + 0.02;
  const bell = (frequency: number, at: number, level: number, length: number): void => {
    for (const [ratio, share] of [
      [1, 1],
      [2.01, 0.38],
      [3.02, 0.16],
    ] as const) {
      const tone = context.createOscillator();
      const gain = context.createGain();
      tone.frequency.value = frequency * ratio;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(level * share, at + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + length / ratio);
      tone.connect(gain).connect(out);
      tone.start(at);
      tone.stop(at + length / ratio + 0.05);
    }
  };
  NOTES.forEach((note, index) => {
    bell(note, start + 0.18 + index * 0.07, 0.2, 0.9);
  });
  const chord = start + 0.18 + NOTES.length * 0.07;
  bell(NOTES[0] / 2, chord, 0.14, 1.1);
  bell(NOTES[NOTES.length - 1] ?? NOTES[0], chord, 0.14, 1.1);
  const stop = (): void => {
    void context.close().catch(() => undefined);
  };
  const timer = window.setTimeout(stop, 1900);
  return () => {
    window.clearTimeout(timer);
    stop();
  };
}
