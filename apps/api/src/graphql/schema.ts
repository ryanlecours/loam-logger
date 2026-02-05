import { gql } from 'graphql-tag';

export const typeDefs = gql`

  enum RideType {
    TRAIL
    ENDURO
    COMMUTE
    ROAD
    GRAVEL
    TRAINER
  }

  enum ComponentType {
    FORK
    SHOCK
    BRAKES
    DRIVETRAIN
    TIRES
    WHEEL_HUBS
    DROPPER
    PEDALS
    CHAIN
    CASSETTE
    OTHER
    PIVOT_BEARINGS
    STEM
    HANDLEBAR
    SADDLE
    SEATPOST
    RIMS
    CRANK
    REAR_DERAILLEUR
    BRAKE_PAD
    BRAKE_ROTOR
    HEADSET
    BOTTOM_BRACKET
  }

  enum ComponentLocation {
    FRONT
    REAR
    NONE
  }

  enum PredictionStatus {
    ALL_GOOD
    DUE_SOON
    DUE_NOW
    OVERDUE
  }

  enum ConfidenceLevel {
    HIGH
    MEDIUM
    LOW
  }

  enum UserRole {
    WAITLIST
    FREE
    PRO
    ADMIN
  }

  enum SyncProvider {
    STRAVA
    GARMIN
    WHOOP
    SUUNTO
  }

  enum AcquisitionCondition {
    NEW
    USED
    MIXED
  }

  enum BaselineMethod {
    DEFAULT
    SLIDER
    DATES
  }

  enum BaselineConfidence {
    LOW
    MEDIUM
    HIGH
  }

  enum ComponentStatus {
    INVENTORY
    INSTALLED
    RETIRED
  }

  enum TriggerSyncStatus {
    QUEUED
    ALREADY_QUEUED
    RATE_LIMITED
  }

  type TriggerSyncResult {
    status: TriggerSyncStatus!
    message: String!
    retryAfter: Int
    jobId: String
  }

  type Ride {
    id: ID!
    userId: ID!
    garminActivityId: String
    stravaActivityId: String
    whoopWorkoutId: String
    stravaGearId: String
    startTime: String!
    durationSeconds: Int!
    distanceMiles: Float!
    elevationGainFeet: Float!
    averageHr: Int
    rideType: String!
    bikeId: ID
    notes: String
    trailSystem: String
    location: String
    createdAt: String!
    updatedAt: String!
  }

  type Component {
    id: ID!
    type: ComponentType!
    location: ComponentLocation!
    brand: String!
    model: String!
    installedAt: String
    hoursUsed: Float!
    serviceDueAtHours: Float
    notes: String
    isStock: Boolean!
    bikeId: ID
    isSpare: Boolean!
    status: ComponentStatus!
    baselineWearPercent: Int
    baselineMethod: BaselineMethod!
    baselineConfidence: BaselineConfidence!
    baselineSetAt: String
    lastServicedAt: String
    serviceLogs: [ServiceLog!]!
    createdAt: String!
    updatedAt: String!
    # Front/rear pairing support
    pairGroupId: String
    retiredAt: String
    replacedById: ID
    pairedComponent: Component
  }

  type ServiceLog {
    id: ID!
    componentId: ID!
    performedAt: String!
    notes: String
    hoursAtService: Float!
    createdAt: String!
  }

  type WearDriver {
    factor: String!
    contribution: Int!
    label: String!
  }

  type ComponentPrediction {
    componentId: ID!
    componentType: ComponentType!
    location: ComponentLocation!
    brand: String!
    model: String!
    status: PredictionStatus!
    hoursRemaining: Float!
    ridesRemainingEstimate: Int!
    confidence: ConfidenceLevel!
    currentHours: Float!
    serviceIntervalHours: Float!
    hoursSinceService: Float!
    why: String
    drivers: [WearDriver!]
  }

  type BikePredictionSummary {
    bikeId: ID!
    bikeName: String!
    components: [ComponentPrediction!]!
    priorityComponent: ComponentPrediction
    overallStatus: PredictionStatus!
    dueNowCount: Int!
    dueSoonCount: Int!
    generatedAt: String!
    algoVersion: String!
  }

  type Bike {
    id: ID!
    nickname: String
    manufacturer: String!
    model: String!
    year: Int
    travelForkMm: Int
    travelShockMm: Int
    notes: String
    sortOrder: Int!
    spokesId: String
    spokesUrl: String
    thumbnailUrl: String
    family: String
    category: String
    subcategory: String
    buildKind: String
    isFrameset: Boolean
    isEbike: Boolean
    gender: String
    frameMaterial: String
    hangerStandard: String
    # E-bike motor/battery specs
    motorMaker: String
    motorModel: String
    motorPowerW: Int
    motorTorqueNm: Int
    batteryWh: Int
    acquisitionCondition: AcquisitionCondition
    fork: Component
    shock: Component
    seatpost: Component
    wheels: Component
    pivotBearings: Component
    components: [Component!]!
    predictions: BikePredictionSummary
    servicePreferences: [BikeServicePreference!]!
    createdAt: String!
    updatedAt: String!
  }

  type StravaGearMapping {
    id: ID!
    stravaGearId: String!
    stravaGearName: String
    bikeId: ID!
    bike: Bike!
    createdAt: String!
  }

  type StravaGearInfo {
    gearId: String!
    gearName: String
    rideCount: Int!
    isMapped: Boolean!
  }

  input CreateStravaGearMappingInput {
    stravaGearId: String!
    stravaGearName: String
    bikeId: ID!
  }

  input UpdateRideInput {
    startTime: String
    durationSeconds: Int
    distanceMiles: Float
    elevationGainFeet: Float
    averageHr: Int
    rideType: String
    bikeId: ID
    notes: String
    trailSystem: String
    location: String
  }

  input AddRideInput {
    startTime: String!
    durationSeconds: Int!
    distanceMiles: Float!
    elevationGainFeet: Float!
    averageHr: Int
    rideType: String!
    bikeId: ID
    notes: String
    trailSystem: String
    location: String
  }

  type DeleteRideResult { ok: Boolean!, id: ID! }

  input BikeComponentInput {
    brand: String
    model: String
    notes: String
    isStock: Boolean
  }

  input SpokesComponentInput {
    maker: String
    model: String
    description: String
    kind: String
  }

  input SpokesComponentsInput {
    fork: SpokesComponentInput
    rearShock: SpokesComponentInput
    brakes: SpokesComponentInput
    rearDerailleur: SpokesComponentInput
    crank: SpokesComponentInput
    cassette: SpokesComponentInput
    wheels: SpokesComponentInput
    rims: SpokesComponentInput
    tires: SpokesComponentInput
    stem: SpokesComponentInput
    handlebar: SpokesComponentInput
    saddle: SpokesComponentInput
    seatpost: SpokesComponentInput
    chain: SpokesComponentInput
    headset: SpokesComponentInput
    bottomBracket: SpokesComponentInput
    discRotors: SpokesComponentInput
  }

  input AddBikeInput {
    nickname: String
    manufacturer: String!
    model: String!
    year: Int!
    travelForkMm: Int
    travelShockMm: Int
    notes: String
    spokesId: String
    spokesUrl: String
    thumbnailUrl: String
    family: String
    category: String
    subcategory: String
    buildKind: String
    isFrameset: Boolean
    isEbike: Boolean
    gender: String
    frameMaterial: String
    hangerStandard: String
    # E-bike motor/battery specs
    motorMaker: String
    motorModel: String
    motorPowerW: Int
    motorTorqueNm: Int
    batteryWh: Int
    acquisitionCondition: AcquisitionCondition
    spokesComponents: SpokesComponentsInput
    fork: BikeComponentInput
    shock: BikeComponentInput
    seatpost: BikeComponentInput
    wheels: BikeComponentInput
    pivotBearings: BikeComponentInput
    pairedComponentConfigs: [PairedComponentConfigInput!]
  }

  input UpdateBikeInput {
    nickname: String
    manufacturer: String
    model: String
    year: Int
    travelForkMm: Int
    travelShockMm: Int
    notes: String
    spokesId: String
    spokesUrl: String
    thumbnailUrl: String
    family: String
    category: String
    subcategory: String
    buildKind: String
    isFrameset: Boolean
    isEbike: Boolean
    gender: String
    frameMaterial: String
    hangerStandard: String
    # E-bike motor/battery specs
    motorMaker: String
    motorModel: String
    motorPowerW: Int
    motorTorqueNm: Int
    batteryWh: Int
    spokesComponents: SpokesComponentsInput
    fork: BikeComponentInput
    shock: BikeComponentInput
    seatpost: BikeComponentInput
    wheels: BikeComponentInput
    pivotBearings: BikeComponentInput
  }

  input AddComponentInput {
    type: ComponentType!
    location: ComponentLocation
    brand: String
    model: String
    notes: String
    isStock: Boolean
    hoursUsed: Float
    serviceDueAtHours: Float
  }

  input UpdateComponentInput {
    location: ComponentLocation
    brand: String
    model: String
    notes: String
    isStock: Boolean
    hoursUsed: Float
    serviceDueAtHours: Float
  }

  input ComponentFilterInput {
    bikeId: ID
    onlySpare: Boolean
    types: [ComponentType!]
  }

  input LogServiceInput {
    componentId: ID!
    notes: String
    performedAt: String
  }

  input ComponentBaselineInput {
    componentId: ID!
    wearPercent: Int!
    method: BaselineMethod!
    lastServicedAt: String
  }

  input BulkUpdateBaselinesInput {
    updates: [ComponentBaselineInput!]!
  }

  type DeleteResult {
    ok: Boolean!
    id: ID!
  }

  type ImportNotificationState {
    showOverlay: Boolean!
    sessionId: ID
    unassignedRideCount: Int!
    totalImportedCount: Int!
  }

  type UnassignedRide {
    id: ID!
    startTime: String!
    durationSeconds: Int!
    distanceMiles: Float!
    elevationGainFeet: Float!
    location: String
    rideType: String!
  }

  type UnassignedRidesPage {
    rides: [UnassignedRide!]!
    totalCount: Int!
    hasMore: Boolean!
  }

  type AcknowledgeResult {
    success: Boolean!
  }

  type BulkAssignResult {
    success: Boolean!
    updatedCount: Int!
  }

  type BikeCalibrationInfo {
    bikeId: ID!
    bikeName: String!
    thumbnailUrl: String
    components: [ComponentPrediction!]!
  }

  type CalibrationState {
    showOverlay: Boolean!
    overdueCount: Int!
    totalComponentCount: Int!
    bikes: [BikeCalibrationInfo!]!
  }

  input BulkServiceLogInput {
    componentIds: [ID!]!
    performedAt: String!
  }

  type BulkServiceResult {
    success: Boolean!
    updatedCount: Int!
  }

  input AcceptTermsInput {
    termsVersion: String!
  }

  type AcceptTermsResult {
    success: Boolean!
    acceptedAt: String!
  }

  input UpdateUserPreferencesInput {
    hoursDisplayPreference: String
    predictionMode: String
  }

  # Service Preferences
  type UserServicePreference {
    id: ID!
    componentType: ComponentType!
    trackingEnabled: Boolean!
    customInterval: Float
  }

  type ServicePreferenceDefault {
    componentType: ComponentType!
    displayName: String!
    defaultInterval: Float!
    defaultIntervalFront: Float
    defaultIntervalRear: Float
  }

  input ServicePreferenceInput {
    componentType: ComponentType!
    trackingEnabled: Boolean!
    customInterval: Float
  }

  input UpdateServicePreferencesInput {
    preferences: [ServicePreferenceInput!]!
  }

  # Per-bike service preferences (overrides global)
  type BikeServicePreference {
    id: ID!
    componentType: ComponentType!
    trackingEnabled: Boolean!
    customInterval: Float
  }

  input BikeServicePreferenceInput {
    componentType: ComponentType!
    trackingEnabled: Boolean!
    customInterval: Float
  }

  input UpdateBikeServicePreferencesInput {
    bikeId: ID!
    preferences: [BikeServicePreferenceInput!]!
  }

  # Paired component configuration for bike import
  input PairedComponentSpecInput {
    brand: String!
    model: String!
  }

  input PairedComponentConfigInput {
    type: ComponentType!
    useSameSpec: Boolean!
    frontSpec: PairedComponentSpecInput
    rearSpec: PairedComponentSpecInput
  }

  # Component replacement
  input ReplaceComponentInput {
    componentId: ID!
    newBrand: String!
    newModel: String!
    alsoReplacePair: Boolean
    pairBrand: String
    pairModel: String
  }

  type ReplaceComponentResult {
    replacedComponents: [Component!]!
    newComponents: [Component!]!
  }

  type MigratePairedComponentsResult {
    migratedCount: Int!
    components: [Component!]!
  }

  # Component install/swap types
  input NewComponentInput {
    brand: String!
    model: String!
    isStock: Boolean
  }

  input InstallComponentInput {
    bikeId: ID!
    slotKey: String!
    # Provide EITHER existingComponentId (install a spare) OR newComponent (create new part)
    existingComponentId: ID
    newComponent: NewComponentInput
    # If true and the component type requires pairing, also replace the paired slot
    alsoReplacePair: Boolean
    pairNewComponent: NewComponentInput
  }

  type InstallComponentResult {
    installedComponent: Component!
    displacedComponent: Component
  }

  input SwapComponentsInput {
    bikeIdA: ID!
    slotKeyA: String!
    bikeIdB: ID!
    slotKeyB: String!
  }

  type SwapComponentsResult {
    componentA: Component!
    componentB: Component!
  }

  type BikeComponentInstall {
    id: ID!
    bikeId: ID!
    componentId: ID!
    slotKey: String!
    installedAt: String!
    removedAt: String
  }

  type Mutation {
    addRide(input: AddRideInput!): Ride!
    updateRide(id: ID!, input: UpdateRideInput!): Ride!
    deleteRide(id: ID!): DeleteRideResult!
    addBike(input: AddBikeInput!): Bike!
    updateBike(id: ID!, input: UpdateBikeInput!): Bike!
    deleteBike(id: ID!): DeleteResult!
    updateBikesOrder(bikeIds: [ID!]!): [Bike!]!
    addComponent(input: AddComponentInput!, bikeId: ID): Component!
    updateComponent(id: ID!, input: UpdateComponentInput!): Component!
    deleteComponent(id: ID!): DeleteResult!
    logComponentService(id: ID!, performedAt: String): Component!
    logService(input: LogServiceInput!): ServiceLog!
    snoozeComponent(id: ID!, hours: Float): Component!
    createStravaGearMapping(input: CreateStravaGearMappingInput!): StravaGearMapping!
    deleteStravaGearMapping(id: ID!): DeleteResult!
    triggerProviderSync(provider: SyncProvider!): TriggerSyncResult!
    bulkUpdateComponentBaselines(input: BulkUpdateBaselinesInput!): [Component!]!
    acceptTerms(input: AcceptTermsInput!): AcceptTermsResult!
    updateUserPreferences(input: UpdateUserPreferencesInput!): User!
    acknowledgeImportOverlay(importSessionId: ID!): AcknowledgeResult!
    assignBikeToRides(rideIds: [ID!]!, bikeId: ID!): BulkAssignResult!
    logBulkComponentService(input: BulkServiceLogInput!): BulkServiceResult!
    dismissCalibration: User!
    completeCalibration: User!
    resetCalibration: User!
    markPairedComponentMigrationSeen: User!
    replaceComponent(input: ReplaceComponentInput!): ReplaceComponentResult!
    installComponent(input: InstallComponentInput!): InstallComponentResult!
    swapComponents(input: SwapComponentsInput!): SwapComponentsResult!
    migratePairedComponents: MigratePairedComponentsResult!
    updateServicePreferences(input: UpdateServicePreferencesInput!): [UserServicePreference!]!
    updateBikeServicePreferences(input: UpdateBikeServicePreferencesInput!): [BikeServicePreference!]!
  }

  type ConnectedAccount {
    provider: String!
    connectedAt: String!
  }

  type User {
    id: ID!
    email: String!
    rides: [Ride!]!
    name: String
    avatarUrl: String
    onboardingCompleted: Boolean!
    hasAcceptedCurrentTerms: Boolean!
    location: String
    age: Int
    activeDataSource: String
    accounts: [ConnectedAccount!]!
    role: UserRole!
    mustChangePassword: Boolean!
    isFoundingRider: Boolean!
    hoursDisplayPreference: String
    predictionMode: String
    pairedComponentMigrationSeenAt: String
    servicePreferences: [UserServicePreference!]!
    createdAt: String!
  }

  input RidesFilterInput {
    startDate: String
    endDate: String
    bikeId: ID
  }

  type Query {
    me: User
    user(id: ID!): User
    rides(take: Int = 1000, after: ID, filter: RidesFilterInput): [Ride!]!
    rideTypes: [RideType!]!
    bikes: [Bike!]!
    components(filter: ComponentFilterInput): [Component!]!
    stravaGearMappings: [StravaGearMapping!]!
    unmappedStravaGears: [StravaGearInfo!]!
    importNotificationState: ImportNotificationState
    unassignedRides(importSessionId: ID!, take: Int = 50, after: ID): UnassignedRidesPage!
    calibrationState: CalibrationState
    servicePreferenceDefaults: [ServicePreferenceDefault!]!
  }
`;
