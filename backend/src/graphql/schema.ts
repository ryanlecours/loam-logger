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
    
  enum BikeComponentType {
    FORK
    SHOCK
    WHEELSET
    DROPPERPOST
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

   type Bike {
    id: ID!
    userId: ID!
    manufacturer: String!
    model: String!
    nickname: String
    pivotHoursSinceService: Float!          # "Pivot Bearings" hours
    pivotLastServicedAt: String
    components: [BikeComponent!]!           # installed parts
    isComplete: Boolean!                    # derived: has all 4 components
    createdAt: String!
    updatedAt: String!
  }

  type BikeComponent {
    id: ID!
    bikeId: ID!
    type: BikeComponentType!
    manufacturer: String!
    model: String!
    year: Int
    hoursSinceService: Float!
    lastServicedAt: String
    createdAt: String!
    updatedAt: String!
  }

  input UpsertBikeComponentInput {
    bikeId: ID!
    type: BikeComponentType!
    manufacturer: String!
    model: String!
    year: Int
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

  input AddBikeInput {
    manufacturer: String!
    model: String!
    nickname: String
  }

  type DeleteRideResult { ok: Boolean!, id: ID! }

  type Mutation {
    addRide(input: AddRideInput!): Ride!
    updateRide(id: ID!, input: UpdateRideInput!): Ride!
    deleteRide(id: ID!): DeleteRideResult!
    addBike(input: AddBikeInput!): Bike!
    upsertBikeComponent(input: UpsertBikeComponentInput!): BikeComponent!
    markBikePivotServiced(bikeId: ID!): Bike!
    markComponentServiced(componentId: ID!): BikeComponent!
  }

  type User {
    id: ID!
    email: String!
    rides: [Ride!]!
    name: String
  }

  type Query {
    me: User
    user(id: ID!): User
    rides(take: Int = 20, after: ID): [Ride!]!
    rideTypes: [RideType!]!
    bikes: [Bike!]!
    bike(id: ID!): Bike
  }
`;