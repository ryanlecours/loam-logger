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
    WHEELS
    DROPPER
    PEDALS
    CHAIN
    CASSETTE
    OTHER
    PIVOT_BEARINGS
  }

  type Ride {
    id: ID!
    userId: ID!
    garminActivityId: String
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
    brand: String!
    model: String!
    installedAt: String
    hoursUsed: Float!
    serviceDueAtHours: Float
    notes: String
    isStock: Boolean!
    bikeId: ID
    isSpare: Boolean!
    createdAt: String!
    updatedAt: String!
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
    fork: Component
    shock: Component
    dropper: Component
    wheels: Component
    pivotBearings: Component
    components: [Component!]!
    createdAt: String!
    updatedAt: String!
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

  input AddBikeInput {
    nickname: String
    manufacturer: String!
    model: String!
    year: Int!
    travelForkMm: Int
    travelShockMm: Int
    notes: String
    fork: BikeComponentInput
    shock: BikeComponentInput
    dropper: BikeComponentInput
    wheels: BikeComponentInput
    pivotBearings: BikeComponentInput
  }

  input UpdateBikeInput {
    nickname: String
    manufacturer: String
    model: String
    year: Int
    travelForkMm: Int
    travelShockMm: Int
    notes: String
    fork: BikeComponentInput
    shock: BikeComponentInput
    dropper: BikeComponentInput
    wheels: BikeComponentInput
    pivotBearings: BikeComponentInput
  }

  input AddComponentInput {
    type: ComponentType!
    brand: String
    model: String
    notes: String
    isStock: Boolean
    hoursUsed: Float
    serviceDueAtHours: Float
  }

  input UpdateComponentInput {
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

  type DeleteResult {
    ok: Boolean!
    id: ID!
  }

  type Mutation {
    addRide(input: AddRideInput!): Ride!
    updateRide(id: ID!, input: UpdateRideInput!): Ride!
    deleteRide(id: ID!): DeleteRideResult!
    addBike(input: AddBikeInput!): Bike!
    updateBike(id: ID!, input: UpdateBikeInput!): Bike!
    addComponent(input: AddComponentInput!, bikeId: ID): Component!
    updateComponent(id: ID!, input: UpdateComponentInput!): Component!
    deleteComponent(id: ID!): DeleteResult!
  }

  type User {
    id: ID!
    email: String!
    rides: [Ride!]!
    name: String
    avatarUrl: String
  }

  type Query {
    me: User
    user(id: ID!): User
    rides(take: Int = 20, after: ID): [Ride!]!
    rideTypes: [RideType!]!
    bikes: [Bike!]!
    components(filter: ComponentFilterInput): [Component!]!
  }
`;
