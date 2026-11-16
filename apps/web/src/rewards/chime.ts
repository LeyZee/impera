/*
 * The chime of a reward's reveal: a short whoosh, a rising arpeggio of bells and one chord, made in the browser
 * (nothing sampled, no file). Under two seconds. Never played in a hidden tab. The browser refuses sound before her
 * first gesture on the page (recette 16/11, CHT-10 and CRE-18): before it, the chime stays silent without asking for
 * an audio context, so the console stays clean; after it, one context serves every chime, resumed when suspended.
 */

const NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.5] as const;

let gestured = false;
let shared: AudioContext | null = null;

/** Whether the page has had a gesture of hers, the browser's own word when it has one. */
function mayRing(): boolean {
  // `userActivation` is missing from older browsers and from the tests' page: the gesture we saw stands in for it.
  return gestured || ('userActivation' in navigator && navigator.userActivation.hasBeenActive);
}

if (typeof document !== 'undefined') {
  const mark = (): void => {
    gestured = true;
  };
  for (const kind of ['pointerdown', 'keydown', 'touchend'] as const)
    document.addEventListener(kind, mark, { capture: true, once: true, passive: true });
}

/** The one context of the page, made after her first gesture only. */
function contextNow(): AudioContext | null {
  if (typeof AudioContext === 'undefined' || !mayRing()) return null;
  if (shared === null || shared.state === 'closed') shared = new AudioContext();
  return shared;
}

/** Plays the chime once; returns what stops it. */
export function playChime(): () => void {
  if (typeof document === 'undefined' || document.hidden) return () => undefined;
  const context = contextNow();
  if (context === null) return () => undefined;
  let stopped = false;
  let silence = (): void => undefined;
  const ring = (): void => {
    if (!stopped) silence = ringOn(context);
  };
  if (context.state === 'suspended') void context.resume().then(ring, () => undefined);
  else ring();
  return () => {
    stopped = true;
    silence();
  };
}

/** The chime itself, on a running context; returns what silences it. */
function ringOn(context: AudioContext): () => void {
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
  // The context stays for the next chime: only this chime's output is cut.
  const stop = (): void => {
    out.disconnect();
  };
  const timer = window.setTimeout(stop, 1900);
  return () => {
    window.clearTimeout(timer);
    stop();
  };
}
