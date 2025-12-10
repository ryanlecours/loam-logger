import { useState } from "react";
import { useMutation } from "@apollo/client";
import type { Bike } from "../models/BikeComponents";
import { getHealthStatus } from "../utils/getHealthStatus";
import {
  FaCheckCircle,
  FaExclamationCircle,
  FaExclamationTriangle,
} from "react-icons/fa";
import { LOG_COMPONENT_SERVICE } from "../graphql/logComponentService";
import { BIKES } from "../graphql/bikes";

const statusIcons = {
  ok: <FaCheckCircle className="text-green-600 inline" />,
  warning: <FaExclamationTriangle className="text-yellow-500 inline" />,
  danger: <FaExclamationCircle className="text-red-600 inline" />,
};

// Format hours as "Xh Ym" rounded to nearest minute
function formatHoursAndMinutes(totalHours: number): string {
  const hours = Math.floor(totalHours);
  const minutes = Math.round((totalHours - hours) * 60);

  if (minutes === 60) {
    return `${hours + 1}h 0m`;
  }
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${minutes}m`;
}

type ComponentCardProps = {
  componentId: string;
  label: string;
  brand: string;
  model: string;
  hours: number;
};

function ComponentCard({ componentId, label, brand, model, hours }: ComponentCardProps) {
  const [isLogging, setIsLogging] = useState(false);
  const [logService] = useMutation(LOG_COMPONENT_SERVICE, {
    refetchQueries: [{ query: BIKES }],
  });

  const handleLogService = async () => {
    if (!componentId) {
      console.error("Cannot log service: componentId is missing");
      alert("Cannot log service: component ID is missing");
      return;
    }

    setIsLogging(true);
    try {
      await logService({
        variables: { id: componentId },
      });
    } catch (err) {
      console.error("Failed to log service:", err);
      alert("Failed to log service. Please try again.");
    } finally {
      setIsLogging(false);
    }
  };

  const status = getHealthStatus(hours);

  // Determine border color based on status
  let borderColorClass = 'border-green-500/50';
  let statusIconColor = statusIcons.ok;

  if (status === 'warning') {
    borderColorClass = 'border-yellow-500/50';
    statusIconColor = statusIcons.warning;
  } else if (status === 'danger') {
    borderColorClass = 'border-red-500/50';
    statusIconColor = statusIcons.danger;
  }

  return (
    <div className={`flex flex-col rounded-xl border-2 p-4 bg-surface-2/30 ${borderColorClass}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-accent">{label}</h3>
        {statusIconColor}
      </div>
      <p className="text-xs text-muted mb-auto">
        {brand} {model}
      </p>
      <p className="text-lg font-bold mb-3 text-white">{formatHoursAndMinutes(hours)}</p>
      <button
        onClick={handleLogService}
        disabled={isLogging}
        className="text-xs px-3 py-1.5 rounded-xl border-2 border-accent/60 text-accent hover:bg-accent/20 hover:border-accent transition disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLogging ? "Logging..." : "Log Service"}
      </button>
    </div>
  );
}

export default function BikeCard({ bike }: { bike: Bike }) {
  return (
    <div className="border rounded-xl p-5 shadow-sm mb-4">
      <h2 className="text-xl font-bold mb-4">{bike.name}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {bike.fork.id && (
          <ComponentCard
            componentId={bike.fork.id}
            label="Fork"
            brand={bike.fork.brand}
            model={bike.fork.model}
            hours={bike.fork.hoursSinceLastService}
          />
        )}
        {bike.shock.id && (
          <ComponentCard
            componentId={bike.shock.id}
            label="Shock"
            brand={bike.shock.brand}
            model={bike.shock.model}
            hours={bike.shock.hoursSinceLastService}
          />
        )}
        {bike.wheelBearings.id && (
          <ComponentCard
            componentId={bike.wheelBearings.id}
            label="Wheel Bearings"
            brand={bike.wheelBearings.brand}
            model={bike.wheelBearings.model}
            hours={bike.wheelBearings.hoursSinceLastService}
          />
        )}
        {bike.dropperPost.id && (
          <ComponentCard
            componentId={bike.dropperPost.id}
            label="Dropper Post"
            brand={bike.dropperPost.brand}
            model={bike.dropperPost.model}
            hours={bike.dropperPost.hoursSinceLastService}
          />
        )}
        {bike.pivotBearingsId && (
          <ComponentCard
            componentId={bike.pivotBearingsId}
            label="Pivot Bearings"
            brand="Pivot"
            model="Bearings"
            hours={bike.hoursSinceLastService}
          />
        )}
      </div>
    </div>
  );
}
