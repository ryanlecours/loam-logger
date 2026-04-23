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

  enum BikeStatus {
    ACTIVE
    RETIRED
    SOLD
    ARCHIVED
  }

  enum SubscriptionTier {
    FREE_LIGHT
    FREE_FULL
    PRO
  }

  enum SubscriptionProvider {
    STRIPE
    APPLE
    GOOGLE
  }

  enum StripePlan {
    MONTHLY
    ANNUAL
  }

  enum CheckoutPlatform {
    WEB
    MOBILE
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

  enum BikeNoteType {
    MANUAL
    SWAP
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
    suuntoWorkoutId: String
    stravaGearId: String
    startTime: String!
    durationSeconds: Int!
    distanceMeters: Float!
    elevationGainMeters: Float!
    averageHr: Int
    rideType: String!
    bikeId: ID
    notes: String
    trailSystem: String
    location: String
    createdAt: String!
    updatedAt: String!
    weather: RideWeather
  }

  enum WeatherCondition {
    SUNNY
    CLOUDY
    RAINY
    SNOWY
    WINDY
    FOGGY
    UNKNOWN
  }

  type RideWeather {
    # Exposed so Apollo can normalize RideWeather as a standalone cache
    # entry. Without an id, the weather blob is stored embedded inside its
    # parent Ride, which breaks partial-update patterns (e.g. refetching
    # only the weather fields after a backfill completes).
    id: ID!
    tempC: Float!
    feelsLikeC: Float
    precipitationMm: Float!
    windSpeedKph: Float!
    humidity: Float
    wmoCode: Int!
    condition: WeatherCondition!
    # Coords actually used for the fetch (rounded to the cache grid, may
    # differ slightly from Ride.startLat/startLng). Useful for debugging
    # "why is my weather wrong?" questions.
    lat: Float!
    lng: Float!
    # Which provider supplied this weather row (e.g. "open-meteo"). Exposed
    # so future clients can distinguish between providers if we ever add one.
    source: String!
    fetchedAt: String!
  }

  type BackfillWeatherResult {
    enqueuedCount: Int!
    ridesWithoutCoords: Int!
    remainingAfterBatch: Int!
  }

  # Server-side aggregation so dashboards don't have to pull a full list of
  # weather blobs just to count buckets. Returned for the authenticated user
  # only — the resolver enforces userId from context.
  type WeatherBreakdown {
    sunny: Int!
    cloudy: Int!
    rainy: Int!
    snowy: Int!
    windy: Int!
    foggy: Int!
    # Rides whose WMO code didn't map to a known condition.
    unknown: Int!
    # Rides that could get weather but don't have a row yet — i.e. have
    # coords but fetch is pending or failed. Rides without coords (WHOOP
    # workouts, pre-weather-integration imports) are excluded because
    # they'll never produce a weather row.
    pending: Int!
    # Total rides in the selected timeframe, including pending.
    totalRides: Int!
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
    # The single most recent ServiceLog — lets clients that only render
    # "last serviced" metadata avoid pulling a component's entire service
    # history over the wire.
    latestServiceLog: ServiceLog
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
    acquisitionDate: String
    status: BikeStatus!
    retiredAt: String
    fork: Component
    shock: Component
    seatpost: Component
    wheels: Component
    pivotBearings: Component
    components: [Component!]!
    predictions: BikePredictionSummary
    servicePreferences: [BikeServicePreference!]!
    notificationPreference: BikeNotificationPreference
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
    distanceMeters: Float
    elevationGainMeters: Float
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
    distanceMeters: Float!
    elevationGainMeters: Float!
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
    acquisitionDate: String
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
    acquisitionDate: String
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
    installedAt: String
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

  input UpdateServiceLogInput {
    performedAt: String
    notes: String
    hoursAtService: Float
  }

  """
  Retroactively fix a bike's acquisition date and, when requested, the
  install dates of every stock component + any install whose date was
  auto-stamped at bike creation. Built for users who added bikes before
  the acquisition-date feature existed and now see every stock part
  installed on the same day on BikeHistory.
  """
  input UpdateBikeAcquisitionInput {
    acquisitionDate: String!
    """
    When true (default), move the installedAt on every BikeComponentInstall
    matching the "buggy auto-date" predicate to the new acquisitionDate,
    and move the corresponding synthetic baseline ServiceLog alongside.
    """
    cascadeInstalls: Boolean = true
  }

  type UpdateBikeAcquisitionResult {
    bike: Bike!
    installsMoved: Int!
    serviceLogsMoved: Int!
  }

  """
  Apply the same installedAt to multiple BikeComponentInstall rows in a
  single mutation. All rows must belong to the viewer — the batch is
  all-or-nothing to avoid leaking which ids they don't own.
  """
  input BulkUpdateBikeComponentInstallsInput {
    ids: [ID!]!
    installedAt: String!
  }

  type BulkUpdateBikeComponentInstallsResult {
    updatedCount: Int!
    serviceLogsMoved: Int!
  }

  """
  Patch fields on a BikeComponentInstall row.

  **Null handling is asymmetric**, mirroring the underlying Prisma schema:

  - \`installedAt\`: an ISO date string updates the value. \`null\` or omitted
    is a no-op. You cannot clear this field — \`installedAt\` is required at
    the database level.
  - \`removedAt\`: an ISO date string updates the value. Explicit \`null\`
    **clears** the field (the component is no longer marked as removed).
    Omitting the key is a no-op.
  """
  input UpdateBikeComponentInstallInput {
    """ISO date string. Pass to update; null or omitted is ignored (cannot be cleared)."""
    installedAt: String
    """ISO date string to set, or explicit null to clear."""
    removedAt: String
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
    distanceMeters: Float!
    elevationGainMeters: Float!
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
    distanceUnit: String
    expoPushToken: String
    notifyOnRideUpload: Boolean
  }

  # Push notification preferences
  enum ServiceNotificationMode {
    RIDES_BEFORE
    HOURS_BEFORE
    AT_SERVICE
  }

  type BikeNotificationPreference {
    bikeId: ID!
    serviceNotificationsEnabled: Boolean!
    serviceNotificationMode: ServiceNotificationMode!
    serviceNotificationThreshold: Int!
  }

  input UpdateBikeNotificationPreferenceInput {
    bikeId: ID!
    serviceNotificationsEnabled: Boolean
    serviceNotificationMode: ServiceNotificationMode
    serviceNotificationThreshold: Int
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
    installedAt: String
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
    # Optional note text for creating a SWAP note with before/after snapshots
    noteText: String
    installedAt: String
  }

  type InstallComponentResult {
    installedComponent: Component!
    displacedComponent: Component
    note: BikeNote
  }

  input SwapComponentsInput {
    bikeIdA: ID!
    slotKeyA: String!
    bikeIdB: ID!
    slotKeyB: String!
    # Optional note text for creating SWAP notes with before/after snapshots
    noteText: String
    installedAt: String
  }

  type SwapComponentsResult {
    componentA: Component!
    componentB: Component!
    noteA: BikeNote
    noteB: BikeNote
  }

  type BikeComponentInstall {
    id: ID!
    bikeId: ID!
    componentId: ID!
    slotKey: String!
    installedAt: String!
    removedAt: String
  }

  # Snapshot types for immutable setup history
  type SettingSnapshot {
    key: String!
    value: String!
    unit: String
    label: String!
  }

  type ComponentSnapshot {
    componentId: ID!
    brand: String!
    model: String!
    isStock: Boolean!
    hoursUsed: Float!
    serviceDueAtHours: Float
    settings: [SettingSnapshot!]!
  }

  type SlotSnapshot {
    slotKey: String!
    componentType: String!
    location: String!
    component: ComponentSnapshot
  }

  type BikeSpecsSnapshot {
    travelForkMm: Int
    travelShockMm: Int
    isEbike: Boolean!
    batteryWh: Int
    motorPowerW: Int
    motorTorqueNm: Int
    motorMaker: String
    motorModel: String
  }

  type SetupSnapshot {
    capturedAt: String!
    bikeSpecs: BikeSpecsSnapshot!
    slots: [SlotSnapshot!]!
  }

  type BikeNote {
    id: ID!
    bikeId: ID!
    userId: ID!
    text: String!
    noteType: BikeNoteType!
    createdAt: String!
    snapshot: SetupSnapshot
    snapshotBefore: SetupSnapshot
    snapshotAfter: SetupSnapshot
    installEventId: ID
  }

  type BikeNotesPage {
    items: [BikeNote!]!
    totalCount: Int!
    hasMore: Boolean!
  }

  input AddBikeNoteInput {
    bikeId: ID!
    text: String!
  }

  type Mutation {
    addRide(input: AddRideInput!): Ride!
    updateRide(id: ID!, input: UpdateRideInput!): Ride!
    deleteRide(id: ID!): DeleteRideResult!
    addBike(input: AddBikeInput!): Bike!
    updateBike(id: ID!, input: UpdateBikeInput!): Bike!
    deleteBike(id: ID!): DeleteResult!
    retireBike(id: ID!, status: BikeStatus!): Bike!
    reactivateBike(id: ID!): Bike!
    updateBikesOrder(bikeIds: [ID!]!): [Bike!]!
    addComponent(input: AddComponentInput!, bikeId: ID): Component!
    updateComponent(id: ID!, input: UpdateComponentInput!): Component!
    deleteComponent(id: ID!): DeleteResult!
    logComponentService(id: ID!, performedAt: String): Component!
    logService(input: LogServiceInput!): ServiceLog!
    updateServiceLog(id: ID!, input: UpdateServiceLogInput!): ServiceLog!
    deleteServiceLog(id: ID!): Boolean!
    snoozeComponent(id: ID!, hours: Float): Component!
    createStravaGearMapping(input: CreateStravaGearMappingInput!): StravaGearMapping!
    deleteStravaGearMapping(id: ID!): DeleteResult!
    triggerProviderSync(provider: SyncProvider!): TriggerSyncResult!
    bulkUpdateComponentBaselines(input: BulkUpdateBaselinesInput!): [Component!]!
    acceptTerms(input: AcceptTermsInput!): AcceptTermsResult!
    updateUserPreferences(input: UpdateUserPreferencesInput!): User!
    updateAnalyticsOptOut(optOut: Boolean!): User!
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
    updateBikeNotificationPreference(input: UpdateBikeNotificationPreferenceInput!): BikeNotificationPreference!
    addBikeNote(input: AddBikeNoteInput!): BikeNote!
    deleteBikeNote(id: ID!): DeleteResult!
    updateBikeComponentInstall(id: ID!, input: UpdateBikeComponentInstallInput!): BikeComponentInstall!
    deleteBikeComponentInstall(id: ID!): Boolean!
    updateBikeAcquisition(bikeId: ID!, input: UpdateBikeAcquisitionInput!): UpdateBikeAcquisitionResult!
    bulkUpdateBikeComponentInstalls(input: BulkUpdateBikeComponentInstallsInput!): BulkUpdateBikeComponentInstallsResult!
    createCheckoutSession(plan: StripePlan!, platform: CheckoutPlatform): CheckoutSessionResult!
    createBillingPortalSession(platform: CheckoutPlatform): BillingPortalResult!
    selectBikeForDowngrade(bikeId: ID!): Bike!
    backfillWeatherForMyRides: BackfillWeatherResult!
  }

  type ConnectedAccount {
    provider: String!
    connectedAt: String!
  }

  type TierLimits {
    maxBikes: Int
    allowedComponentTypes: [ComponentType!]!
    currentBikeCount: Int!
    canAddBike: Boolean!
  }

  type CheckoutSessionResult {
    sessionId: String!
    url: String
  }

  type BillingPortalResult {
    url: String!
  }

  type ReferralStats {
    referralCode: String!
    referralLink: String!
    pendingCount: Int!
    completedCount: Int!
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
    hasPassword: Boolean!
    needsReauthForSensitiveActions: Boolean!
    isFoundingRider: Boolean!
    subscriptionTier: SubscriptionTier!
    subscriptionProvider: SubscriptionProvider
    referralCode: String
    needsDowngradeSelection: Boolean!
    tierLimits: TierLimits!
    hoursDisplayPreference: String
    predictionMode: String
    distanceUnit: String
    analyticsOptOut: Boolean!
    pairedComponentMigrationSeenAt: String
    servicePreferences: [UserServicePreference!]!
    notifyOnRideUpload: Boolean!
    createdAt: String!
    ridesMissingWeather: Int!
    # Aggregated condition counts across the authenticated user's rides,
    # filtered by date/bike. Replaces client-side aggregation over the
    # rides list so dashboards don't have to pull full weather blobs.
    weatherBreakdown(filter: RidesFilterInput): WeatherBreakdown!
  }

  input RidesFilterInput {
    startDate: String
    endDate: String
    bikeId: ID
  }

  enum ComponentInstallEventType {
    INSTALLED
    REMOVED
  }

  type ServiceEvent {
    id: ID!
    performedAt: String!
    notes: String
    hoursAtService: Float!
    component: Component!
  }

  type ComponentInstallEvent {
    id: ID!
    eventType: ComponentInstallEventType!
    occurredAt: String!
    component: Component!
  }

  type BikeHistoryTotals {
    rideCount: Int!
    totalDistanceMeters: Float!
    totalDurationSeconds: Int!
    totalElevationGainMeters: Float!
    serviceEventCount: Int!
    installEventCount: Int!
  }

  type BikeHistoryPayload {
    bike: Bike!
    rides: [Ride!]!
    serviceEvents: [ServiceEvent!]!
    installs: [ComponentInstallEvent!]!
    totals: BikeHistoryTotals!
    truncated: Boolean!
  }

  type Query {
    me: User
    user(id: ID!): User
    rides(take: Int = 1000, after: ID, filter: RidesFilterInput): [Ride!]!
    rideTypes: [RideType!]!
    bikes(includeInactive: Boolean): [Bike!]!
    components(filter: ComponentFilterInput): [Component!]!
    stravaGearMappings: [StravaGearMapping!]!
    unmappedStravaGears: [StravaGearInfo!]!
    importNotificationState: ImportNotificationState
    unassignedRides(importSessionId: ID!, take: Int = 50, after: ID): UnassignedRidesPage!
    calibrationState: CalibrationState
    servicePreferenceDefaults: [ServicePreferenceDefault!]!
    bikeNotes(bikeId: ID!, take: Int = 20, after: ID): BikeNotesPage!
    referralStats: ReferralStats!
    bikeHistory(bikeId: ID!, startDate: String, endDate: String): BikeHistoryPayload!
  }
`;
