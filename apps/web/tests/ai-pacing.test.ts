import { describe, expect, it, vi } from 'vitest';
import {
  createTurnPresentation,
  sampleVisibleDelay,
  VISIBLE_DELAY_RANGES,
  type PresentationDependencies,
  type PresentationKind,
} from '../src/ai/turn-pacing';

function presentationClock(random = vi.fn(() => 0)) {
  let time = 0;
  let visible = true;
  let nextId = 1;
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { at: number; callback: () => void }>();
  const visibilityListeners = new Set<() => void>();
  const dependencies: PresentationDependencies = {
    random,
    now: () => time,
    requestFrame(callback) {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelFrame(id) {
      frames.delete(id);
    },
    setTimer(callback, delayMs) {
      const id = nextId++;
      timers.set(id, { at: time + delayMs, callback });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    isVisible: () => visible,
    subscribeVisibility(callback) {
      visibilityListeners.add(callback);
      return () => visibilityListeners.delete(callback);
    },
  };
  function advance(milliseconds: number) {
    const target = time + milliseconds;
    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      timers.delete(id);
      time = timer.at;
      timer.callback();
    }
    time = target;
  }
  function frame() {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback());
  }
  function paint() {
    frame();
    advance(16);
    frame();
  }
  return {
    dependencies,
    random,
    frames,
    timers,
    visibilityListeners,
    advance,
    frame,
    paint,
    setVisible(value: boolean) {
      if (visible === value) return;
      visible = value;
      visibilityListeners.forEach((callback) => callback());
    },
  };
}

describe('independent presentation delay sampling', () => {
  it.each([
    ['FLIP', 500, 900],
    ['MOVE', 350, 700],
    ['CAPTURE', 450, 850],
    ['OPENING', 350, 700],
  ] as const)('uses the approved inclusive %s delay range', (kind, min, max) => {
    expect(VISIBLE_DELAY_RANGES[kind]).toEqual({ min, max });
    expect(sampleVisibleDelay(kind, () => 0)).toBe(min);
    expect(sampleVisibleDelay(kind, () => 1 - Number.EPSILON)).toBe(max);
    for (const sample of [0.1, 0.25, 0.5, 0.9]) {
      const delay = sampleVisibleDelay(kind, () => sample);
      expect(Number.isInteger(delay)).toBe(true);
      expect(delay).toBeGreaterThanOrEqual(min);
      expect(delay).toBeLessThanOrEqual(max);
    }
  });

  it('samples once per presentation gate and does not consume policy randomness on retry', () => {
    const clock = presentationClock(vi.fn(() => 0.5));
    const gate = createTurnPresentation('FLIP', clock.dependencies);
    expect(gate.minimumDelayMs).toBe(sampleVisibleDelay('FLIP', () => 0.5));
    const stop = gate.wait(vi.fn());
    stop();
    gate.wait(vi.fn());
    clock.paint();
    clock.advance(1000);
    expect(clock.random).toHaveBeenCalledTimes(1);
    gate.cancel();
  });
});

describe('AI action presentation after a visible human action', () => {
  it('holds an already computed response until two visible frames and the full visible dwell', () => {
    const clock = presentationClock();
    const gate = createTurnPresentation('FLIP', clock.dependencies);
    const present = vi.fn();
    gate.wait(present);
    clock.advance(1000);
    expect(present).not.toHaveBeenCalled();
    clock.frame();
    clock.advance(16);
    expect(present).not.toHaveBeenCalled();
    clock.frame();
    clock.advance(499);
    expect(present).not.toHaveBeenCalled();
    clock.advance(1);
    expect(present).toHaveBeenCalledTimes(1);
    expect(clock.frames.size).toBe(0);
    expect(clock.timers.size).toBe(0);
  });

  it.each(['FLIP', 'MOVE', 'CAPTURE', 'OPENING'] as const)(
    'waits only the remaining %s dwell after computation completes',
    (kind: PresentationKind) => {
      const clock = presentationClock();
      const gate = createTurnPresentation(kind, clock.dependencies);
      clock.paint();
      clock.advance(200);
      const present = vi.fn();
      gate.wait(present);
      clock.advance(gate.minimumDelayMs - 201);
      expect(present).not.toHaveBeenCalled();
      clock.advance(1);
      expect(present).toHaveBeenCalledTimes(1);
      gate.cancel();
    },
  );

  it('presents a slow response immediately after the visible dwell has already elapsed', () => {
    const clock = presentationClock();
    const gate = createTurnPresentation('CAPTURE', clock.dependencies);
    clock.paint();
    clock.advance(1600);
    const present = vi.fn();
    gate.wait(present);
    expect(present).toHaveBeenCalledTimes(1);
    expect(clock.timers.size).toBe(0);
    gate.cancel();
  });

  it('does not treat hidden frame callbacks or elapsed background time as the first visible paint', () => {
    const clock = presentationClock();
    clock.setVisible(false);
    const gate = createTurnPresentation('FLIP', clock.dependencies);
    const present = vi.fn();
    gate.wait(present);
    clock.frame();
    clock.advance(2000);
    clock.frame();
    clock.advance(2000);
    expect(present).not.toHaveBeenCalled();
    clock.setVisible(true);
    clock.paint();
    clock.advance(499);
    expect(present).not.toHaveBeenCalled();
    clock.advance(1);
    expect(present).toHaveBeenCalledTimes(1);
    gate.cancel();
  });

  it('ignores duplicate response callbacks before and after delivery', () => {
    const clock = presentationClock();
    const gate = createTurnPresentation('FLIP', clock.dependencies);
    const first = vi.fn();
    const duplicate = vi.fn();
    gate.wait(first);
    gate.wait(duplicate);
    clock.paint();
    clock.advance(500);
    gate.wait(duplicate);
    clock.advance(1000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(duplicate).not.toHaveBeenCalled();
    gate.cancel();
  });

  it('pauses visible dwell while hidden and resumes only its remaining portion', () => {
    const clock = presentationClock();
    const gate = createTurnPresentation('FLIP', clock.dependencies);
    const present = vi.fn();
    gate.wait(present);
    clock.paint();
    clock.advance(200);
    clock.setVisible(false);
    expect(clock.timers.size).toBe(0);
    clock.advance(10_000);
    expect(present).not.toHaveBeenCalled();
    clock.setVisible(true);
    clock.advance(299);
    expect(present).not.toHaveBeenCalled();
    clock.advance(1);
    expect(present).toHaveBeenCalledTimes(1);
    gate.cancel();
  });

  it('does not present a response received in the background even when prior visible dwell elapsed', () => {
    const clock = presentationClock();
    const gate = createTurnPresentation('MOVE', clock.dependencies);
    clock.paint();
    clock.advance(1000);
    clock.setVisible(false);
    const present = vi.fn();
    gate.wait(present);
    clock.advance(10_000);
    expect(present).not.toHaveBeenCalled();
    clock.setVisible(true);
    expect(present).toHaveBeenCalledTimes(1);
    gate.cancel();
  });

  it('allows a fresh request after waiter cleanup while retaining the original visible marker', () => {
    const clock = presentationClock();
    const gate = createTurnPresentation('FLIP', clock.dependencies);
    const abandoned = vi.fn();
    const stopWaiting = gate.wait(abandoned);
    clock.paint();
    clock.advance(200);
    stopWaiting();
    expect(clock.timers.size).toBe(0);
    const retried = vi.fn();
    gate.wait(retried);
    clock.advance(299);
    expect(retried).not.toHaveBeenCalled();
    clock.advance(1);
    expect(retried).toHaveBeenCalledTimes(1);
    expect(abandoned).not.toHaveBeenCalled();
    expect(clock.random).toHaveBeenCalledTimes(1);
    gate.cancel();
  });

  it('keeps a later retry alive when cleanup for an older request runs again', () => {
    const clock = presentationClock();
    const gate = createTurnPresentation('FLIP', clock.dependencies);
    const stopOld = gate.wait(vi.fn());
    stopOld();
    const current = vi.fn();
    gate.wait(current);
    stopOld();
    clock.paint();
    clock.advance(500);
    expect(current).toHaveBeenCalledTimes(1);
    gate.cancel();
  });

  it('allows an explicit retry after a presented proposal was rejected without adding new dwell', () => {
    const clock = presentationClock();
    const gate = createTurnPresentation('FLIP', clock.dependencies);
    const original = vi.fn();
    const stopOriginal = gate.wait(original);
    clock.paint();
    clock.advance(500);
    expect(original).toHaveBeenCalledTimes(1);
    stopOriginal();
    const retried = vi.fn();
    gate.wait(retried);
    expect(retried).toHaveBeenCalledTimes(1);
    expect(clock.timers.size).toBe(0);
    expect(clock.random).toHaveBeenCalledTimes(1);
    gate.cancel();
  });

  it.each(['before-paint', 'during-dwell'] as const)(
    'cancels all scheduled presentation work %s on a replaced turn or unmount',
    (stage) => {
      const clock = presentationClock();
      const gate = createTurnPresentation('FLIP', clock.dependencies);
      const present = vi.fn();
      gate.wait(present);
      if (stage === 'during-dwell') clock.paint();
      const queuedCallbacks = [
        ...clock.frames.values(),
        ...[...clock.timers.values()].map((timer) => timer.callback),
      ];
      gate.cancel();
      gate.cancel();
      expect(clock.frames.size).toBe(0);
      expect(clock.timers.size).toBe(0);
      expect(clock.visibilityListeners.size).toBe(0);
      // Browser callbacks already queued before cancellation must also be harmless.
      queuedCallbacks.forEach((callback) => callback());
      gate.wait(present);
      clock.advance(2000);
      clock.paint();
      expect(present).not.toHaveBeenCalled();
      expect(clock.frames.size).toBe(0);
      expect(clock.timers.size).toBe(0);
    },
  );
});
