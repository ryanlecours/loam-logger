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

  type Mutation {
    addRide(input: AddRideInput!): Ride!
    deleteRide(id: ID!): DeleteRideResult!
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
  }
`;