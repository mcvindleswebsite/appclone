/**
 * Click-wheel feedback: a synthesized tick plus a haptic pulse per wheel step.
 *
 * - Haptics: iOS Safari (18+) has no Vibration API, but toggling a native
 *   `<input type="checkbox" switch>` fires the Taptic Engine, so a hidden
 *   switch is clicked through its label. Elsewhere `navigator.vibrate` is used.
 * - Audio: a 5 ms decaying noise burst rendered once into an AudioBuffer and
 *   replayed per step, on its own AudioContext so the music's volume graph
 *   never affects it.
 *
 * Both are throttled so fast spins don't stack sounds or flood the motor.
 */

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

const TICK_DURATION_S = 0.005;
const TICK_GAIN = 0.18;
/** Minimum gap between ticks; faster spins drop the extras. */
const TICK_MIN_INTERVAL_MS = 22;
const HAPTIC_MIN_INTERVAL_MS = 35;
const VIBRATE_MS = 5;

const isBrowser = () => typeof window !== "undefined";

/* ---------- Haptics ---------- */

let hapticLabel: HTMLLabelElement | null = null;

const supportsSwitchInput = () =>
  isBrowser() && "switch" in HTMLInputElement.prototype;

/** Lazily mounts the off-screen switch the iOS haptic trick toggles. */
const getHapticLabel = () => {
  if (hapticLabel?.isConnected) return hapticLabel;
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.cssText =
    "position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-9999px;";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  label.appendChild(input);
  document.body.appendChild(label);
  hapticLabel = label;
  return label;
};

let lastHapticAt = 0;

/** One light haptic pulse; `throttle` drops calls closer than the minimum gap. */
export const pulseHaptic = (throttle = false) => {
  if (!isBrowser()) return;
  const now = performance.now();
  if (throttle && now - lastHapticAt < HAPTIC_MIN_INTERVAL_MS) return;
  lastHapticAt = now;

  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(VIBRATE_MS);
  } else if (supportsSwitchInput()) {
    getHapticLabel().click();
  }
};

/* ---------- Tick audio ---------- */

let tickContext: AudioContext | null = null;
let tickBuffer: AudioBuffer | null = null;

/** Short noise burst with a fast exponential decay: a crisp mechanical click. */
const renderTick = (context: AudioContext) => {
  const length = Math.max(1, Math.round(context.sampleRate * TICK_DURATION_S));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const envelope = Math.exp((-6 * i) / length);
    data[i] = (Math.random() * 2 - 1) * envelope;
  }
  return buffer;
};

const getTickContext = () => {
  if (tickContext) return tickContext;
  const AudioContextCtor =
    window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext;
  if (!AudioContextCtor) return null;
  try {
    tickContext = new AudioContextCtor();
    tickBuffer = renderTick(tickContext);
  } catch {
    tickContext = null;
  }
  return tickContext;
};

/**
 * Browsers only start audio from a user gesture, so the context is created
 * and resumed on pointer/key down, before the first wheel step needs it.
 */
export const unlockTickAudio = () => {
  if (!isBrowser()) return;
  const context = getTickContext();
  if (context?.state === "suspended") void context.resume();
};

let lastTickAt = 0;

const playTick = () => {
  const context = getTickContext();
  if (!context || !tickBuffer || context.state !== "running") return;
  const source = context.createBufferSource();
  source.buffer = tickBuffer;
  const gain = context.createGain();
  gain.gain.value = TICK_GAIN;
  source.connect(gain).connect(context.destination);
  source.start();
};

/** Feedback for one click-wheel segment step. */
export const wheelTick = () => {
  if (!isBrowser()) return;
  const now = performance.now();
  if (now - lastTickAt >= TICK_MIN_INTERVAL_MS) {
    lastTickAt = now;
    playTick();
  }
  pulseHaptic(true);
};
