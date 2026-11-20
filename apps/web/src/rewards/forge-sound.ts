/*
 * The sound of a rank being forged, of the « gagné » family: embers drawn in (a rising breath), the fire catching (a
 * low strike), then the bells of a reveal over a fuller chord. Made in the browser, nothing sampled. Under two and a
 * half seconds, in step with the forge on screen: the strike falls when the medallion lights. Never in a hidden tab;
 * a browser that refuses sound before a gesture simply stays silent.
 */

/** When the medallion lights, in seconds from the start: the forge's flash in rewards.css falls here too. */
export const FORGE_STRIKE = 0.9;
/** How long the sound lasts, its tail included. */
export const FORGE_LENGTH = 2.4;

const BELLS = [392, 523.25, 659.25, 783.99, 1046.5] as const;

/** A fixed noise, so the sound is the same every time. */
function noiseOf(context: BaseAudioContext, seconds: number): AudioBuffer {
  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 7;
  for (let index = 0; index < data.length; index += 1) {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    data[index] = (seed / 1_073_741_824 - 1) * 0.9;
  }
  return buffer;
}

/** Writes the forge into `context`, from `start` (seconds on its clock), towards `destination`. */
export function scoreForge(context: BaseAudioContext, destination: AudioNode, start: number): void {
  const out = context.createGain();
  out.gain.value = 0.45;
  out.connect(destination);
  const strike = start + FORGE_STRIKE;

  // The breath: a noise whose band climbs as the embers close in.
  const breath = context.createBufferSource();
  breath.buffer = noiseOf(context, FORGE_STRIKE + 0.2);
  const band = context.createBiquadFilter();
  band.type = 'bandpass';
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(260, start);
  band.frequency.exponentialRampToValueAtTime(2600, strike);
  const breathLevel = context.createGain();
  breathLevel.gain.setValueAtTime(0.0001, start);
  breathLevel.gain.exponentialRampToValueAtTime(0.22, strike - 0.05);
  breathLevel.gain.exponentialRampToValueAtTime(0.0001, strike + 0.12);
  breath.connect(band).connect(breathLevel).connect(out);
  breath.start(start);
  breath.stop(strike + 0.2);

  // The strike: a low blow that falls, under a short burst of dark noise.
  const blow = context.createOscillator();
  const blowLevel = context.createGain();
  blow.frequency.setValueAtTime(110, strike);
  blow.frequency.exponentialRampToValueAtTime(42, strike + 0.4);
  blowLevel.gain.setValueAtTime(0.0001, strike);
  blowLevel.gain.linearRampToValueAtTime(0.5, strike + 0.008);
  blowLevel.gain.exponentialRampToValueAtTime(0.0001, strike + 0.5);
  blow.connect(blowLevel).connect(out);
  blow.start(strike);
  blow.stop(strike + 0.55);
  const crack = context.createBufferSource();
  crack.buffer = noiseOf(context, 0.3);
  const dark = context.createBiquadFilter();
  dark.type = 'lowpass';
  dark.frequency.value = 1400;
  const crackLevel = context.createGain();
  crackLevel.gain.setValueAtTime(0.3, strike);
  crackLevel.gain.exponentialRampToValueAtTime(0.0001, strike + 0.28);
  crack.connect(dark).connect(crackLevel).connect(out);
  crack.start(strike);
  crack.stop(strike + 0.3);

  // The bells of a reveal, then a chord with its octave below.
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
  BELLS.forEach((note, index) => {
    bell(note, strike + 0.08 + index * 0.075, 0.18, 0.9);
  });
  const chord = strike + 0.08 + BELLS.length * 0.075;
  for (const note of [130.81, 261.63, 392, 1046.5]) bell(note, chord, 0.12, 1.1);
}

/** Plays the forge once; returns what stops it. */
export function playForge(): () => void {
  if (typeof document === 'undefined' || document.hidden) return () => undefined;
  if (typeof AudioContext === 'undefined') return () => undefined;
  const context = new AudioContext();
  scoreForge(context, context.destination, context.currentTime + 0.02);
  const stop = (): void => {
    void context.close().catch(() => undefined);
  };
  const timer = window.setTimeout(stop, FORGE_LENGTH * 1000 + 200);
  return () => {
    window.clearTimeout(timer);
    stop();
  };
}
