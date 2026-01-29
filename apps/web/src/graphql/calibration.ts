import { gql, useQuery, useMutation } from '@apollo/client';
import type { ComponentPrediction } from '../types/prediction';
import { BIKES } from './bikes';

export const CALIBRATION_STATE = gql`
  query CalibrationState {
    calibrationState {
      showOverlay
      overdueCount
      totalComponentCount
      bikes {
        bikeId
        bikeName
        thumbnailUrl
        components {
          componentId
          componentType
          location
          brand
          model
          status
          hoursRemaining
          ridesRemainingEstimate
          confidence
          currentHours
          serviceIntervalHours
          hoursSinceService
        }
      }
    }
  }
`;

export const LOG_BULK_SERVICE = gql`
  mutation LogBulkComponentService($input: BulkServiceLogInput!) {
    logBulkComponentService(input: $input) {
      success
      updatedCount
    }
  }
`;

export const DISMISS_CALIBRATION = gql`
  mutation DismissCalibration {
    dismissCalibration {
      id
    }
  }
`;

export const COMPLETE_CALIBRATION = gql`
  mutation CompleteCalibration {
    completeCalibration {
      id
    }
  }
`;

export const RESET_CALIBRATION = gql`
  mutation ResetCalibration {
    resetCalibration {
      id
    }
  }
`;

export const SNOOZE_COMPONENT = gql`
  mutation SnoozeComponent($id: ID!, $hours: Float) {
    snoozeComponent(id: $id, hours: $hours) {
      id
      serviceDueAtHours
    }
  }
`;

export type BikeCalibrationInfo = {
  bikeId: string;
  bikeName: string;
  thumbnailUrl: string | null;
  components: ComponentPrediction[];
};

export type CalibrationState = {
  showOverlay: boolean;
  overdueCount: number;
  totalComponentCount: number;
  bikes: BikeCalibrationInfo[];
};

export function useCalibrationState() {
  return useQuery<{ calibrationState: CalibrationState }>(CALIBRATION_STATE, {
    fetchPolicy: 'cache-and-network',
  });
}

export function useLogBulkService() {
  return useMutation<
    { logBulkComponentService: { success: boolean; updatedCount: number } },
    { input: { componentIds: string[]; performedAt: string } }
  >(LOG_BULK_SERVICE, {
    refetchQueries: [{ query: CALIBRATION_STATE }, { query: BIKES }],
  });
}

export function useDismissCalibration() {
  return useMutation<{ dismissCalibration: { id: string } }>(DISMISS_CALIBRATION, {
    refetchQueries: [{ query: CALIBRATION_STATE }],
  });
}

export function useCompleteCalibration() {
  return useMutation<{ completeCalibration: { id: string } }>(COMPLETE_CALIBRATION, {
    refetchQueries: [{ query: CALIBRATION_STATE }],
  });
}

export function useResetCalibration() {
  return useMutation<{ resetCalibration: { id: string } }>(RESET_CALIBRATION, {
    refetchQueries: [{ query: CALIBRATION_STATE }],
  });
}

export function useSnoozeComponent() {
  return useMutation<
    { snoozeComponent: { id: string; serviceDueAtHours: number } },
    { id: string; hours?: number }
  >(SNOOZE_COMPONENT, {
    refetchQueries: [{ query: CALIBRATION_STATE }, { query: BIKES }],
  });
}
