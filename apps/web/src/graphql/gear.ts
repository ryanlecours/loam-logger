import { gql } from '@apollo/client';

export const COMPONENT_FIELDS = gql`
  fragment ComponentFields on Component {
    id
    type
    brand
    model
    notes
    isStock
    bikeId
    hoursUsed
    serviceDueAtHours
    baselineWearPercent
    baselineMethod
    baselineConfidence
    baselineSetAt
    lastServicedAt
    location
  }
`;

export const PREDICTION_FIELDS = gql`
  fragment PredictionFields on BikePredictionSummary {
    bikeId
    bikeName
    overallStatus
    dueNowCount
    dueSoonCount
    generatedAt
    priorityComponent {
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
`;

export const BIKE_FIELDS = gql`
  fragment BikeFields on Bike {
    id
    nickname
    manufacturer
    model
    year
    travelForkMm
    travelShockMm
    notes
    spokesId
    # 99spokes metadata
    spokesUrl
    thumbnailUrl
    family
    category
    subcategory
    buildKind
    isFrameset
    isEbike
    gender
    frameMaterial
    hangerStandard
    # E-bike motor/battery specs
    motorMaker
    motorModel
    motorPowerW
    motorTorqueNm
    batteryWh
    acquisitionCondition
    components {
      ...ComponentFields
    }
    predictions {
      ...PredictionFields
    }
    createdAt
    updatedAt
  }
  ${COMPONENT_FIELDS}
  ${PREDICTION_FIELDS}
`;

export const GEAR_QUERY = gql`
  query Gear {
    bikes {
      ...BikeFields
    }
    spareComponents: components(
      filter: { onlySpare: true, types: [FORK, SHOCK, DROPPER, WHEELS] }
    ) {
      ...ComponentFields
    }
  }
  ${BIKE_FIELDS}
`;

export const ADD_BIKE = gql`
  mutation AddBike($input: AddBikeInput!) {
    addBike(input: $input) {
      ...BikeFields
    }
  }
  ${BIKE_FIELDS}
`;

export const UPDATE_BIKE = gql`
  mutation UpdateBike($id: ID!, $input: UpdateBikeInput!) {
    updateBike(id: $id, input: $input) {
      ...BikeFields
    }
  }
  ${BIKE_FIELDS}
`;

export const ADD_COMPONENT = gql`
  mutation AddComponent($input: AddComponentInput!, $bikeId: ID) {
    addComponent(input: $input, bikeId: $bikeId) {
      ...ComponentFields
    }
  }
  ${COMPONENT_FIELDS}
`;

export const UPDATE_COMPONENT = gql`
  mutation UpdateComponent($id: ID!, $input: UpdateComponentInput!) {
    updateComponent(id: $id, input: $input) {
      ...ComponentFields
    }
  }
  ${COMPONENT_FIELDS}
`;

export const DELETE_COMPONENT = gql`
  mutation DeleteComponent($id: ID!) {
    deleteComponent(id: $id) {
      ok
      id
    }
  }
`;

export const DELETE_BIKE = gql`
  mutation DeleteBike($id: ID!) {
    deleteBike(id: $id) {
      ok
      id
    }
  }
`;

export const BULK_UPDATE_BASELINES = gql`
  mutation BulkUpdateBaselines($input: BulkUpdateBaselinesInput!) {
    bulkUpdateComponentBaselines(input: $input) {
      ...ComponentFields
    }
  }
  ${COMPONENT_FIELDS}
`;
