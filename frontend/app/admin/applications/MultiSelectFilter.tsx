'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { OPEN_KEYS, menuKeyAction, toggleSelection } from '@/lib/multi-select';
import { selectionSummary } from '@/lib/clinicians';

interface MultiSelectFilterProps {
  /** The filter's name — "Position". */
  label: string;
  options: readonly { value: string; label: string }[];
  /** The current selection, from the URL. */
  selected: readonly string[];
  noun: { all: string; plural: string };
  onChange: (next: string[]) => void;
}

/**
 * A compact multi-select for the clinician filters (WAI-ARIA listbox,
 * aria-multiselectable): a button summarising the choice ("All positions",
 * "RN, LVN", "3 positions") opens a list where each value toggles on its own.
 * Arrow keys, Home and End move; Space or Enter toggles; Escape, a click
 * outside, or tabbing out of the control closes it. Each change applies at once, like the other filters.
 */
export function MultiSelectFilter({ label, options, selected, noun, onChange }: MultiSelectFilterProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Toggles show at once, before the URL catches up; a new URL selection
  // (e.g. Clear filters) replaces them.
  const urlKey = selected.join('\u0000');
  const [shown, setShown] = useState<{ urlKey: string; values: readonly string[] }>({ urlKey, values: selected });
  const values = shown.urlKey === urlKey ? shown.values : selected;
  if (shown.urlKey !== urlKey) setShown({ urlKey, values: selected });

  const summary = selectionSummary(values, options, noun);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    listRef.current?.focus();
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  function openList() {
    const firstSelected = options.findIndex((o) => values.includes(o.value));
    setActiveIndex(firstSelected === -1 ? 0 : firstSelected);
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function toggle(value: string) {
    const next = toggleSelection(values, value, options);
    setShown({ urlKey, values: next });
    onChange(next);
  }

  function clear() {
    setShown({ urlKey, values: [] });
    onChange([]);
    close(true);
  }

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!open && OPEN_KEYS.includes(event.key)) {
      event.preventDefault();
      openList();
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const action = menuKeyAction(event.key, activeIndex, options.length);
    if (action.type === 'none') return;
    event.preventDefault();
    if (action.type === 'move') setActiveIndex(action.index);
    else if (action.type === 'toggle') toggle(options[activeIndex].value);
    else close(true);
  }

  const active = values.length > 0;
  const chosenLabels = options.filter((o) => values.includes(o.value)).map((o) => o.label);
  return (
    <div
      ref={rootRef}
      className="relative"
      // Escape closes from anywhere inside (the list or its Clear button);
      // focus moving out of the control (Tab past it) closes it too.
      onKeyDown={(e) => { if (open && e.key === 'Escape') { e.preventDefault(); close(true); } }}
      onBlur={(e) => { if (open && e.relatedTarget && !rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false); }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${summary}`}
        title={chosenLabels.length > 0 ? `${label}: ${chosenLabels.join(', ')}` : undefined}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onButtonKeyDown}
        className={`inline-flex items-center gap-1.5 max-w-[12rem] py-2 pl-3 pr-2 text-sm border rounded-lg bg-white cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
          active ? 'border-blue-300 text-blue-800 bg-blue-50' : 'border-slate-200 text-slate-700'
        }`}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown size={14} className="flex-shrink-0 text-slate-400" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-multiselectable="true"
            aria-label={label}
            aria-activedescendant={`${id}-opt-${activeIndex}`}
            tabIndex={0}
            onKeyDown={onListKeyDown}
            className="max-h-72 overflow-auto focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
          >
            {options.map((option, index) => {
              const isSelected = values.includes(option.value);
              return (
                <li
                  key={option.value}
                  id={`${id}-opt-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  // Keep focus on the list so the keyboard keeps working after a click.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setActiveIndex(index); toggle(option.value); }}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer ${
                    index === activeIndex ? 'bg-blue-50 outline outline-1 -outline-offset-1 outline-blue-300' : ''
                  } ${isSelected ? 'font-medium text-blue-800' : 'text-slate-700'}`}
                >
                  <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border ${isSelected ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'}`} aria-hidden="true">
                    {isSelected && <Check size={12} strokeWidth={3} />}
                  </span>
                  {option.label}
                </li>
              );
            })}
          </ul>
          {active && (
            <div className="border-t border-slate-100 px-3 pt-1.5 pb-1">
              <button type="button" onClick={clear} className="text-xs font-medium text-slate-500 hover:text-slate-800 focus:outline-none focus-visible:underline">
                Clear {label.toLowerCase()}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
