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
import { Modal, Button } from "./ui";

const statusIcons = {
  ok: <FaCheckCircle className="component-icon icon-good" />,
  warning: <FaExclamationTriangle className="component-icon icon-warning" />,
  danger: <FaExclamationCircle className="component-icon icon-danger" />,
};

type ComponentInfo = {
  id: string;
  label: string;
  brand: string;
  model: string;
  hours: number;
};

type ComponentRowProps = ComponentInfo & {
  status: "ok" | "warning" | "danger";
};

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

function getStatusVisuals(status: "ok" | "warning" | "danger") {
  let statusClass = "component-status-good";
  let statusIcon = statusIcons.ok;

  if (status === "warning") {
    statusClass = "component-status-warning";
    statusIcon = statusIcons.warning;
  } else if (status === "danger") {
    statusClass = "component-status-danger";
    statusIcon = statusIcons.danger;
  }

  return { statusClass, statusIcon };
}

function ComponentRow({ label, brand, model, hours, status }: ComponentRowProps) {
  const { statusClass, statusIcon } = getStatusVisuals(status);

  return (
    <div className={`component-row ${statusClass}`}>
      <div className="component-row-heading pl-4">
        <div className="component-row-title">
          <h3 className="component-label">{label}</h3>
          {statusIcon}
        </div>
        <span className="component-hours-pill">
          {formatHoursAndMinutes(hours)}
        </span>
      </div>
      <p className="component-details pl-4">
        {brand} {model}
      </p>
    </div>
  );
}

export default function BikeCard({ bike }: { bike: Bike }) {
  const [isOverlayOpen, setIsOverlayOpen] = useState(false);
  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>([]);
  const [isLogging, setIsLogging] = useState(false);
  const [logService] = useMutation(LOG_COMPONENT_SERVICE, {
    refetchQueries: [{ query: BIKES }],
  });

  const components: ComponentRowProps[] = [
    bike.fork.id
      ? {
          id: bike.fork.id,
          label: "Fork",
          brand: bike.fork.brand,
          model: bike.fork.model,
          hours: bike.fork.hoursSinceLastService,
          status: getHealthStatus(bike.fork.hoursSinceLastService),
        }
      : null,
    bike.shock.id
      ? {
          id: bike.shock.id,
          label: "Shock",
          brand: bike.shock.brand,
          model: bike.shock.model,
          hours: bike.shock.hoursSinceLastService,
          status: getHealthStatus(bike.shock.hoursSinceLastService),
        }
      : null,
    bike.wheelBearings.id
      ? {
          id: bike.wheelBearings.id,
          label: "Wheel Bearings",
          brand: bike.wheelBearings.brand,
          model: bike.wheelBearings.model,
          hours: bike.wheelBearings.hoursSinceLastService,
          status: getHealthStatus(bike.wheelBearings.hoursSinceLastService),
        }
      : null,
    bike.dropperPost.id
      ? {
          id: bike.dropperPost.id,
          label: "Dropper Post",
          brand: bike.dropperPost.brand,
          model: bike.dropperPost.model,
          hours: bike.dropperPost.hoursSinceLastService,
          status: getHealthStatus(bike.dropperPost.hoursSinceLastService),
        }
      : null,
    bike.pivotBearingsId
      ? {
          id: bike.pivotBearingsId,
          label: "Pivot Bearings",
          brand: "Pivot",
          model: "Bearings",
          hours: bike.hoursSinceLastService,
          status: getHealthStatus(bike.hoursSinceLastService),
        }
      : null,
  ].filter((component): component is ComponentRowProps => Boolean(component?.id));

  const toggleSelection = (componentId: string) => {
    setSelectedComponentIds((prev) =>
      prev.includes(componentId)
        ? prev.filter((id) => id !== componentId)
        : [...prev, componentId]
    );
  };

  const openServiceOverlay = () => {
    setSelectedComponentIds(components.map((component) => component.id));
    setIsOverlayOpen(true);
  };

  const handleLogService = async () => {
    if (selectedComponentIds.length === 0) {
      alert("Select at least one component to log.");
      return;
    }

    setIsLogging(true);
    try {
      await Promise.all(
        selectedComponentIds.map((id) =>
          logService({
            variables: { id },
          })
        )
      );
      setIsOverlayOpen(false);
    } catch (err) {
      console.error("Failed to log service:", err);
      alert("Failed to log service. Please try again.");
    } finally {
      setIsLogging(false);
    }
  };

  return (
    <div className="bike-card-container">
      <div className="bike-card-header">
        <h2 className="bike-name">{bike.name}</h2>
        {components.length > 0 && (
          <button
            onClick={openServiceOverlay}
            className="log-service-bike-btn"
            aria-label={`Log service for ${bike.name}`}
          >
            Log Service
          </button>
        )}
      </div>

      <div className="components-panel">
        {components.length === 0 ? (
          <p className="components-empty">No components available.</p>
        ) : (
          components.map((component) => (
            <ComponentRow key={component.id} {...component} />
          ))
        )}
      </div>

      <Modal
        isOpen={isOverlayOpen}
        onClose={() => setIsOverlayOpen(false)}
        title={bike.name}
        subtitle="Select the components you serviced."
        preventClose={isLogging}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setIsOverlayOpen(false)}
              disabled={isLogging}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleLogService}
              disabled={isLogging || selectedComponentIds.length === 0}
            >
              {isLogging ? "Logging..." : "Log Selected"}
            </Button>
          </>
        }
      >
        <div className="service-checkbox-list">
          {components.map((component) => {
            const { statusClass, statusIcon } = getStatusVisuals(
              component.status
            );

            return (
              <label
                key={component.id}
                className={`service-checkbox ${statusClass}`}
              >
                <input
                  type="checkbox"
                  checked={selectedComponentIds.includes(component.id)}
                  onChange={() => toggleSelection(component.id)}
                />
                <div className="service-checkbox-content">
                  <div className="service-checkbox-title">
                    <span className="component-label">{component.label}</span>
                    <span className="component-hours-pill small">
                      {formatHoursAndMinutes(component.hours)}
                    </span>
                  </div>
                  <p className="component-details">
                    {component.brand} {component.model}
                  </p>
                </div>
                {statusIcon}
              </label>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
