type BikeDto = {
  id: string;
  model?: string | null;
  travelForkMm?: number | null;
  travelShockMm?: number | null;
  frameMaterial?: string | null;
  hangerStandard?: string | null;
  category?: string | null;
  subcategory?: string | null;
  isEbike?: boolean | null;
  motorMaker?: string | null;
  motorModel?: string | null;
  motorPowerW?: number | null;
  motorTorqueNm?: number | null;
  batteryWh?: number | null;
};

interface BikeSpecsGridProps {
  bike: BikeDto;
  onEditTravel?: (field: 'fork' | 'shock') => void;
}

interface SpecItem {
  label: string;
  value: string | number;
  editable?: boolean;
  field?: 'fork' | 'shock';
}

export function BikeSpecsGrid({ bike, onEditTravel }: BikeSpecsGridProps) {
  // Build specs array - travel specs always shown, others only if value exists
  const specs: SpecItem[] = [];

  // Always show Fork Travel (editable)
  specs.push({
    label: 'Fork Travel',
    value: bike.travelForkMm ? `${bike.travelForkMm}mm` : '--',
    editable: true,
    field: 'fork',
  });

  // Always show Shock Travel (editable)
  specs.push({
    label: 'Shock Travel',
    value: bike.travelShockMm ? `${bike.travelShockMm}mm` : '--',
    editable: true,
    field: 'shock',
  });

  // Model instead of Family
  if (bike.model) {
    specs.push({ label: 'Model', value: bike.model });
  }

  // Removed: Build (buildKind) and Fit (gender)

  return (
    <div className="bike-detail-section">
      <h3 className="bike-detail-section-title">Specifications</h3>
      <div className="bike-specs-grid">
        {specs.map((spec) => (
          <div
            key={spec.label}
            className={`bike-spec-item ${spec.editable && onEditTravel ? 'bike-spec-item--editable' : ''}`}
            onClick={spec.editable && onEditTravel && spec.field ? () => onEditTravel(spec.field!) : undefined}
            role={spec.editable && onEditTravel ? 'button' : undefined}
            tabIndex={spec.editable && onEditTravel ? 0 : undefined}
            onKeyDown={spec.editable && onEditTravel && spec.field ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onEditTravel(spec.field!);
              }
            } : undefined}
          >
            <span className="bike-spec-label">{spec.label}</span>
            <span className="bike-spec-value">{spec.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface EbikeSpecsGridProps {
  bike: BikeDto;
}

export function EbikeSpecsGrid({ bike }: EbikeSpecsGridProps) {
  if (!bike.isEbike) {
    return null;
  }

  const specs: SpecItem[] = [];

  if (bike.motorMaker || bike.motorModel) {
    const motorName = [bike.motorMaker, bike.motorModel].filter(Boolean).join(' ');
    if (motorName) {
      specs.push({ label: 'Motor', value: motorName });
    }
  }
  if (bike.motorPowerW) {
    specs.push({ label: 'Power', value: `${bike.motorPowerW}W` });
  }
  if (bike.motorTorqueNm) {
    specs.push({ label: 'Torque', value: `${bike.motorTorqueNm}Nm` });
  }
  if (bike.batteryWh) {
    specs.push({ label: 'Battery', value: `${bike.batteryWh}Wh` });
  }

  if (specs.length === 0) {
    return null;
  }

  return (
    <div className="bike-detail-section">
      <h3 className="bike-detail-section-title">E-Bike Specifications</h3>
      <div className="ebike-specs-grid">
        {specs.map((spec) => (
          <div key={spec.label} className="bike-spec-item">
            <span className="bike-spec-label">{spec.label}</span>
            <span className="bike-spec-value">{spec.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
