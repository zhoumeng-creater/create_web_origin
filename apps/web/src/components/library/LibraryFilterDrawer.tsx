import { useEffect } from "react";

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
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onClose]);

  return (
    <div
      className={`library-drawer${open ? " open" : ""}`}
      aria-hidden={!open}
      id="library-filters-drawer"
    >
      <div className="library-drawer-overlay" role="presentation" onClick={onClose} />
      <aside className="library-drawer-panel" role="dialog" aria-modal="true" aria-label="Filters">
        <header className="library-drawer-header">
          <div>
            <div className="library-drawer-title">Filters</div>
            <div className="library-drawer-subtitle">Refine your library view.</div>
          </div>
          <button type="button" className="library-drawer-close" onClick={onClose}>
            Close
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
