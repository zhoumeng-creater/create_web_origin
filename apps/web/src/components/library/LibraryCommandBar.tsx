type FilterChip = {
  id: string;
  label: string;
  onClear: () => void;
};

type LibraryCommandBarProps = {
  query: string;
  filterCount: number;
  chips: FilterChip[];
  isFiltersOpen: boolean;
  onQueryChange: (value: string) => void;
  onOpenFilters: () => void;
};

export const LibraryCommandBar = ({
  query,
  filterCount,
  chips,
  isFiltersOpen,
  onQueryChange,
  onOpenFilters,
}: LibraryCommandBarProps) => (
  <div className="library-command">
    <div className="library-command-bar">
      <label className="library-command-search">
        <span className="sr-only">Search works</span>
        <input
          type="search"
          placeholder="Search works"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label="Search works"
        />
      </label>
      <button
        type="button"
        className="library-command-filter"
        onClick={onOpenFilters}
        aria-expanded={isFiltersOpen}
        aria-controls="library-filters-drawer"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path
            d="M4 5h12M6.5 10h7M9 15h2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        <span>Filters</span>
        {filterCount > 0 ? (
          <span className="library-command-count" aria-label={`${filterCount} active filters`}>
            {filterCount}
          </span>
        ) : null}
      </button>
    </div>
    {chips.length > 0 ? (
      <div className="library-chips" role="list">
        {chips.map((chip) => (
          <button
            key={chip.id}
            type="button"
            className="library-chip"
            onClick={chip.onClear}
          >
            <span>{chip.label}</span>
            <span aria-hidden="true">x</span>
          </button>
        ))}
      </div>
    ) : null}
  </div>
);
