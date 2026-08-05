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
    FREE
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
    """
    Garmin device model that recorded this ride, raw from the Activity API
    (e.g. "edge_840"). Clients must render "Garmin [device model]" attribution
    wherever this ride's data appears, per the Garmin API Brand Guidelines.
    Null when Garmin did not report a device or the ride predates capture —
    attribute plain "Garmin" in that case (formatGarminSource handles both).
    """
    garminDeviceName: String
    stravaActivityId: String
    whoopWorkoutId: String
    suuntoWorkoutId: String
    stravaGearId: String
    """
    Strava's reported recording device (e.g. "Garmin Edge 840"). When it names a
    Garmin device, this ride carries Garmin device-sourced data and clients must
    render Garmin attribution even though it arrived via Strava (isGarminDevice /
    garminSourceDevice in @loam/shared). Null when Strava reported no device.
    """
    stravaDeviceName: String
    startTime: String!
    durationSeconds: Int!
    distanceMeters: Float!
    elevationGainMeters: Float!
    averageHr: Int
    rideType: String!
    bikeId: ID
    """
    Ridden on a bike the rider does not own: a demo, a loaner, a rental, a
    friend's bike. Always paired with a null bikeId, and the two are kept in
    sync by the server (assigning a bike clears this; setting this clears the
    bike). Distinguishes "not my bike" from "not assigned yet", so clients can
    stop prompting for a bike that is never coming. The ride still counts
    toward ride stats and insights; it credits no component either way.
    """
    unownedBike: Boolean!
    notes: String
    trailSystem: String
    location: String
    createdAt: String!
    updatedAt: String!
    weather: RideWeather
  }

  enum RideTrackStatus {
    # Stream persisted; points returned. Strava or Garmin.
    AVAILABLE
    # Strava ride with coords but no stream yet - requestRideTrack can load it.
    # Strava-only: Garmin streams arrive pushed at ingest and are never fetched
    # on demand, so a Garmin ride is either AVAILABLE or UNAVAILABLE.
    FETCHABLE
    # No GPS source: manual entry, WHOOP, Suunto, or a Garmin ride whose
    # Activity Details carried no usable samples (indoor/trainer).
    UNAVAILABLE
  }

  # Owner-only GPS track for one ride, downsampled server-side. Deliberately a
  # dedicated query rather than a field on Ride so the stream blob is never
  # read for list queries and can never leak into shared-page types.
  type RideTrack {
    status: RideTrackStatus!
    # [lat, lng] pairs; null unless status is AVAILABLE.
    points: [[Float!]!]
    # Point count of the raw stream the track was sampled from.
    sampledFrom: Int
    """
    Provider that recorded the stored stream ("strava" | "garmin"); null unless
    status is AVAILABLE. Lets the client attribute the rendered map to the right
    source — a cross-provider ride cannot be attributed from its activity ids
    alone, since only one provider's stream is actually persisted.
    """
    source: String
    """
    Garmin device model behind this track, when source is "garmin". Drives the
    "Garmin [device model]" attribution the Garmin API Brand Guidelines require
    on visuals built from device data. Null for non-Garmin tracks, and for
    Garmin tracks where the device was not reported (attribute plain "Garmin").
    """
    garminDeviceName: String
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

  # Result of triggering a Garmin coordinate/weather repair backfill.
  # status is one of:
  #   STARTED         — a repair job was enqueued
  #   ALREADY_RUNNING — a repair for this user is already in flight
  #   NOT_CONNECTED   — no active Garmin connection
  #   NOTHING_TO_DO   — no Garmin rides are missing coordinates
  # (NEEDS_RECONNECT is retained as a value for client compatibility but is no
  #  longer returned — see the resolver for why the scope pre-flight was dropped.)
  type GarminWeatherBackfillResult {
    status: String!
    ridesToRepair: Int!
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

  enum ComponentRideAdjustmentKind {
    # Ride is on the component's bike but must not count toward its hours.
    EXCLUDE
    # Ride is on another bike (or unassigned) but should count.
    INCLUDE
  }

  type ComponentRideEntry {
    ride: Ride!
    # Whether this ride currently contributes to countedHours.
    counted: Boolean!
    # The stored adjustment, if any. Null = default on-bike attribution.
    adjustment: ComponentRideAdjustmentKind
    # True for an INCLUDE stored on a ride that predates the anchor: it is
    # recorded but dormant until the anchor moves (e.g. service log deleted
    # or backdated). Surfaced so the UI never silently ignores an apply.
    beforeAnchor: Boolean!
  }

  type ComponentRideAdjustmentResult {
    # Fresh component (post-recompute hoursUsed) so Apollo renormalizes it.
    component: Component!
    rideId: ID!
    # Whether the ride now counts toward the component's hours.
    counted: Boolean!
  }

  type ComponentRidesPayload {
    componentId: ID!
    # ISO timestamp the attribution window starts at; null = all-time.
    anchor: String
    entries: [ComponentRideEntry!]!
    # Canonical derived total. May differ from hoursUsed until the first
    # adjustment snaps the stored counter to the canonical value.
    countedHours: Float!
    # The stored counter as of this request.
    hoursUsed: Float!
    countedRideCount: Int!
    hasMore: Boolean!
  }

  type WearDriver {
    factor: String!
    contribution: Int!
    label: String!
  }

  # Predictive fields (status, hoursRemaining, ridesRemainingEstimate,
  # confidence, overallStatus, dueSoonCount) are Pro-only and null for free
  # users. dueNowCount is served to all tiers so free users get a binary
  # READY / NOT READY signal on the dashboard tile without the Pro-only
  # due-soon lookahead. Raw usage fields (currentHours, serviceIntervalHours,
  # hoursSinceService, ridesSinceService) are served to all tiers.
  type ComponentPrediction {
    componentId: ID!
    componentType: ComponentType!
    location: ComponentLocation!
    brand: String!
    model: String!
    status: PredictionStatus
    hoursRemaining: Float
    ridesRemainingEstimate: Int
    confidence: ConfidenceLevel
    currentHours: Float!
    serviceIntervalHours: Float!
    hoursSinceService: Float!
    ridesSinceService: Int!
    why: String
    drivers: [WearDriver!]
  }

  # Web-cache invariant: the dashboard fetches advisorSummary in a separate
  # query stage (BIKES_ADVISOR) from the rest of this type, to keep the ~8s LLM
  # call off the critical render path. That split only works because the web
  # client normalizes BikePredictionSummary by bikeId (the typePolicy in
  # apps/web/src/lib/apolloClient.ts) so the two partial writes merge instead of
  # clobbering. Keep bikeId as the stable per-bike identity here; the split query
  # in apps/web/src/graphql/bikes.ts must always select bikeId.
  type BikePredictionSummary {
    bikeId: ID!
    bikeName: String!
    components: [ComponentPrediction!]!
    priorityComponent: ComponentPrediction
    overallStatus: PredictionStatus
    dueNowCount: Int
    dueSoonCount: Int
    generatedAt: String!
    algoVersion: String!
    advisorSummary: AdvisorSummary
  }

  type AdvisorSummary {
    text: String!
    generatedAt: String!
    modelVersion: String!
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
    # Public share slug when history sharing is enabled (null = not shared)
    shareSlug: String
    """
    Providers that contributed the rides behind this bike's component hours,
    e.g. ["garmin", "strava"]. Values match Ride source keys.

    Exists so clients can attribute derived data correctly: component wear,
    service predictions and the generated maintenance summary are all
    materially influenced by ride duration, and the Garmin API Brand
    Guidelines require Garmin to be named as a contributing source wherever
    that is true — and equally require Garmin branding NOT to appear where
    Garmin data is absent. Do not infer this from a single ride's source.
    """
    contributingSources: [String!]!
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
    # Setting this true clears bikeId (and returns that bike's hours); assigning
    # a bikeId clears this. Sending a bikeId and unownedBike: true together is a
    # BAD_USER_INPUT error rather than one silently winning.
    unownedBike: Boolean
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
    # Logging a ride on a bike the rider does not own. Suppresses the
    # sole-bike auto-assign that an omitted bikeId would otherwise trigger.
    # Cannot be combined with a bikeId.
    unownedBike: Boolean
    notes: String
    trailSystem: String
    location: String
    # Client-generated idempotency key (a UUID). When a retried submit carries
    # the same key, the API returns the ride created by the first attempt
    # instead of inserting a duplicate. Optional: omitting it preserves the
    # old always-insert behavior.
    clientMutationId: String
    # Where the ride started, from the phone's GPS (in-app recording) or any
    # future coordinate-bearing source. Both or neither; a lone coordinate is
    # rejected. Presence unlocks the enrichment provider rides already get:
    # weather now, lift detection once a track is uploaded.
    startLat: Float
    startLng: Float
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
    # Legacy on/off for ride-sync pushes, still sent by app versions <= 1.1.4.
    # Maps onto rideSyncNotificationMode (false -> OFF; true -> ALL, unless
    # the stored mode is already a non-OFF value, which is preserved). New
    # clients should send rideSyncNotificationMode instead.
    notifyOnRideUpload: Boolean
    # How "Ride Synced" pushes behave; see the enum. Setting this also keeps
    # the legacy boolean in sync for older clients reading it.
    rideSyncNotificationMode: RideSyncNotificationMode
    # Weekly Friday-morning gear-health digest. Opt-in; Pro feature at send
    # time (a free user's toggle stores but sends nothing, mirroring how
    # prediction surfaces degrade elsewhere).
    weeklyDigestEnabled: Boolean
    # IANA timezone (e.g. "America/Denver"), used only to time the weekly
    # digest. Uploaded by mobile alongside the push token; explicit null
    # clears it, which also stops the digest (no timezone, no send).
    timezone: String
  }

  # Governs the "Ride Synced" push. Service-due pushes are configured
  # per-bike (BikeNotificationPreference) and are independent of this.
  enum RideSyncNotificationMode {
    # Every new integration ride pushes (burst-suppressed).
    ALL
    # Only rides that need a bike assigned, plus the account's first-ever
    # synced ride. Every push asks for an action or marks a milestone.
    ACTION_NEEDED
    # No ride-sync pushes.
    OFF
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
    # Per-ride attribution corrections. EXCLUDE removes an on-bike ride's
    # hours from the component; INCLUDE applies a ride from another bike
    # (or unassigned) to it. Setting flips an existing row; clearing a
    # nonexistent row is a success no-op. Both snap the component's
    # hoursUsed to the canonical recomputed value.
    setComponentRideAdjustment(componentId: ID!, rideId: ID!, kind: ComponentRideAdjustmentKind!): ComponentRideAdjustmentResult!
    clearComponentRideAdjustment(componentId: ID!, rideId: ID!): ComponentRideAdjustmentResult!
    createStravaGearMapping(input: CreateStravaGearMappingInput!): StravaGearMapping!
    deleteStravaGearMapping(id: ID!): DeleteResult!
    triggerProviderSync(provider: SyncProvider!): TriggerSyncResult!
    # Enqueue a stream fetch for a Strava ride imported before stream
    # ingestion existed. Returns the track's current state; poll rideTrack
    # until AVAILABLE.
    requestRideTrack(rideId: ID!): RideTrack!
    bulkUpdateComponentBaselines(input: BulkUpdateBaselinesInput!): [Component!]!
    acceptTerms(input: AcceptTermsInput!): AcceptTermsResult!
    updateUserPreferences(input: UpdateUserPreferencesInput!): User!
    """
    Clears expoPushToken, but ONLY if it currently equals the given token:
    a compare-and-clear, not a blind null. expoPushToken is a single column
    per user, not per device, so the same account signed into two devices
    only ever has room for one device's token, and whichever device
    registers last silently wins the slot. Clearing unconditionally on
    logout (as updateUserPreferences with expoPushToken: null does) would
    let a logout on the device that already lost that race null out a
    different, currently-active device's token. Matching first means a
    stale device's logout can only ever remove its own (long since
    overwritten) token, never a foreign one.
    Returns true only if a row was actually cleared; false is not an error,
    it means this token was not the one on file (already cleared, or a
    different device holds the slot), so nothing needed to happen.
    """
    unregisterPushToken(token: String!): Boolean!
    updateAnalyticsOptOut(optOut: Boolean!): User!
    acknowledgeImportOverlay(importSessionId: ID!): AcknowledgeResult!
    assignBikeToRides(rideIds: [ID!]!, bikeId: ID!): BulkAssignResult!
    logBulkComponentService(input: BulkServiceLogInput!): BulkServiceResult!
    dismissCalibration: User!
    completeCalibration: User!
    resetCalibration: User!
    markPairedComponentMigrationSeen: User!
    markTrailStewardshipNoticeSeen: User!
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
    # Re-import Garmin rides that are missing coordinates (and therefore weather)
    # by re-triggering Garmin's backfill; throttled server-side via a queued job.
    backfillGarminWeather: GarminWeatherBackfillResult!
    # Enable public sharing of a bike's history; returns the share URL.
    # Idempotent — re-enabling returns the existing link.
    enableBikeShare(bikeId: ID!): String!
    disableBikeShare(bikeId: ID!): Boolean!
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

  # Deprecated stub — the referral program was removed. Old mobile builds still
  # query these fields; removing them would fail those clients' whole queries.
  # TODO(remove after 2026-12): delete ReferralStats, Query.referralStats, and
  # User.referralCode once pre-removal app versions age out.
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
    referralCode: String @deprecated(reason: "Referral program removed; always null")
    needsDowngradeSelection: Boolean!
    tierLimits: TierLimits!
    hoursDisplayPreference: String
    predictionMode: String
    distanceUnit: String
    analyticsOptOut: Boolean!
    pairedComponentMigrationSeenAt: String
    trailStewardshipNoticeSeenAt: String
    servicePreferences: [UserServicePreference!]!
    # Derived for legacy clients: true iff rideSyncNotificationMode != OFF.
    notifyOnRideUpload: Boolean!
    rideSyncNotificationMode: RideSyncNotificationMode!
    weeklyDigestEnabled: Boolean!
    createdAt: String!
    ridesMissingWeather: Int!
    # Count of the viewer's Garmin rides stored without coordinates (a past
    # ingestion bug), which is why they have no weather. Drives the "re-import
    # from Garmin" repair prompt. Pro-only (0 otherwise), mirroring weather.
    garminRidesMissingCoords: Int!
    # Aggregated condition counts across the authenticated user's rides,
    # filtered by date/bike. Replaces client-side aggregation over the
    # rides list so dashboards don't have to pull full weather blobs.
    weatherBreakdown(filter: RidesFilterInput): WeatherBreakdown!
  }

  input RidesFilterInput {
    startDate: String
    endDate: String
    bikeId: ID
    # Only rides with no bike assigned. Garmin never reports gear, so on a
    # multi-bike account every Garmin ride lands unassigned and accrues no
    # component wear until the rider picks a bike; this is how the clients
    # list those rides. Mutually exclusive with bikeId: sending both is a
    # BAD_USER_INPUT error rather than a silently-ignored filter.
    unassigned: Boolean
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

  # Public, sanitized bike-history shapes for the shareable /share/<slug>
  # page (e.g. handed to a prospective buyer). Deliberately excludes owner
  # identity, per-ride details, and GPS — only the bike, its components,
  # wrench history, and aggregate usage totals.
  type SharedBike {
    name: String!
    manufacturer: String!
    model: String!
    year: Int
    thumbnailUrl: String
  }

  type SharedComponent {
    type: ComponentType!
    location: ComponentLocation!
    brand: String!
    model: String!
  }

  # Deliberately excludes ServiceLog.notes: it's freeform rider text that can
  # carry identity-linked info (names, phone numbers, addresses) — unsafe for
  # an unauthenticated page.
  type SharedServiceEvent {
    performedAt: String!
    component: SharedComponent!
  }

  type SharedInstallEvent {
    eventType: ComponentInstallEventType!
    occurredAt: String!
    component: SharedComponent!
  }

  type SharedBikeHistory {
    bike: SharedBike!
    serviceEvents: [SharedServiceEvent!]!
    installs: [SharedInstallEvent!]!
    totals: BikeHistoryTotals!
    """
    Providers whose rides contribute to the totals above, e.g. ["garmin"].

    This page is public and unauthenticated, which makes it "downstream data"
    under the Garmin API Brand Guidelines — attribution must travel with the
    data wherever it is shared. Contains no identifiers, only source names.
    """
    contributingSources: [String!]!
  }

  type Query {
    me: User
    ride(id: ID!): Ride
    rides(take: Int = 1000, after: ID, filter: RidesFilterInput): [Ride!]!
    rideTypes: [RideType!]!
    bike(id: ID!): Bike
    bikes(includeInactive: Boolean): [Bike!]!
    components(filter: ComponentFilterInput): [Component!]!
    stravaGearMappings: [StravaGearMapping!]!
    unmappedStravaGears: [StravaGearInfo!]!
    importNotificationState: ImportNotificationState
    unassignedRides(importSessionId: ID!, take: Int = 50, after: ID): UnassignedRidesPage!
    # How many of the viewer's rides have no bike assigned, across their whole
    # history rather than a single import session. Drives the dashboard prompt
    # to go assign them; those rides' hours are credited to no component until
    # they are.
    unassignedRideCount: Int!
    calibrationState: CalibrationState
    servicePreferenceDefaults: [ServicePreferenceDefault!]!
    bikeNotes(bikeId: ID!, take: Int = 20, after: ID): BikeNotesPage!
    referralStats: ReferralStats! @deprecated(reason: "Referral program removed; returns zeros")
    bikeHistory(bikeId: ID!, startDate: String, endDate: String): BikeHistoryPayload!
    rideTrack(rideId: ID!): RideTrack!
    # The rides behind a component's current hoursUsed number, per the
    # canonical attribution rule (rides on the component's bike since the
    # last-service anchor, ± per-ride adjustments). Owner-only.
    componentRides(componentId: ID!, take: Int = 50, after: ID): ComponentRidesPayload!
    # Public (unauthenticated) sanitized history for a shared bike.
    # Returns null for unknown or revoked slugs.
    sharedBikeHistory(slug: String!): SharedBikeHistory
  }
`;
