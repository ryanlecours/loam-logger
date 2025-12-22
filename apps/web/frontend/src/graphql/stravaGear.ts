import { gql } from '@apollo/client';

export const UNMAPPED_STRAVA_GEARS = gql`
  query UnmappedStravaGears {
    unmappedStravaGears {
      gearId
      gearName
      rideCount
      isMapped
    }
  }
`;

export const STRAVA_GEAR_MAPPINGS = gql`
  query StravaGearMappings {
    stravaGearMappings {
      id
      stravaGearId
      stravaGearName
      bikeId
      bike {
        id
        nickname
        manufacturer
        model
      }
      createdAt
    }
  }
`;

export const CREATE_STRAVA_GEAR_MAPPING = gql`
  mutation CreateStravaGearMapping($input: CreateStravaGearMappingInput!) {
    createStravaGearMapping(input: $input) {
      id
      stravaGearId
      stravaGearName
      bikeId
    }
  }
`;

export const DELETE_STRAVA_GEAR_MAPPING = gql`
  mutation DeleteStravaGearMapping($id: ID!) {
    deleteStravaGearMapping(id: $id) {
      ok
      id
    }
  }
`;
