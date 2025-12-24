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
        <span className="sr-only">搜索作品</span>
        <input
          type="search"
          placeholder="搜索作品"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          aria-label="搜索作品"
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
        <span>筛选</span>
        {filterCount > 0 ? (
          <span className="library-command-count" aria-label={`已启用 ${filterCount} 个筛选`}>
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
