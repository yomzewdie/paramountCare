// The Admin filter multi-select's behaviour, kept apart from its markup so it
// can be tested without a browser: what each key does, and how a value is
// toggled.

/** Selects or deselects one value, keeping the options' own order. */
export function toggleSelection(selected: readonly string[], value: string, options: readonly { value: string }[]): string[] {
  const next = selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value];
  return options.map((o) => o.value).filter((v) => next.includes(v));
}

export type MenuKeyAction =
  | { type: 'move'; index: number }
  | { type: 'toggle' }
  | { type: 'close' }
  | { type: 'none' };

/** What a key does in the open list (listbox pattern): arrows, Home and End
 * move the active option, Space or Enter toggles it, Escape closes. */
export function menuKeyAction(key: string, activeIndex: number, count: number): MenuKeyAction {
  if (count === 0) return key === 'Escape' ? { type: 'close' } : { type: 'none' };
  switch (key) {
    case 'ArrowDown': return { type: 'move', index: Math.min(count - 1, activeIndex + 1) };
    case 'ArrowUp': return { type: 'move', index: Math.max(0, activeIndex - 1) };
    case 'Home': return { type: 'move', index: 0 };
    case 'End': return { type: 'move', index: count - 1 };
    case ' ':
    case 'Enter': return { type: 'toggle' };
    case 'Escape': return { type: 'close' };
    default: return { type: 'none' };
  }
}

/** Keys on the closed button that open the list (as well as a click). */
export const OPEN_KEYS: readonly string[] = ['ArrowDown', 'ArrowUp', 'Enter', ' '];
