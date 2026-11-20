/**
 * Open order of the dialog overlays: the LAST opened dialog owns Escape.
 * Every dialog overlay registers on mount and unregisters on unmount;
 * a capture-phase Esc handler only acts while its id is on top, so two
 * stacked modals close one at a time instead of both.
 */
const stack: number[] = [];
let nextId = 0;

export function pushDialog(): number {
  const id = ++nextId;
  stack.push(id);
  return id;
}

export function popDialog(id: number): void {
  const i = stack.lastIndexOf(id);
  if (i >= 0) stack.splice(i, 1);
}

export function isTopDialog(id: number): boolean {
  return stack[stack.length - 1] === id;
}
