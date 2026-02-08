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
    status
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

// Light bike fields - no predictions, for fast initial loading
export const BIKE_FIELDS_LIGHT = gql`
  fragment BikeFieldsLight on Bike {
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
    createdAt
    updatedAt
  }
  ${COMPONENT_FIELDS}
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
    servicePreferences {
      id
      componentType
      trackingEnabled
      customInterval
    }
    createdAt
    updatedAt
  }
  ${COMPONENT_FIELDS}
  ${PREDICTION_FIELDS}
`;

// Fast gear query without predictions - use for initial load
export const GEAR_QUERY_LIGHT = gql`
  query GearLight {
    bikes {
      ...BikeFieldsLight
    }
    spareComponents: components(filter: { onlySpare: true }) {
      ...ComponentFields
    }
  }
  ${BIKE_FIELDS_LIGHT}
`;

// Full gear query with predictions - use when predictions are needed
export const GEAR_QUERY = gql`
  query Gear {
    bikes {
      ...BikeFields
    }
    spareComponents: components(filter: { onlySpare: true }) {
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

export const BIKE_NOTE_FIELDS = gql`
  fragment BikeNoteFields on BikeNote {
    id
    bikeId
    userId
    text
    noteType
    createdAt
    installEventId
  }
`;

export const SETUP_SNAPSHOT_FIELDS = gql`
  fragment SetupSnapshotFields on SetupSnapshot {
    capturedAt
    bikeSpecs {
      travelForkMm
      travelShockMm
      isEbike
      batteryWh
      motorPowerW
      motorTorqueNm
      motorMaker
      motorModel
    }
    slots {
      slotKey
      componentType
      location
      component {
        componentId
        brand
        model
        isStock
        hoursUsed
        serviceDueAtHours
        settings {
          key
          value
          unit
          label
        }
      }
    }
  }
`;

export const INSTALL_COMPONENT = gql`
  mutation InstallComponent($input: InstallComponentInput!) {
    installComponent(input: $input) {
      installedComponent {
        ...ComponentFields
      }
      displacedComponent {
        ...ComponentFields
      }
      note {
        ...BikeNoteFields
      }
    }
  }
  ${COMPONENT_FIELDS}
  ${BIKE_NOTE_FIELDS}
`;

export const SWAP_COMPONENTS = gql`
  mutation SwapComponents($input: SwapComponentsInput!) {
    swapComponents(input: $input) {
      componentA {
        ...ComponentFields
      }
      componentB {
        ...ComponentFields
      }
      noteA {
        ...BikeNoteFields
      }
      noteB {
        ...BikeNoteFields
      }
    }
  }
  ${COMPONENT_FIELDS}
  ${BIKE_NOTE_FIELDS}
`;

export const BIKE_NOTES_QUERY = gql`
  query BikeNotes($bikeId: ID!, $take: Int, $after: ID) {
    bikeNotes(bikeId: $bikeId, take: $take, after: $after) {
      items {
        ...BikeNoteFields
        snapshot {
          ...SetupSnapshotFields
        }
        snapshotBefore {
          ...SetupSnapshotFields
        }
        snapshotAfter {
          ...SetupSnapshotFields
        }
      }
      totalCount
      hasMore
    }
  }
  ${BIKE_NOTE_FIELDS}
  ${SETUP_SNAPSHOT_FIELDS}
`;

export const ADD_BIKE_NOTE = gql`
  mutation AddBikeNote($input: AddBikeNoteInput!) {
    addBikeNote(input: $input) {
      ...BikeNoteFields
      snapshot {
        ...SetupSnapshotFields
      }
    }
  }
  ${BIKE_NOTE_FIELDS}
  ${SETUP_SNAPSHOT_FIELDS}
`;

export const DELETE_BIKE_NOTE = gql`
  mutation DeleteBikeNote($id: ID!) {
    deleteBikeNote(id: $id) {
      ok
      id
    }
  }
`;
