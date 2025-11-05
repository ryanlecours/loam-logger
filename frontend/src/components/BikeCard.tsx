import type { Bike } from "../models/BikeComponents";
import { getBgColor, getBorderColor, getHealthStatus } from "../utils/getHealthStatus";
import {
  FaCheckCircle,
  FaExclamationCircle,
  FaExclamationTriangle,
} from "react-icons/fa";

const statusIcons = {
  ok: <FaCheckCircle className="text-green-600 inline ml-1" />,
  warning: <FaExclamationTriangle className="text-yellow-500 inline ml-1" />,
  danger: <FaExclamationCircle className="text-red-600 inline ml-1" />,
};

export default function BikeCard({ bike }: { bike: Bike }) {
  return (
    <div className="border rounded-md p-4 shadow-sm mb-4">
      <h2 className="text-xl font-bold">{bike.name}</h2>
      <p className={`flex justify-between px-2 py1 my-1 border-2 rounded-md ${getBgColor(bike.fork.hoursSinceLastService)} ${getBorderColor(bike.fork.hoursSinceLastService)}`}>
        <span className="text-accent">
          <strong>Fork:</strong> {bike.fork.brand} {bike.fork.model}
        </span>
        <span className="text-sm text-gray-600 flex items-center gap-1">
          {bike.fork.hoursSinceLastService}h{" "}
          {statusIcons[getHealthStatus(bike.fork.hoursSinceLastService)]}
        </span>
      </p>

      <p className={`flex justify-between px-2 py1 my-1 border-2 rounded-md ${getBgColor(bike.shock.hoursSinceLastService)} ${getBorderColor(bike.shock.hoursSinceLastService)}`}>
        <span className="text-accent">
          <strong>Shock:</strong> {bike.shock.brand} {bike.shock.model}
        </span>
        <span className="text-sm text-gray-600 flex items-center gap-1">
          {bike.shock.hoursSinceLastService}h{" "}
          {statusIcons[getHealthStatus(bike.shock.hoursSinceLastService)]}
        </span>
      </p>
      <p className={`flex justify-between px-2 py1 my-1 border-2 rounded-md ${getBgColor(bike.drivetrain.hoursSinceLastService)} ${getBorderColor(bike.drivetrain.hoursSinceLastService)}`}>
        <span className="text-accent">
          <strong>Drivetrain:</strong> {bike.drivetrain.brand} {bike.drivetrain.cassetteRange}
        </span>
        <span className="text-sm text-gray-600 flex items-center gap-1">
          {bike.drivetrain.hoursSinceLastService}h{" "}
          {statusIcons[getHealthStatus(bike.drivetrain.hoursSinceLastService)]}
        </span>
      </p>
      <p className={`flex justify-between px-2 py1 my-1 border-2 rounded-md ${getBgColor(bike.hoursSinceLastService)} ${getBorderColor(bike.hoursSinceLastService)}`}>
        <span className="text-accent">
          <strong>Pivot Bearings:</strong>
        </span>
        <span className="text-sm text-gray-600 flex items-center gap-1">
          {bike.hoursSinceLastService}h{" "}
          {statusIcons[getHealthStatus(bike.hoursSinceLastService)]}
        </span>
      </p>
    </div>
  );
}
