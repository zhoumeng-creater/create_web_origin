type FilterOption = {
  value: string;
  label: string;
};

type LibraryFiltersProps = {
  query: string;
  style: string;
  duration: string;
  date: string;
  styleOptions: FilterOption[];
  durationOptions: FilterOption[];
  dateOptions: FilterOption[];
  onQueryChange: (value: string) => void;
  onStyleChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onClear: () => void;
};

export const LibraryFilters = ({
  query,
  style,
  duration,
  date,
  styleOptions,
  durationOptions,
  dateOptions,
  onQueryChange,
  onStyleChange,
  onDurationChange,
  onDateChange,
  onClear,
}: LibraryFiltersProps) => (
  <div className="library-filters">
    <label className="library-search">
      <span>Search</span>
      <input
        type="search"
        placeholder="Search by title or prompt"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
    </label>
    <div className="library-filter-group">
      <label>
        <span>Style</span>
        <select value={style} onChange={(event) => onStyleChange(event.target.value)}>
          {styleOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Duration</span>
        <select value={duration} onChange={(event) => onDurationChange(event.target.value)}>
          {durationOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Date</span>
        <select value={date} onChange={(event) => onDateChange(event.target.value)}>
          {dateOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="library-clear" onClick={onClear}>
        Clear
      </button>
    </div>
  </div>
);
