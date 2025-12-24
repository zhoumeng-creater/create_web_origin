export type FilterOption = {
  value: string;
  label: string;
};

type LibraryFiltersProps = {
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

export const LibraryFilters = ({
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
}: LibraryFiltersProps) => (
  <div className="library-filter-panel">
    <label className="library-filter-field">
      <span>风格</span>
      <select value={style} onChange={(event) => onStyleChange(event.target.value)}>
        {styleOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
    <label className="library-filter-field">
      <span>时长</span>
      <select value={duration} onChange={(event) => onDurationChange(event.target.value)}>
        {durationOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
    <label className="library-filter-field">
      <span>日期</span>
      <select value={date} onChange={(event) => onDateChange(event.target.value)}>
        {dateOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
    <div className="library-filter-actions">
      <button type="button" className="library-filter-clear" onClick={onClear}>
        清空筛选
      </button>
    </div>
  </div>
);
