type BikeDto = {
  id: string;
  travelForkMm?: number | null;
  travelShockMm?: number | null;
  frameMaterial?: string | null;
  hangerStandard?: string | null;
  category?: string | null;
  subcategory?: string | null;
  family?: string | null;
  buildKind?: string | null;
  gender?: string | null;
  isEbike?: boolean | null;
  motorMaker?: string | null;
  motorModel?: string | null;
  motorPowerW?: number | null;
  motorTorqueNm?: number | null;
  batteryWh?: number | null;
};

interface BikeSpecsGridProps {
  bike: BikeDto;
}

interface SpecItem {
  label: string;
  value: string | number;
}

export function BikeSpecsGrid({ bike }: BikeSpecsGridProps) {
  // Build specs array dynamically - only include items with values
  const specs: SpecItem[] = [];

  if (bike.travelForkMm) {
    specs.push({ label: 'Fork Travel', value: `${bike.travelForkMm}mm` });
  }
  if (bike.travelShockMm) {
    specs.push({ label: 'Shock Travel', value: `${bike.travelShockMm}mm` });
  }
  if (bike.frameMaterial) {
    specs.push({ label: 'Frame Material', value: bike.frameMaterial });
  }
  if (bike.hangerStandard) {
    specs.push({ label: 'Hanger Standard', value: bike.hangerStandard });
  }
  if (bike.family) {
    specs.push({ label: 'Family', value: bike.family });
  }
  if (bike.buildKind) {
    specs.push({ label: 'Build', value: bike.buildKind });
  }
  if (bike.gender) {
    specs.push({ label: 'Fit', value: bike.gender });
  }

  if (specs.length === 0) {
    return null;
  }

  return (
    <div className="bike-detail-section">
      <h3 className="bike-detail-section-title">Specifications</h3>
      <div className="bike-specs-grid">
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
