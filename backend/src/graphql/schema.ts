import { gql } from 'graphql-tag';

export const typeDefs = gql`
  type Ride {
    id: ID!
    date: String!
    distanceMiles: Float!
    durationMin: Float!
    elevationFeet: Float!
    notes: String
  }

  type User {
    id: ID!
    email: String!
    rides: [Ride!]!
  }

  type Query {
    users: [User!]!
    user(id: ID!): User
    rides: [Ride!]!
  }
`;