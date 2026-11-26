import { useCallback, useRef, useState } from 'react';

export const MAX_HISTORY_STEPS = 100;
export const HISTORY_MERGE_WINDOW_MS = 400;

export interface HistoryStack<T> {
  past: T[];
  present: T | null;
  future: T[];
}

export interface HistoryPushOptions {
  immediate?: boolean;
  now?: number;
}

export function createInitialHistory<T>(initial: T | null = null): HistoryStack<T> {
  return {
    past: [],
    present: initial,
    future: [],
  };
}

export function pushHistorySnapshot<T>(
  state: HistoryStack<T>,
  next: T,
  lastEditAt: number,
  options: HistoryPushOptions = {},
): { nextState: HistoryStack<T>; nextEditAt: number } {
  const now = options.now ?? Date.now();
  const immediate = Boolean(options.immediate);

  if (state.present === null) {
    return {
      nextState: { past: [], present: next, future: [] },
      nextEditAt: now,
    };
  }

  if (Object.is(state.present, next)) {
    return { nextState: state, nextEditAt: lastEditAt };
  }

  const withinMergeWindow = !immediate && now - lastEditAt <= HISTORY_MERGE_WINDOW_MS;
  if (withinMergeWindow && state.past.length > 0) {
    return {
      nextState: {
        past: state.past,
        present: next,
        future: [],
      },
      nextEditAt: now,
    };
  }

  const nextPast = [...state.past, state.present];
  const trimmedPast =
    nextPast.length > MAX_HISTORY_STEPS
      ? nextPast.slice(nextPast.length - MAX_HISTORY_STEPS)
      : nextPast;

  return {
    nextState: {
      past: trimmedPast,
      present: next,
      future: [],
    },
    nextEditAt: immediate ? 0 : now,
  };
}

export function previewHistorySnapshot<T>(state: HistoryStack<T>, next: T): HistoryStack<T> {
  if (Object.is(state.present, next)) return state;
  return {
    ...state,
    present: next,
  };
}

export function commitHistoryBatch<T>(
  state: HistoryStack<T>,
  baseline: T,
  finalValue: T,
): HistoryStack<T> {
  if (Object.is(baseline, finalValue)) {
    return {
      ...state,
      present: finalValue,
    };
  }
  const nextPast = [...state.past, baseline];
  const trimmedPast =
    nextPast.length > MAX_HISTORY_STEPS
      ? nextPast.slice(nextPast.length - MAX_HISTORY_STEPS)
      : nextPast;
  return {
    past: trimmedPast,
    present: finalValue,
    future: [],
  };
}

export function undoHistoryState<T>(state: HistoryStack<T>): HistoryStack<T> {
  if (state.past.length === 0 || state.present === null) return state;
  const previous = state.past[state.past.length - 1]!;
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.present, ...state.future].slice(0, MAX_HISTORY_STEPS),
  };
}

export function redoHistoryState<T>(state: HistoryStack<T>): HistoryStack<T> {
  if (state.future.length === 0 || state.present === null) return state;
  const next = state.future[0]!;
  const nextPast = [...state.past, state.present];
  return {
    past:
      nextPast.length > MAX_HISTORY_STEPS
        ? nextPast.slice(nextPast.length - MAX_HISTORY_STEPS)
        : nextPast,
    present: next,
    future: state.future.slice(1),
  };
}

export function useHistoryState<T>(initial: T | null = null) {
  const initialStack = createInitialHistory(initial);
  const stackRef = useRef<HistoryStack<T>>(initialStack);
  const [stack, setStack] = useState<HistoryStack<T>>(initialStack);
  const lastEditAtRef = useRef<number>(0);

  const reset = useCallback((nextInitial: T | null) => {
    const nextStack = createInitialHistory(nextInitial);
    stackRef.current = nextStack;
    lastEditAtRef.current = 0;
    setStack(nextStack);
  }, []);

  const set = useCallback((next: T, options?: { immediate?: boolean }) => {
    const { nextState, nextEditAt } = pushHistorySnapshot(
      stackRef.current,
      next,
      lastEditAtRef.current,
      { immediate: options?.immediate },
    );
    stackRef.current = nextState;
    lastEditAtRef.current = nextEditAt;
    setStack(nextState);
  }, []);

  const previewSilent = useCallback((next: T) => {
    const nextState = previewHistorySnapshot(stackRef.current, next);
    stackRef.current = nextState;
    setStack(nextState);
  }, []);

  const commitBatch = useCallback((baseline: T, finalValue: T) => {
    const nextState = commitHistoryBatch(stackRef.current, baseline, finalValue);
    stackRef.current = nextState;
    lastEditAtRef.current = 0;
    setStack(nextState);
  }, []);

  const undo = useCallback((): T | null => {
    const next = undoHistoryState(stackRef.current);
    if (next === stackRef.current) return null;
    stackRef.current = next;
    lastEditAtRef.current = 0;
    setStack(next);
    return next.present;
  }, []);

  const redo = useCallback((): T | null => {
    const next = redoHistoryState(stackRef.current);
    if (next === stackRef.current) return null;
    stackRef.current = next;
    lastEditAtRef.current = 0;
    setStack(next);
    return next.present;
  }, []);

  return {
    value: stack.present,
    canUndo: stack.past.length > 0,
    canRedo: stack.future.length > 0,
    undoCount: stack.past.length,
    redoCount: stack.future.length,
    reset,
    set,
    previewSilent,
    commitBatch,
    undo,
    redo,
  };
}
