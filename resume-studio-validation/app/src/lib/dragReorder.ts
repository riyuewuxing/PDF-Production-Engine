import { useEffect, useState } from 'react';

export function reorderList<T>(list: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= list.length ||
    toIndex >= list.length ||
    fromIndex === toIndex
  ) {
    return [...list];
  }
  const copy = [...list];
  const [moved] = copy.splice(fromIndex, 1);
  if (moved === undefined) return [...list];
  copy.splice(toIndex, 0, moved);
  return copy;
}

export function useHandleDragReorder<T>(
  list: readonly T[],
  onReorder: (nextList: T[]) => void,
  canDragIndex: (index: number) => boolean = () => true,
) {
  const [armedIndex, setArmedIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  useEffect(() => {
    const clearArm = () => setArmedIndex(null);
    window.addEventListener('pointerup', clearArm);
    return () => window.removeEventListener('pointerup', clearArm);
  }, []);

  const getContainerProps = (index: number) => ({
    draggable: armedIndex === index && canDragIndex(index),
    onDragStart: (e: React.DragEvent) => {
      if (armedIndex !== index || !canDragIndex(index)) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(index));
      setDraggingIndex(index);
      setOverIndex(index);
    },
    onDragOver: (e: React.DragEvent) => {
      if (draggingIndex === null || !canDragIndex(index)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (overIndex !== index) {
        setOverIndex(index);
      }
    },
    onDrop: (e: React.DragEvent) => {
      if (draggingIndex === null || !canDragIndex(index)) return;
      e.preventDefault();
      if (draggingIndex !== index) {
        onReorder(reorderList(list, draggingIndex, index));
      }
      setArmedIndex(null);
      setDraggingIndex(null);
      setOverIndex(null);
    },
    onDragEnd: () => {
      setArmedIndex(null);
      setDraggingIndex(null);
      setOverIndex(null);
    },
  });

  const getHandleProps = (index: number) => ({
    'data-drag-handle': 'true',
    onPointerDown: () => {
      if (canDragIndex(index)) {
        setArmedIndex(index);
      }
    },
  });

  return {
    draggingIndex,
    overIndex,
    getContainerProps,
    getHandleProps,
  };
}
