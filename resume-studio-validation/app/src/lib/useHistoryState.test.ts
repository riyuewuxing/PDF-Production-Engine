import { describe, expect, it } from 'vitest';
import {
  MAX_HISTORY_STEPS,
  commitHistoryBatch,
  createInitialHistory,
  previewHistorySnapshot,
  pushHistorySnapshot,
  redoHistoryState,
  undoHistoryState,
} from './useHistoryState';

describe('useHistoryState pure stack', () => {
  it('coalesces rapid edits within 400ms window and pushes distinct steps outside 400ms', () => {
    let state = createInitialHistory('v0');
    let lastEdit = 0;

    // Keystroke 1 at t=1000
    ({ nextState: state, nextEditAt: lastEdit } = pushHistorySnapshot(state, 'v1', lastEdit, {
      now: 1000,
    }));
    // Keystroke 2 at t=1150 (within 400ms -> merges!)
    ({ nextState: state, nextEditAt: lastEdit } = pushHistorySnapshot(state, 'v2', lastEdit, {
      now: 1150,
    }));
    expect(state.present).toBe('v2');
    expect(state.past).toEqual(['v0']);

    // Pause > 400ms then edit at t=1700
    ({ nextState: state, nextEditAt: lastEdit } = pushHistorySnapshot(state, 'v3', lastEdit, {
      now: 1700,
    }));
    expect(state.present).toBe('v3');
    expect(state.past).toEqual(['v0', 'v2']);

    // Undo and redo round-trip
    state = undoHistoryState(state);
    expect(state.present).toBe('v2');
    state = undoHistoryState(state);
    expect(state.present).toBe('v0');
    state = redoHistoryState(state);
    expect(state.present).toBe('v2');
  });

  it('always isolates immediate edits and caps history at 100 steps', () => {
    let state = createInitialHistory(0);
    let lastEdit = 0;

    for (let i = 1; i <= 125; i++) {
      ({ nextState: state, nextEditAt: lastEdit } = pushHistorySnapshot(state, i, lastEdit, {
        immediate: true,
        now: 1000 + i,
      }));
    }

    expect(state.present).toBe(125);
    expect(state.past).toHaveLength(MAX_HISTORY_STEPS);
    expect(state.past[0]).toBe(25);
  });

  it('supports silent preview steps during auto-fit and commits 1 atomic undo step', () => {
    let state = createInitialHistory('font-15');
    // Simulate 20 measurement steps during handleFitOnePage
    for (let step = 1; step <= 20; step += 1) {
      state = previewHistorySnapshot(state, `font-${15 - step * 0.2}`);
    }
    expect(state.past).toHaveLength(0);
    // Commit single atomic transition from baseline 'font-15' -> final 'font-11'
    state = commitHistoryBatch(state, 'font-15', 'font-11');
    expect(state.present).toBe('font-11');
    expect(state.past).toEqual(['font-15']);

    // One Ctrl+Z restores directly to baseline before compression
    const undone = undoHistoryState(state);
    expect(undone.present).toBe('font-15');
  });
});
