import { useEffect, useRef } from "react";

import { LibraryFilters, type FilterOption } from "./LibraryFilters";

type LibraryFilterDrawerProps = {
  open: boolean;
  onClose: () => void;
  style: string;
  duration: string;
  date: string;
  styleOptions: FilterOption[];
  durationOptions: FilterOption[];
  dateOptions: FilterOption[];
  onStyleChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onClear: () => void;
};

export const LibraryFilterDrawer = ({
  open,
  onClose,
  style,
  duration,
  date,
  styleOptions,
  durationOptions,
  dateOptions,
  onStyleChange,
  onDurationChange,
  onDateChange,
  onClear,
}: LibraryFilterDrawerProps) => {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (panelRef.current && target && panelRef.current.contains(target)) {
        return;
      }
      if (target?.closest?.("[data-filter-trigger='library-filters']")) {
        return;
      }
      onClose();
    };
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointer);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointer);
    };
  }, [open, onClose]);

  return (
    <div
      className={`library-drawer${open ? " open" : ""}`}
      aria-hidden={!open}
      id="library-filters-drawer"
    >
      <div className="library-drawer-overlay" role="presentation" />
      <aside
        className="library-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        ref={panelRef}
      >
        <header className="library-drawer-header">
          <div>
            <div className="library-drawer-title">筛选</div>
            <div className="library-drawer-subtitle">细化作品筛选条件。</div>
          </div>
                    <button
            type="button"
            className="library-drawer-close"
            onClick={onClose}
            aria-label="Close filters"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path
                d="M4 4l8 8M12 4l-8 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <LibraryFilters
          style={style}
          duration={duration}
          date={date}
          styleOptions={styleOptions}
          durationOptions={durationOptions}
          dateOptions={dateOptions}
          onStyleChange={onStyleChange}
          onDurationChange={onDurationChange}
          onDateChange={onDateChange}
          onClear={onClear}
        />
      </aside>
    </div>
  );
};
