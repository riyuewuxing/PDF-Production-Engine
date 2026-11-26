import { useEffect } from 'react';

interface UseGlobalShortcutsOptions {
  hasActiveDoc: boolean;
  onManualSave: () => void | Promise<void>;
  onUndo: () => void;
  onRedo: () => void;
  onToggleCommandPalette: () => void;
}

export function useGlobalShortcuts({
  hasActiveDoc,
  onManualSave,
  onUndo,
  onRedo,
  onToggleCommandPalette,
}: UseGlobalShortcutsOptions): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const key = e.key.toLowerCase();

      if (key === 'k' && !e.shiftKey) {
        e.preventDefault();
        onToggleCommandPalette();
        return;
      }

      if (!hasActiveDoc) return;

      if (key === 's' && !e.shiftKey) {
        e.preventDefault();
        void onManualSave();
        return;
      }

      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (target.dataset.nativeUndo === 'true' || target.closest('[role="dialog"]'))
      ) {
        return;
      }

      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo();
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        onRedo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasActiveDoc, onManualSave, onRedo, onToggleCommandPalette, onUndo]);
}
