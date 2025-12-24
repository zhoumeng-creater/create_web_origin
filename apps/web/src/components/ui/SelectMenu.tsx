import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type SelectOption = {
  value: string;
  label: string;
};

type SelectMenuProps = {
  value: string;
  options: SelectOption[];
  ariaLabel: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export const SelectMenu = ({
  value,
  options,
  ariaLabel,
  onChange,
  placeholder = "Select",
}: SelectMenuProps) => {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  const [panelMaxHeight, setPanelMaxHeight] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current && !menuRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPanelMaxHeight(null);
      return;
    }
    const updatePlacement = () => {
      if (!triggerRef.current || !panelRef.current) {
        return;
      }
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const viewportGap = 12;
      const maxPanelHeight = 220;
      const availableBelow = window.innerHeight - triggerRect.bottom - viewportGap;
      const availableAbove = triggerRect.top - viewportGap;
      const naturalHeight = panelRef.current.scrollHeight;
      const shouldOpenUp =
        availableBelow < Math.min(maxPanelHeight, naturalHeight) && availableAbove > availableBelow;
      const availableSpace = shouldOpenUp ? availableAbove : availableBelow;
      setPlacement(shouldOpenUp ? "top" : "bottom");
      setPanelMaxHeight(Math.max(0, Math.min(maxPanelHeight, Math.floor(availableSpace))));
    };
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open, options.length]);

  return (
    <div
      className={`select-menu${open ? " open" : ""}${placement === "top" ? " top" : ""}`}
      ref={menuRef}
    >
      <button
        type="button"
        className="select-trigger"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        ref={triggerRef}
      >
        <span>{selected?.label ?? placeholder}</span>
        <span className="select-caret" aria-hidden="true" />
      </button>
      {open && (
        <div
          className="select-panel"
          role="listbox"
          aria-label={ariaLabel}
          ref={panelRef}
          style={panelMaxHeight !== null ? { maxHeight: `${panelMaxHeight}px` } : undefined}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`select-option${option.value === value ? " active" : ""}`}
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
