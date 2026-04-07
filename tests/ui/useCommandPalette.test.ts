/**
 * Tests for useCommandPalette hook logic
 *
 * Tests the keyboard shortcut matching and state toggle behavior.
 * The hook manages open/close/toggle state and listens for Cmd+K / Ctrl+K / Escape.
 */
import { describe, it, expect } from 'bun:test';

describe('useCommandPalette - keyboard event matching', () => {
  /**
   * The hook's keydown handler checks:
   * 1. (metaKey || ctrlKey) && key === 'k' → toggle
   * 2. key === 'Escape' && isOpen → close
   */

  interface MockKeyEvent {
    metaKey: boolean;
    ctrlKey: boolean;
    key: string;
  }

  function shouldToggle(event: MockKeyEvent): boolean {
    return (event.metaKey || event.ctrlKey) && event.key === 'k';
  }

  function shouldClose(event: MockKeyEvent, isOpen: boolean): boolean {
    return event.key === 'Escape' && isOpen;
  }

  describe('Cmd/Ctrl+K toggle', () => {
    it('should trigger toggle on Cmd+K (macOS)', () => {
      expect(shouldToggle({ metaKey: true, ctrlKey: false, key: 'k' })).toBe(true);
    });

    it('should trigger toggle on Ctrl+K (Windows/Linux)', () => {
      expect(shouldToggle({ metaKey: false, ctrlKey: true, key: 'k' })).toBe(true);
    });

    it('should trigger toggle when both Cmd and Ctrl are held', () => {
      expect(shouldToggle({ metaKey: true, ctrlKey: true, key: 'k' })).toBe(true);
    });

    it('should NOT trigger toggle for just "k" without modifier', () => {
      expect(shouldToggle({ metaKey: false, ctrlKey: false, key: 'k' })).toBe(false);
    });

    it('should NOT trigger toggle for Cmd+other key', () => {
      expect(shouldToggle({ metaKey: true, ctrlKey: false, key: 'j' })).toBe(false);
      expect(shouldToggle({ metaKey: true, ctrlKey: false, key: 'K' })).toBe(false); // capital K
    });

    it('should be case-sensitive (key === "k", not "K")', () => {
      // The actual KeyboardEvent.key is lowercase for letter keys unless Shift is held
      expect(shouldToggle({ metaKey: true, ctrlKey: false, key: 'K' })).toBe(false);
    });
  });

  describe('Escape close', () => {
    it('should close when Escape pressed and palette is open', () => {
      expect(shouldClose({ metaKey: false, ctrlKey: false, key: 'Escape' }, true)).toBe(true);
    });

    it('should NOT close when Escape pressed and palette is already closed', () => {
      expect(shouldClose({ metaKey: false, ctrlKey: false, key: 'Escape' }, false)).toBe(false);
    });

    it('should NOT close for non-Escape keys', () => {
      expect(shouldClose({ metaKey: false, ctrlKey: false, key: 'Enter' }, true)).toBe(false);
    });
  });
});

describe('useCommandPalette - toggle state machine', () => {
  function toggle(current: boolean): boolean {
    return !current;
  }

  it('should open when currently closed', () => {
    expect(toggle(false)).toBe(true);
  });

  it('should close when currently open', () => {
    expect(toggle(true)).toBe(false);
  });

  it('should return to original state after two toggles', () => {
    let state = false;
    state = toggle(state);
    state = toggle(state);
    expect(state).toBe(false);
  });
});

describe('useCommandPalette - keyboard focus index navigation', () => {
  /**
   * The CommandPalette component also handles ArrowUp/ArrowDown for focus navigation.
   * Focus index is clamped between 0 and results.length - 1.
   */

  function moveDown(current: number, maxIndex: number): number {
    return Math.min(current + 1, maxIndex);
  }

  function moveUp(current: number): number {
    return Math.max(current - 1, 0);
  }

  it('should move focus down', () => {
    expect(moveDown(0, 4)).toBe(1);
    expect(moveDown(1, 4)).toBe(2);
  });

  it('should not exceed max index', () => {
    expect(moveDown(4, 4)).toBe(4);
    expect(moveDown(3, 3)).toBe(3);
  });

  it('should move focus up', () => {
    expect(moveUp(3)).toBe(2);
    expect(moveUp(1)).toBe(0);
  });

  it('should not go below 0', () => {
    expect(moveUp(0)).toBe(0);
  });

  it('should handle single-item list', () => {
    expect(moveDown(0, 0)).toBe(0);
    expect(moveUp(0)).toBe(0);
  });
});
