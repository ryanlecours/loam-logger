import { gql } from '@apollo/client';

export const SERVICE_PREFERENCE_DEFAULTS_QUERY = gql`
  query ServicePreferenceDefaults {
    servicePreferenceDefaults {
      componentType
      displayName
      defaultInterval
      defaultIntervalFront
      defaultIntervalRear
    }
  }
`;

export const USER_SERVICE_PREFERENCES_QUERY = gql`
  query UserServicePreferences {
    me {
      id
      servicePreferences {
        id
        componentType
        trackingEnabled
        customInterval
      }
    }
  }
`;

export const UPDATE_SERVICE_PREFERENCES_MUTATION = gql`
  mutation UpdateServicePreferences($input: UpdateServicePreferencesInput!) {
    updateServicePreferences(input: $input) {
      id
      componentType
      trackingEnabled
      customInterval
    }
  }
`;

// Bike-specific service preferences
export const BIKE_SERVICE_PREFERENCES_QUERY = gql`
  query BikeServicePreferences($bikeId: ID!) {
    bikes {
      id
      nickname
      manufacturer
      model
      servicePreferences {
        id
        componentType
        trackingEnabled
        customInterval
      }
    }
  }
`;

export const UPDATE_BIKE_SERVICE_PREFERENCES_MUTATION = gql`
  mutation UpdateBikeServicePreferences($input: UpdateBikeServicePreferencesInput!) {
    updateBikeServicePreferences(input: $input) {
      id
      componentType
      trackingEnabled
      customInterval
    }
  }
`;
