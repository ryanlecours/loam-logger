-- AddCalibrationFields
-- Adds calibration tracking fields to User for first-dashboard calibration overlay

ALTER TABLE "User" ADD COLUMN "calibrationCompletedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "calibrationDismissedAt" TIMESTAMP(3);
