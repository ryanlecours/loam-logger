interface BikeOption {
  id: string;
  name: string;
}

interface BikeFilterDropdownProps {
  bikes: BikeOption[];
  selected: string | null;
  onSelect: (bikeId: string | null) => void;
}

export default function BikeFilterDropdown({
  bikes,
  selected,
  onSelect,
}: BikeFilterDropdownProps) {
  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    onSelect(value === '' ? null : value);
  };

  return (
    <div className="bike-filter-dropdown">
      <select
        value={selected ?? ''}
        onChange={handleChange}
        className="bike-filter-select"
      >
        <option value="">All Bikes</option>
        {bikes.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );
}
