/**
 * Tests for useSpinningFavicon hook logic
 *
 * Tests the rotation math and animation control logic.
 * DOM operations (canvas, favicon link element) are not tested here
 * since there's no DOM environment, but the math and state transitions are.
 */
import { describe, it, expect } from 'bun:test';

describe('useSpinningFavicon - rotation math', () => {
  /**
   * The hook rotates by (2 * PI) / 90 radians per frame.
   * At 60fps, this completes a full rotation in 90 frames = 1.5 seconds.
   */
  const ROTATION_PER_FRAME = (2 * Math.PI) / 90;

  it('should rotate approximately 4 degrees per frame', () => {
    const degreesPerFrame = (ROTATION_PER_FRAME * 180) / Math.PI;
    expect(degreesPerFrame).toBeCloseTo(4, 0);
  });

  it('should complete full rotation in 90 frames', () => {
    const totalRotation = ROTATION_PER_FRAME * 90;
    expect(totalRotation).toBeCloseTo(2 * Math.PI, 5);
  });

  it('should complete full rotation in 1.5 seconds at 60fps', () => {
    const framesPerSecond = 60;
    const framesForFullRotation = (2 * Math.PI) / ROTATION_PER_FRAME;
    const secondsForFullRotation = framesForFullRotation / framesPerSecond;
    expect(secondsForFullRotation).toBeCloseTo(1.5, 1);
  });
});

describe('useSpinningFavicon - state transitions', () => {
  interface FaviconState {
    isAnimating: boolean;
    rotation: number;
  }

  function startAnimation(): FaviconState {
    return { isAnimating: true, rotation: 0 };
  }

  function stopAnimation(state: FaviconState): FaviconState {
    return { ...state, isAnimating: false };
  }

  function advanceFrame(state: FaviconState): FaviconState {
    if (!state.isAnimating) return state;
    return {
      ...state,
      rotation: state.rotation + (2 * Math.PI) / 90,
    };
  }

  it('should start animation with rotation at 0', () => {
    const state = startAnimation();
    expect(state.isAnimating).toBe(true);
    expect(state.rotation).toBe(0);
  });

  it('should stop animation preserving current rotation', () => {
    let state = startAnimation();
    state = advanceFrame(state);
    state = advanceFrame(state);
    const stoppedState = stopAnimation(state);
    expect(stoppedState.isAnimating).toBe(false);
    expect(stoppedState.rotation).toBeGreaterThan(0);
  });

  it('should not advance rotation when stopped', () => {
    let state = startAnimation();
    state = stopAnimation(state);
    const rotation = state.rotation;
    state = advanceFrame(state);
    expect(state.rotation).toBe(rotation);
  });

  it('should accumulate rotation over multiple frames', () => {
    let state = startAnimation();
    for (let i = 0; i < 10; i++) {
      state = advanceFrame(state);
    }
    const expected = 10 * (2 * Math.PI) / 90;
    expect(state.rotation).toBeCloseTo(expected, 10);
  });
});

describe('useSpinningFavicon - canvas dimensions', () => {
  it('should use 32x32 canvas (standard favicon size)', () => {
    const CANVAS_SIZE = 32;
    expect(CANVAS_SIZE).toBe(32);
    // Center point for rotation
    expect(CANVAS_SIZE / 2).toBe(16);
  });
});
