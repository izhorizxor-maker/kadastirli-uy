import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { normalizeUzbekSearch } from '../shared/uzbekistanRegions.ts';

export interface GeoOption {
  value: string;
  label: string;
  subtitle?: string;
  meta?: unknown;
}

interface SearchableGeoSelectProps {
  value: string;
  options: GeoOption[];
  placeholder: string;
  allOptionLabel?: string;
  includeAllOption?: boolean;
  disabled?: boolean;
  allowCustomValue?: boolean;
  ariaLabel: string;
  className?: string;
  onChange: (value: string, option?: GeoOption) => void;
}

export function SearchableGeoSelect({
  value,
  options,
  placeholder,
  allOptionLabel = 'Barchasi',
  includeAllOption = true,
  disabled = false,
  allowCustomValue = false,
  ariaLabel,
  className = '',
  onChange,
}: SearchableGeoSelectProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [highlightedIdx, setHighlightedIdx] = useState(0);

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  );

  // Sync display text when closed or external value changes
  useEffect(() => {
    if (!isOpen) {
      if (includeAllOption && value === 'ALL') {
        setInputText('');
      } else if (selectedOption) {
        setInputText(selectedOption.label);
      } else if (value && value !== 'ALL') {
        setInputText(value);
      } else {
        setInputText('');
      }
    }
  }, [value, selectedOption, isOpen, includeAllOption]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    const normQuery = normalizeUzbekSearch(inputText);
    const list: GeoOption[] = [];

    if (includeAllOption) {
      if (!normQuery || normalizeUzbekSearch(allOptionLabel).includes(normQuery)) {
        list.push({ value: 'ALL', label: allOptionLabel });
      }
    }

    for (const opt of options) {
      if (!normQuery) {
        list.push(opt);
        continue;
      }
      const haystack = normalizeUzbekSearch(`${opt.label} ${opt.subtitle || ''}`);
      const tokens = normQuery.split(' ').filter(Boolean);
      if (tokens.every((t) => haystack.includes(t))) {
        list.push(opt);
      }
    }

    return list;
  }, [options, inputText, includeAllOption, allOptionLabel]);

  useEffect(() => {
    setHighlightedIdx(0);
  }, [inputText, isOpen]);

  const commitSelection = (opt: GeoOption) => {
    setIsOpen(false);
    if (includeAllOption && opt.value === 'ALL') {
      setInputText('');
    } else {
      setInputText(opt.label);
    }
    onChange(opt.value, opt);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (!isOpen && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      setIsOpen(true);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIdx((prev) =>
        filteredOptions.length > 0 ? (prev + 1) % filteredOptions.length : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIdx((prev) =>
        filteredOptions.length > 0
          ? (prev - 1 + filteredOptions.length) % filteredOptions.length
          : 0
      );
    } else if (e.key === 'Enter') {
      if (isOpen && filteredOptions[highlightedIdx]) {
        e.preventDefault();
        commitSelection(filteredOptions[highlightedIdx]);
      } else if (allowCustomValue && inputText.trim()) {
        e.preventDefault();
        setIsOpen(false);
        onChange(inputText.trim());
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
    }
  };

  const showClear = !disabled && ((includeAllOption && value !== 'ALL') || (!includeAllOption && Boolean(value)) || Boolean(inputText));

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-label={ariaLabel}
          disabled={disabled}
          value={isOpen ? inputText : value === 'ALL' ? '' : selectedOption?.label || value || ''}
          placeholder={value === 'ALL' && includeAllOption ? allOptionLabel : placeholder}
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true);
              setInputText('');
            }
          }}
          onChange={(e) => {
            const nextVal = e.target.value;
            setInputText(nextVal);
            if (!isOpen) setIsOpen(true);
            if (allowCustomValue) {
              onChange(nextVal);
            }
          }}
          onKeyDown={handleKeyDown}
          className={`w-full rounded-lg border border-slate-300 bg-white pl-3 pr-14 py-2 text-xs sm:text-sm font-medium text-slate-900 placeholder:text-slate-700 focus:placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10 disabled:bg-slate-100 disabled:text-slate-500 min-h-[40px] truncate ${
            value !== 'ALL' && !isOpen ? 'border-slate-400 bg-slate-50/50' : ''
          }`}
        />

        <div className="absolute right-1.5 inset-y-0 flex items-center gap-0.5">
          {showClear && (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Tanlovni tozalash"
              onClick={(e) => {
                e.stopPropagation();
                setInputText('');
                if (includeAllOption) {
                  onChange('ALL');
                } else if (allowCustomValue) {
                  onChange('');
                }
                setIsOpen(false);
              }}
              className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            aria-label="Ro‘yxatni ochish"
            onClick={() => {
              if (disabled) return;
              if (isOpen) {
                setIsOpen(false);
              } else {
                setIsOpen(true);
                setInputText('');
                inputRef.current?.focus();
              }
            }}
            className="p-1 rounded text-slate-500 hover:text-slate-800 disabled:opacity-40"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {isOpen && !disabled && (
        <div className="absolute left-0 right-0 sm:min-w-[250px] top-full mt-1.5 z-[650] rounded-xl border border-slate-200 bg-white shadow-lg overflow-hidden max-h-72 overflow-y-auto">
          {filteredOptions.length > 0 ? (
            <ul role="listbox" className="divide-y divide-slate-100 py-1">
              {filteredOptions.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isHighlighted = idx === highlightedIdx;
                return (
                  <li key={`${opt.value}-${opt.subtitle || idx}`} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlightedIdx(idx)}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        commitSelection(opt);
                      }}
                      className={`w-full text-left px-3 py-2 text-xs sm:text-sm flex items-center justify-between gap-2 transition-colors ${
                        isHighlighted
                          ? 'bg-slate-100 text-slate-950'
                          : isSelected
                            ? 'bg-slate-50 font-semibold text-slate-900'
                            : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="truncate font-medium">{opt.label}</span>
                      {opt.subtitle && (
                        <span className="text-[11px] text-slate-400 shrink-0 truncate max-w-[115px]">
                          {opt.subtitle}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-3.5 py-3 text-xs text-slate-500">
              Mos viloyat yoki tuman topilmadi.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
