export type PresentationKind = 'FLIP' | 'MOVE' | 'CAPTURE' | 'OPENING';

export const VISIBLE_DELAY_RANGES = {
  FLIP: { min: 500, max: 900 },
  MOVE: { min: 350, max: 700 },
  CAPTURE: { min: 450, max: 850 },
  OPENING: { min: 350, max: 700 },
} as const;

function presentationRandom(): number {
  // Fresh presentation entropy, never the Agent root/decision PRNG or deck stream.
  const value = globalThis.crypto?.getRandomValues?.(new Uint32Array(1))[0];
  return value === undefined ? 0.5 : value / 0x100000000;
}

export function sampleVisibleDelay(
  kind: PresentationKind,
  random: () => number = presentationRandom,
): number {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new RangeError('Presentation random sample must be in [0, 1).');
  const { min, max } = VISIBLE_DELAY_RANGES[kind];
  return min + Math.floor(sample * (max - min + 1));
}

export interface PresentationDependencies {
  readonly random: () => number;
  readonly now: () => number;
  readonly requestFrame: (callback: () => void) => number;
  readonly cancelFrame: (id: number) => void;
  readonly setTimer: (callback: () => void, delayMs: number) => number;
  readonly clearTimer: (id: number) => void;
  readonly isVisible: () => boolean;
  readonly subscribeVisibility: (callback: () => void) => () => void;
}

export interface TurnPresentation {
  readonly minimumDelayMs: number;
  readonly wait: (present: () => void) => () => void;
  readonly cancel: () => void;
}

/** One visible-time anchor per canonical turn; computation runs independently. */
export function createTurnPresentation(
  kind: PresentationKind,
  dependencies: Partial<PresentationDependencies> = {},
): TurnPresentation {
  const clock: PresentationDependencies = {
    random: presentationRandom,
    now: () => performance.now(),
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    setTimer: (callback, delay) => window.setTimeout(callback, delay),
    clearTimer: (id) => window.clearTimeout(id),
    isVisible: () => document.visibilityState !== 'hidden',
    subscribeVisibility: (callback) => {
      document.addEventListener('visibilitychange', callback);
      return () => document.removeEventListener('visibilitychange', callback);
    },
    ...dependencies,
  };
  const minimumDelayMs = sampleVisibleDelay(kind, clock.random);
  let disposed = false;
  let painted = false;
  let visibleSince: number | null = null;
  let elapsedVisible = 0;
  let frame: number | null = null;
  let timer: number | null = null;
  let waiter: { present: () => void; consumed: boolean } | null = null;

  function clearTimer() {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
  }
  function flush() {
    clearTimer();
    if (disposed || !painted || visibleSince === null || waiter === null || waiter.consumed) return;
    if (!clock.isVisible()) {
      visibilityChanged();
      return;
    }
    const remaining = minimumDelayMs - elapsedVisible - Math.max(0, clock.now() - visibleSince);
    if (remaining > 0) timer = clock.setTimer(flush, remaining);
    else {
      waiter.consumed = true;
      waiter.present();
    }
  }
  function visibilityChanged() {
    if (disposed || !painted) return;
    if (!clock.isVisible()) {
      if (visibleSince !== null) elapsedVisible += Math.max(0, clock.now() - visibleSince);
      visibleSince = null;
      clearTimer();
    } else {
      if (visibleSince === null) visibleSince = clock.now();
      flush();
    }
  }
  function firstFrame() {
    if (disposed) return;
    if (!clock.isVisible()) {
      frame = clock.requestFrame(firstFrame);
      return;
    }
    frame = clock.requestFrame(() => {
      if (disposed) return;
      if (!clock.isVisible()) {
        frame = clock.requestFrame(firstFrame);
        return;
      }
      frame = null;
      painted = true;
      visibleSince = clock.now();
      flush();
    });
  }
  const unsubscribe = clock.subscribeVisibility(visibilityChanged);
  frame = clock.requestFrame(firstFrame);
  return {
    minimumDelayMs,
    wait(present) {
      if (disposed || waiter !== null) return () => {};
      const owner = { present, consumed: false };
      waiter = owner;
      flush();
      return () => {
        if (waiter !== owner) return;
        clearTimer();
        waiter = null;
      };
    },
    cancel() {
      if (disposed) return;
      disposed = true;
      if (frame !== null) clock.cancelFrame(frame);
      clearTimer();
      waiter = null;
      unsubscribe();
    },
  };
}
