import { gql } from '@apollo/client';
import * as Apollo from '@apollo/client';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };
export type MakeEmpty<T extends { [key: string]: unknown }, K extends keyof T> = { [_ in K]?: never };
export type Incremental<T> = T | { [P in keyof T]?: P extends ' $fragmentName' | '__typename' ? T[P] : never };
const defaultOptions = {} as const;
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
};

export type AddBikeInput = {
  dropper?: InputMaybe<BikeComponentInput>;
  fork?: InputMaybe<BikeComponentInput>;
  manufacturer: Scalars['String']['input'];
  model: Scalars['String']['input'];
  nickname?: InputMaybe<Scalars['String']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  pivotBearings?: InputMaybe<BikeComponentInput>;
  shock?: InputMaybe<BikeComponentInput>;
  travelForkMm?: InputMaybe<Scalars['Int']['input']>;
  travelShockMm?: InputMaybe<Scalars['Int']['input']>;
  wheels?: InputMaybe<BikeComponentInput>;
  year: Scalars['Int']['input'];
};

export type AddComponentInput = {
  brand?: InputMaybe<Scalars['String']['input']>;
  hoursUsed?: InputMaybe<Scalars['Float']['input']>;
  isStock?: InputMaybe<Scalars['Boolean']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  serviceDueAtHours?: InputMaybe<Scalars['Float']['input']>;
  type: ComponentType;
};

export type AddRideInput = {
  averageHr?: InputMaybe<Scalars['Int']['input']>;
  bikeId?: InputMaybe<Scalars['ID']['input']>;
  distanceMiles: Scalars['Float']['input'];
  durationSeconds: Scalars['Int']['input'];
  elevationGainFeet: Scalars['Float']['input'];
  location?: InputMaybe<Scalars['String']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  rideType: Scalars['String']['input'];
  startTime: Scalars['String']['input'];
  trailSystem?: InputMaybe<Scalars['String']['input']>;
};

export type Bike = {
  __typename?: 'Bike';
  components: Array<Component>;
  createdAt: Scalars['String']['output'];
  dropper?: Maybe<Component>;
  fork?: Maybe<Component>;
  id: Scalars['ID']['output'];
  manufacturer: Scalars['String']['output'];
  model: Scalars['String']['output'];
  nickname?: Maybe<Scalars['String']['output']>;
  notes?: Maybe<Scalars['String']['output']>;
  pivotBearings?: Maybe<Component>;
  shock?: Maybe<Component>;
  travelForkMm?: Maybe<Scalars['Int']['output']>;
  travelShockMm?: Maybe<Scalars['Int']['output']>;
  updatedAt: Scalars['String']['output'];
  wheels?: Maybe<Component>;
  year?: Maybe<Scalars['Int']['output']>;
};

export type BikeComponentInput = {
  brand?: InputMaybe<Scalars['String']['input']>;
  isStock?: InputMaybe<Scalars['Boolean']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
};

export type Component = {
  __typename?: 'Component';
  bikeId?: Maybe<Scalars['ID']['output']>;
  brand: Scalars['String']['output'];
  createdAt: Scalars['String']['output'];
  hoursUsed: Scalars['Float']['output'];
  id: Scalars['ID']['output'];
  installedAt?: Maybe<Scalars['String']['output']>;
  isSpare: Scalars['Boolean']['output'];
  isStock: Scalars['Boolean']['output'];
  model: Scalars['String']['output'];
  notes?: Maybe<Scalars['String']['output']>;
  serviceDueAtHours?: Maybe<Scalars['Float']['output']>;
  type: ComponentType;
  updatedAt: Scalars['String']['output'];
};

export type ComponentFilterInput = {
  bikeId?: InputMaybe<Scalars['ID']['input']>;
  onlySpare?: InputMaybe<Scalars['Boolean']['input']>;
  types?: InputMaybe<Array<ComponentType>>;
};

export enum ComponentType {
  Brakes = 'BRAKES',
  Cassette = 'CASSETTE',
  Chain = 'CHAIN',
  Drivetrain = 'DRIVETRAIN',
  Dropper = 'DROPPER',
  Fork = 'FORK',
  Other = 'OTHER',
  Pedals = 'PEDALS',
  PivotBearings = 'PIVOT_BEARINGS',
  Shock = 'SHOCK',
  Tires = 'TIRES',
  Wheels = 'WHEELS'
}

export type ConnectedAccount = {
  __typename?: 'ConnectedAccount';
  connectedAt: Scalars['String']['output'];
  provider: Scalars['String']['output'];
};

export type CreateStravaGearMappingInput = {
  bikeId: Scalars['ID']['input'];
  stravaGearId: Scalars['String']['input'];
  stravaGearName?: InputMaybe<Scalars['String']['input']>;
};

export type DeleteResult = {
  __typename?: 'DeleteResult';
  id: Scalars['ID']['output'];
  ok: Scalars['Boolean']['output'];
};

export type DeleteRideResult = {
  __typename?: 'DeleteRideResult';
  id: Scalars['ID']['output'];
  ok: Scalars['Boolean']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  addBike: Bike;
  addComponent: Component;
  addRide: Ride;
  createStravaGearMapping: StravaGearMapping;
  deleteComponent: DeleteResult;
  deleteRide: DeleteRideResult;
  deleteStravaGearMapping: DeleteResult;
  logComponentService: Component;
  updateBike: Bike;
  updateComponent: Component;
  updateRide: Ride;
};


export type MutationAddBikeArgs = {
  input: AddBikeInput;
};


export type MutationAddComponentArgs = {
  bikeId?: InputMaybe<Scalars['ID']['input']>;
  input: AddComponentInput;
};


export type MutationAddRideArgs = {
  input: AddRideInput;
};


export type MutationCreateStravaGearMappingArgs = {
  input: CreateStravaGearMappingInput;
};


export type MutationDeleteComponentArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteRideArgs = {
  id: Scalars['ID']['input'];
};


export type MutationDeleteStravaGearMappingArgs = {
  id: Scalars['ID']['input'];
};


export type MutationLogComponentServiceArgs = {
  id: Scalars['ID']['input'];
};


export type MutationUpdateBikeArgs = {
  id: Scalars['ID']['input'];
  input: UpdateBikeInput;
};


export type MutationUpdateComponentArgs = {
  id: Scalars['ID']['input'];
  input: UpdateComponentInput;
};


export type MutationUpdateRideArgs = {
  id: Scalars['ID']['input'];
  input: UpdateRideInput;
};

export type Query = {
  __typename?: 'Query';
  bikes: Array<Bike>;
  components: Array<Component>;
  me?: Maybe<User>;
  rideTypes: Array<RideType>;
  rides: Array<Ride>;
  stravaGearMappings: Array<StravaGearMapping>;
  unmappedStravaGears: Array<StravaGearInfo>;
  user?: Maybe<User>;
};


export type QueryComponentsArgs = {
  filter?: InputMaybe<ComponentFilterInput>;
};


export type QueryRidesArgs = {
  after?: InputMaybe<Scalars['ID']['input']>;
  filter?: InputMaybe<RidesFilterInput>;
  take?: InputMaybe<Scalars['Int']['input']>;
};


export type QueryUserArgs = {
  id: Scalars['ID']['input'];
};

export type Ride = {
  __typename?: 'Ride';
  averageHr?: Maybe<Scalars['Int']['output']>;
  bikeId?: Maybe<Scalars['ID']['output']>;
  createdAt: Scalars['String']['output'];
  distanceMiles: Scalars['Float']['output'];
  durationSeconds: Scalars['Int']['output'];
  elevationGainFeet: Scalars['Float']['output'];
  garminActivityId?: Maybe<Scalars['String']['output']>;
  id: Scalars['ID']['output'];
  location?: Maybe<Scalars['String']['output']>;
  notes?: Maybe<Scalars['String']['output']>;
  rideType: Scalars['String']['output'];
  startTime: Scalars['String']['output'];
  stravaActivityId?: Maybe<Scalars['String']['output']>;
  stravaGearId?: Maybe<Scalars['String']['output']>;
  trailSystem?: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['String']['output'];
  userId: Scalars['ID']['output'];
};

export enum RideType {
  Commute = 'COMMUTE',
  Enduro = 'ENDURO',
  Gravel = 'GRAVEL',
  Road = 'ROAD',
  Trail = 'TRAIL',
  Trainer = 'TRAINER'
}

export type RidesFilterInput = {
  endDate?: InputMaybe<Scalars['String']['input']>;
  startDate?: InputMaybe<Scalars['String']['input']>;
};

export type StravaGearInfo = {
  __typename?: 'StravaGearInfo';
  gearId: Scalars['String']['output'];
  gearName?: Maybe<Scalars['String']['output']>;
  isMapped: Scalars['Boolean']['output'];
  rideCount: Scalars['Int']['output'];
};

export type StravaGearMapping = {
  __typename?: 'StravaGearMapping';
  bike: Bike;
  bikeId: Scalars['ID']['output'];
  createdAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  stravaGearId: Scalars['String']['output'];
  stravaGearName?: Maybe<Scalars['String']['output']>;
};

export type UpdateBikeInput = {
  dropper?: InputMaybe<BikeComponentInput>;
  fork?: InputMaybe<BikeComponentInput>;
  manufacturer?: InputMaybe<Scalars['String']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  nickname?: InputMaybe<Scalars['String']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  pivotBearings?: InputMaybe<BikeComponentInput>;
  shock?: InputMaybe<BikeComponentInput>;
  travelForkMm?: InputMaybe<Scalars['Int']['input']>;
  travelShockMm?: InputMaybe<Scalars['Int']['input']>;
  wheels?: InputMaybe<BikeComponentInput>;
  year?: InputMaybe<Scalars['Int']['input']>;
};

export type UpdateComponentInput = {
  brand?: InputMaybe<Scalars['String']['input']>;
  hoursUsed?: InputMaybe<Scalars['Float']['input']>;
  isStock?: InputMaybe<Scalars['Boolean']['input']>;
  model?: InputMaybe<Scalars['String']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  serviceDueAtHours?: InputMaybe<Scalars['Float']['input']>;
};

export type UpdateRideInput = {
  averageHr?: InputMaybe<Scalars['Int']['input']>;
  bikeId?: InputMaybe<Scalars['ID']['input']>;
  distanceMiles?: InputMaybe<Scalars['Float']['input']>;
  durationSeconds?: InputMaybe<Scalars['Int']['input']>;
  elevationGainFeet?: InputMaybe<Scalars['Float']['input']>;
  location?: InputMaybe<Scalars['String']['input']>;
  notes?: InputMaybe<Scalars['String']['input']>;
  rideType?: InputMaybe<Scalars['String']['input']>;
  startTime?: InputMaybe<Scalars['String']['input']>;
  trailSystem?: InputMaybe<Scalars['String']['input']>;
};

export type User = {
  __typename?: 'User';
  accounts: Array<ConnectedAccount>;
  activeDataSource?: Maybe<Scalars['String']['output']>;
  age?: Maybe<Scalars['Int']['output']>;
  avatarUrl?: Maybe<Scalars['String']['output']>;
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  location?: Maybe<Scalars['String']['output']>;
  name?: Maybe<Scalars['String']['output']>;
  onboardingCompleted: Scalars['Boolean']['output'];
  rides: Array<Ride>;
};

export type BikeFieldsFragment = { __typename?: 'Bike', id: string, nickname?: string | null, manufacturer: string, model: string, year?: number | null, travelForkMm?: number | null, travelShockMm?: number | null, notes?: string | null, createdAt: string, updatedAt: string, components: Array<{ __typename?: 'Component', id: string, type: ComponentType, brand: string, model: string, notes?: string | null, isStock: boolean, bikeId?: string | null, hoursUsed: number, serviceDueAtHours?: number | null }> };

export type ComponentFieldsFragment = { __typename?: 'Component', id: string, type: ComponentType, brand: string, model: string, notes?: string | null, isStock: boolean, bikeId?: string | null, hoursUsed: number, serviceDueAtHours?: number | null };

export type AddRideMutationVariables = Exact<{
  input: AddRideInput;
}>;


export type AddRideMutation = { __typename?: 'Mutation', addRide: { __typename?: 'Ride', id: string, startTime: string, durationSeconds: number, distanceMiles: number, elevationGainFeet: number, averageHr?: number | null, rideType: string, bikeId?: string | null, notes?: string | null, trailSystem?: string | null, location?: string | null } };

export type BikesQueryVariables = Exact<{ [key: string]: never; }>;


export type BikesQuery = { __typename?: 'Query', bikes: Array<{ __typename?: 'Bike', id: string, nickname?: string | null, manufacturer: string, model: string, travelForkMm?: number | null, travelShockMm?: number | null, notes?: string | null, fork?: { __typename?: 'Component', id: string, brand: string, model: string, hoursUsed: number, serviceDueAtHours?: number | null } | null, shock?: { __typename?: 'Component', id: string, brand: string, model: string, hoursUsed: number, serviceDueAtHours?: number | null } | null, pivotBearings?: { __typename?: 'Component', id: string, brand: string, model: string, hoursUsed: number, serviceDueAtHours?: number | null } | null, components: Array<{ __typename?: 'Component', id: string, type: ComponentType, brand: string, model: string, hoursUsed: number, serviceDueAtHours?: number | null }> }> };

export type DeleteRideMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteRideMutation = { __typename?: 'Mutation', deleteRide: { __typename?: 'DeleteRideResult', ok: boolean, id: string } };

export type GearQueryVariables = Exact<{ [key: string]: never; }>;


export type GearQuery = { __typename?: 'Query', bikes: Array<{ __typename?: 'Bike', id: string, nickname?: string | null, manufacturer: string, model: string, year?: number | null, travelForkMm?: number | null, travelShockMm?: number | null, notes?: string | null, createdAt: string, updatedAt: string, components: Array<{ __typename?: 'Component', id: string, type: ComponentType, brand: string, model: string, notes?: string | null, isStock: boolean, bikeId?: string | null, hoursUsed: number, serviceDueAtHours?: number | null }> }>, spareComponents: Array<{ __typename?: 'Component', id: string, type: ComponentType, brand: string, model: string, notes?: string | null, isStock: boolean, bikeId?: string | null, hoursUsed: number, serviceDueAtHours?: number | null }> };

export type AddBikeMutationVariables = Exact<{
  input: AddBikeInput;
}>;


export type AddBikeMutation = { __typename?: 'Mutation', addBike: { __typename?: 'Bike', id: string, nickname?: string | null, manufacturer: string, model: string, year?: number | null, travelForkMm?: number | null, travelShockMm?: number | null, notes?: string | null, createdAt: string, updatedAt: string, components: Array<{ __typename?: 'Component', id: string, type: ComponentType, brand: string, model: string, notes?: string | null, isStock: boolean, bikeId?: string | null, hoursUsed: number, serviceDueAtHours?: number | null }> } };

export type UpdateBikeMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateBikeInput;
}>;


export type UpdateBikeMutation = { __typename?: 'Mutation', updateBike: { __typename?: 'Bike', id: string, nickname?: string | null, manufacturer: string, model: string, year?: number | null, travelForkMm?: number | null, travelShockMm?: number | null, notes?: string | null, createdAt: string, updatedAt: string, components: Array<{ __typename?: 'Component', id: string, type: ComponentType, brand: string, model: string, notes?: string | null, isStock: boolean, bikeId?: string | null, hoursUsed: number, serviceDueAtHours?: number | null }> } };

export type AddComponentMutationVariables = Exact<{
  input: AddComponentInput;
  bikeId?: InputMaybe<Scalars['ID']['input']>;
}>;


export type AddComponentMutation = { __typename?: 'Mutation', addComponent: { __typename?: 'Component', id: string, type: ComponentType, brand: string, model: string, notes?: string | null, isStock: boolean, bikeId?: string | null, hoursUsed: number, serviceDueAtHours?: number | null } };

export type UpdateComponentMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateComponentInput;
}>;


export type UpdateComponentMutation = { __typename?: 'Mutation', updateComponent: { __typename?: 'Component', id: string, type: ComponentType, brand: string, model: string, notes?: string | null, isStock: boolean, bikeId?: string | null, hoursUsed: number, serviceDueAtHours?: number | null } };

export type DeleteComponentMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteComponentMutation = { __typename?: 'Mutation', deleteComponent: { __typename?: 'DeleteResult', ok: boolean, id: string } };

export type LogComponentServiceMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type LogComponentServiceMutation = { __typename?: 'Mutation', logComponentService: { __typename?: 'Component', id: string, hoursUsed: number, updatedAt: string } };

export type MeQueryVariables = Exact<{ [key: string]: never; }>;


export type MeQuery = { __typename?: 'Query', me?: { __typename?: 'User', id: string, email: string, name?: string | null, avatarUrl?: string | null, onboardingCompleted: boolean, location?: string | null, age?: number | null } | null };

export type RideTypesQueryVariables = Exact<{ [key: string]: never; }>;


export type RideTypesQuery = { __typename?: 'Query', rideTypes: Array<RideType> };

export type RidesQueryVariables = Exact<{
  take?: InputMaybe<Scalars['Int']['input']>;
  after?: InputMaybe<Scalars['ID']['input']>;
  filter?: InputMaybe<RidesFilterInput>;
}>;


export type RidesQuery = { __typename?: 'Query', rides: Array<{ __typename?: 'Ride', id: string, garminActivityId?: string | null, stravaActivityId?: string | null, startTime: string, durationSeconds: number, distanceMiles: number, elevationGainFeet: number, averageHr?: number | null, rideType: string, bikeId?: string | null, notes?: string | null, trailSystem?: string | null, location?: string | null }> };

export type UnmappedStravaGearsQueryVariables = Exact<{ [key: string]: never; }>;


export type UnmappedStravaGearsQuery = { __typename?: 'Query', unmappedStravaGears: Array<{ __typename?: 'StravaGearInfo', gearId: string, gearName?: string | null, rideCount: number, isMapped: boolean }> };

export type StravaGearMappingsQueryVariables = Exact<{ [key: string]: never; }>;


export type StravaGearMappingsQuery = { __typename?: 'Query', stravaGearMappings: Array<{ __typename?: 'StravaGearMapping', id: string, stravaGearId: string, stravaGearName?: string | null, bikeId: string, createdAt: string, bike: { __typename?: 'Bike', id: string, nickname?: string | null, manufacturer: string, model: string } }> };

export type CreateStravaGearMappingMutationVariables = Exact<{
  input: CreateStravaGearMappingInput;
}>;


export type CreateStravaGearMappingMutation = { __typename?: 'Mutation', createStravaGearMapping: { __typename?: 'StravaGearMapping', id: string, stravaGearId: string, stravaGearName?: string | null, bikeId: string } };

export type DeleteStravaGearMappingMutationVariables = Exact<{
  id: Scalars['ID']['input'];
}>;


export type DeleteStravaGearMappingMutation = { __typename?: 'Mutation', deleteStravaGearMapping: { __typename?: 'DeleteResult', ok: boolean, id: string } };

export type UpdateRideMutationVariables = Exact<{
  id: Scalars['ID']['input'];
  input: UpdateRideInput;
}>;


export type UpdateRideMutation = { __typename?: 'Mutation', updateRide: { __typename?: 'Ride', id: string, startTime: string, durationSeconds: number, distanceMiles: number, elevationGainFeet: number, averageHr?: number | null, rideType: string, bikeId?: string | null, notes?: string | null, trailSystem?: string | null, location?: string | null, updatedAt: string } };

export const ComponentFieldsFragmentDoc = gql`
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
}
    `;
export const BikeFieldsFragmentDoc = gql`
    fragment BikeFields on Bike {
  id
  nickname
  manufacturer
  model
  year
  travelForkMm
  travelShockMm
  notes
  components {
    ...ComponentFields
  }
  createdAt
  updatedAt
}
    ${ComponentFieldsFragmentDoc}`;
export const AddRideDocument = gql`
    mutation AddRide($input: AddRideInput!) {
  addRide(input: $input) {
    id
    startTime
    durationSeconds
    distanceMiles
    elevationGainFeet
    averageHr
    rideType
    bikeId
    notes
    trailSystem
    location
  }
}
    `;
export type AddRideMutationFn = Apollo.MutationFunction<AddRideMutation, AddRideMutationVariables>;

/**
 * __useAddRideMutation__
 *
 * To run a mutation, you first call `useAddRideMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useAddRideMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [addRideMutation, { data, loading, error }] = useAddRideMutation({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useAddRideMutation(baseOptions?: Apollo.MutationHookOptions<AddRideMutation, AddRideMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<AddRideMutation, AddRideMutationVariables>(AddRideDocument, options);
      }
export type AddRideMutationHookResult = ReturnType<typeof useAddRideMutation>;
export type AddRideMutationResult = Apollo.MutationResult<AddRideMutation>;
export type AddRideMutationOptions = Apollo.BaseMutationOptions<AddRideMutation, AddRideMutationVariables>;
export const BikesDocument = gql`
    query Bikes {
  bikes {
    id
    nickname
    manufacturer
    model
    travelForkMm
    travelShockMm
    notes
    fork {
      id
      brand
      model
      hoursUsed
      serviceDueAtHours
    }
    shock {
      id
      brand
      model
      hoursUsed
      serviceDueAtHours
    }
    pivotBearings {
      id
      brand
      model
      hoursUsed
      serviceDueAtHours
    }
    components {
      id
      type
      brand
      model
      hoursUsed
      serviceDueAtHours
    }
  }
}
    `;

/**
 * __useBikesQuery__
 *
 * To run a query within a React component, call `useBikesQuery` and pass it any options that fit your needs.
 * When your component renders, `useBikesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useBikesQuery({
 *   variables: {
 *   },
 * });
 */
export function useBikesQuery(baseOptions?: Apollo.QueryHookOptions<BikesQuery, BikesQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<BikesQuery, BikesQueryVariables>(BikesDocument, options);
      }
export function useBikesLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<BikesQuery, BikesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<BikesQuery, BikesQueryVariables>(BikesDocument, options);
        }
// @ts-ignore
export function useBikesSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<BikesQuery, BikesQueryVariables>): Apollo.UseSuspenseQueryResult<BikesQuery, BikesQueryVariables>;
export function useBikesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<BikesQuery, BikesQueryVariables>): Apollo.UseSuspenseQueryResult<BikesQuery | undefined, BikesQueryVariables>;
export function useBikesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<BikesQuery, BikesQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<BikesQuery, BikesQueryVariables>(BikesDocument, options);
        }
export type BikesQueryHookResult = ReturnType<typeof useBikesQuery>;
export type BikesLazyQueryHookResult = ReturnType<typeof useBikesLazyQuery>;
export type BikesSuspenseQueryHookResult = ReturnType<typeof useBikesSuspenseQuery>;
export type BikesQueryResult = Apollo.QueryResult<BikesQuery, BikesQueryVariables>;
export const DeleteRideDocument = gql`
    mutation DeleteRide($id: ID!) {
  deleteRide(id: $id) {
    ok
    id
  }
}
    `;
export type DeleteRideMutationFn = Apollo.MutationFunction<DeleteRideMutation, DeleteRideMutationVariables>;

/**
 * __useDeleteRideMutation__
 *
 * To run a mutation, you first call `useDeleteRideMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteRideMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteRideMutation, { data, loading, error }] = useDeleteRideMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useDeleteRideMutation(baseOptions?: Apollo.MutationHookOptions<DeleteRideMutation, DeleteRideMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeleteRideMutation, DeleteRideMutationVariables>(DeleteRideDocument, options);
      }
export type DeleteRideMutationHookResult = ReturnType<typeof useDeleteRideMutation>;
export type DeleteRideMutationResult = Apollo.MutationResult<DeleteRideMutation>;
export type DeleteRideMutationOptions = Apollo.BaseMutationOptions<DeleteRideMutation, DeleteRideMutationVariables>;
export const GearDocument = gql`
    query Gear {
  bikes {
    ...BikeFields
  }
  spareComponents: components(
    filter: {onlySpare: true, types: [FORK, SHOCK, DROPPER, WHEELS]}
  ) {
    ...ComponentFields
  }
}
    ${BikeFieldsFragmentDoc}
${ComponentFieldsFragmentDoc}`;

/**
 * __useGearQuery__
 *
 * To run a query within a React component, call `useGearQuery` and pass it any options that fit your needs.
 * When your component renders, `useGearQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useGearQuery({
 *   variables: {
 *   },
 * });
 */
export function useGearQuery(baseOptions?: Apollo.QueryHookOptions<GearQuery, GearQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<GearQuery, GearQueryVariables>(GearDocument, options);
      }
export function useGearLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<GearQuery, GearQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<GearQuery, GearQueryVariables>(GearDocument, options);
        }
// @ts-ignore
export function useGearSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<GearQuery, GearQueryVariables>): Apollo.UseSuspenseQueryResult<GearQuery, GearQueryVariables>;
export function useGearSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<GearQuery, GearQueryVariables>): Apollo.UseSuspenseQueryResult<GearQuery | undefined, GearQueryVariables>;
export function useGearSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<GearQuery, GearQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<GearQuery, GearQueryVariables>(GearDocument, options);
        }
export type GearQueryHookResult = ReturnType<typeof useGearQuery>;
export type GearLazyQueryHookResult = ReturnType<typeof useGearLazyQuery>;
export type GearSuspenseQueryHookResult = ReturnType<typeof useGearSuspenseQuery>;
export type GearQueryResult = Apollo.QueryResult<GearQuery, GearQueryVariables>;
export const AddBikeDocument = gql`
    mutation AddBike($input: AddBikeInput!) {
  addBike(input: $input) {
    ...BikeFields
  }
}
    ${BikeFieldsFragmentDoc}`;
export type AddBikeMutationFn = Apollo.MutationFunction<AddBikeMutation, AddBikeMutationVariables>;

/**
 * __useAddBikeMutation__
 *
 * To run a mutation, you first call `useAddBikeMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useAddBikeMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [addBikeMutation, { data, loading, error }] = useAddBikeMutation({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useAddBikeMutation(baseOptions?: Apollo.MutationHookOptions<AddBikeMutation, AddBikeMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<AddBikeMutation, AddBikeMutationVariables>(AddBikeDocument, options);
      }
export type AddBikeMutationHookResult = ReturnType<typeof useAddBikeMutation>;
export type AddBikeMutationResult = Apollo.MutationResult<AddBikeMutation>;
export type AddBikeMutationOptions = Apollo.BaseMutationOptions<AddBikeMutation, AddBikeMutationVariables>;
export const UpdateBikeDocument = gql`
    mutation UpdateBike($id: ID!, $input: UpdateBikeInput!) {
  updateBike(id: $id, input: $input) {
    ...BikeFields
  }
}
    ${BikeFieldsFragmentDoc}`;
export type UpdateBikeMutationFn = Apollo.MutationFunction<UpdateBikeMutation, UpdateBikeMutationVariables>;

/**
 * __useUpdateBikeMutation__
 *
 * To run a mutation, you first call `useUpdateBikeMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateBikeMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateBikeMutation, { data, loading, error }] = useUpdateBikeMutation({
 *   variables: {
 *      id: // value for 'id'
 *      input: // value for 'input'
 *   },
 * });
 */
export function useUpdateBikeMutation(baseOptions?: Apollo.MutationHookOptions<UpdateBikeMutation, UpdateBikeMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateBikeMutation, UpdateBikeMutationVariables>(UpdateBikeDocument, options);
      }
export type UpdateBikeMutationHookResult = ReturnType<typeof useUpdateBikeMutation>;
export type UpdateBikeMutationResult = Apollo.MutationResult<UpdateBikeMutation>;
export type UpdateBikeMutationOptions = Apollo.BaseMutationOptions<UpdateBikeMutation, UpdateBikeMutationVariables>;
export const AddComponentDocument = gql`
    mutation AddComponent($input: AddComponentInput!, $bikeId: ID) {
  addComponent(input: $input, bikeId: $bikeId) {
    ...ComponentFields
  }
}
    ${ComponentFieldsFragmentDoc}`;
export type AddComponentMutationFn = Apollo.MutationFunction<AddComponentMutation, AddComponentMutationVariables>;

/**
 * __useAddComponentMutation__
 *
 * To run a mutation, you first call `useAddComponentMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useAddComponentMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [addComponentMutation, { data, loading, error }] = useAddComponentMutation({
 *   variables: {
 *      input: // value for 'input'
 *      bikeId: // value for 'bikeId'
 *   },
 * });
 */
export function useAddComponentMutation(baseOptions?: Apollo.MutationHookOptions<AddComponentMutation, AddComponentMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<AddComponentMutation, AddComponentMutationVariables>(AddComponentDocument, options);
      }
export type AddComponentMutationHookResult = ReturnType<typeof useAddComponentMutation>;
export type AddComponentMutationResult = Apollo.MutationResult<AddComponentMutation>;
export type AddComponentMutationOptions = Apollo.BaseMutationOptions<AddComponentMutation, AddComponentMutationVariables>;
export const UpdateComponentDocument = gql`
    mutation UpdateComponent($id: ID!, $input: UpdateComponentInput!) {
  updateComponent(id: $id, input: $input) {
    ...ComponentFields
  }
}
    ${ComponentFieldsFragmentDoc}`;
export type UpdateComponentMutationFn = Apollo.MutationFunction<UpdateComponentMutation, UpdateComponentMutationVariables>;

/**
 * __useUpdateComponentMutation__
 *
 * To run a mutation, you first call `useUpdateComponentMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateComponentMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateComponentMutation, { data, loading, error }] = useUpdateComponentMutation({
 *   variables: {
 *      id: // value for 'id'
 *      input: // value for 'input'
 *   },
 * });
 */
export function useUpdateComponentMutation(baseOptions?: Apollo.MutationHookOptions<UpdateComponentMutation, UpdateComponentMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateComponentMutation, UpdateComponentMutationVariables>(UpdateComponentDocument, options);
      }
export type UpdateComponentMutationHookResult = ReturnType<typeof useUpdateComponentMutation>;
export type UpdateComponentMutationResult = Apollo.MutationResult<UpdateComponentMutation>;
export type UpdateComponentMutationOptions = Apollo.BaseMutationOptions<UpdateComponentMutation, UpdateComponentMutationVariables>;
export const DeleteComponentDocument = gql`
    mutation DeleteComponent($id: ID!) {
  deleteComponent(id: $id) {
    ok
    id
  }
}
    `;
export type DeleteComponentMutationFn = Apollo.MutationFunction<DeleteComponentMutation, DeleteComponentMutationVariables>;

/**
 * __useDeleteComponentMutation__
 *
 * To run a mutation, you first call `useDeleteComponentMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteComponentMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteComponentMutation, { data, loading, error }] = useDeleteComponentMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useDeleteComponentMutation(baseOptions?: Apollo.MutationHookOptions<DeleteComponentMutation, DeleteComponentMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeleteComponentMutation, DeleteComponentMutationVariables>(DeleteComponentDocument, options);
      }
export type DeleteComponentMutationHookResult = ReturnType<typeof useDeleteComponentMutation>;
export type DeleteComponentMutationResult = Apollo.MutationResult<DeleteComponentMutation>;
export type DeleteComponentMutationOptions = Apollo.BaseMutationOptions<DeleteComponentMutation, DeleteComponentMutationVariables>;
export const LogComponentServiceDocument = gql`
    mutation LogComponentService($id: ID!) {
  logComponentService(id: $id) {
    id
    hoursUsed
    updatedAt
  }
}
    `;
export type LogComponentServiceMutationFn = Apollo.MutationFunction<LogComponentServiceMutation, LogComponentServiceMutationVariables>;

/**
 * __useLogComponentServiceMutation__
 *
 * To run a mutation, you first call `useLogComponentServiceMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useLogComponentServiceMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [logComponentServiceMutation, { data, loading, error }] = useLogComponentServiceMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useLogComponentServiceMutation(baseOptions?: Apollo.MutationHookOptions<LogComponentServiceMutation, LogComponentServiceMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<LogComponentServiceMutation, LogComponentServiceMutationVariables>(LogComponentServiceDocument, options);
      }
export type LogComponentServiceMutationHookResult = ReturnType<typeof useLogComponentServiceMutation>;
export type LogComponentServiceMutationResult = Apollo.MutationResult<LogComponentServiceMutation>;
export type LogComponentServiceMutationOptions = Apollo.BaseMutationOptions<LogComponentServiceMutation, LogComponentServiceMutationVariables>;
export const MeDocument = gql`
    query Me {
  me {
    id
    email
    name
    avatarUrl
    onboardingCompleted
    location
    age
  }
}
    `;

/**
 * __useMeQuery__
 *
 * To run a query within a React component, call `useMeQuery` and pass it any options that fit your needs.
 * When your component renders, `useMeQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useMeQuery({
 *   variables: {
 *   },
 * });
 */
export function useMeQuery(baseOptions?: Apollo.QueryHookOptions<MeQuery, MeQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<MeQuery, MeQueryVariables>(MeDocument, options);
      }
export function useMeLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<MeQuery, MeQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<MeQuery, MeQueryVariables>(MeDocument, options);
        }
// @ts-ignore
export function useMeSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<MeQuery, MeQueryVariables>): Apollo.UseSuspenseQueryResult<MeQuery, MeQueryVariables>;
export function useMeSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<MeQuery, MeQueryVariables>): Apollo.UseSuspenseQueryResult<MeQuery | undefined, MeQueryVariables>;
export function useMeSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<MeQuery, MeQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<MeQuery, MeQueryVariables>(MeDocument, options);
        }
export type MeQueryHookResult = ReturnType<typeof useMeQuery>;
export type MeLazyQueryHookResult = ReturnType<typeof useMeLazyQuery>;
export type MeSuspenseQueryHookResult = ReturnType<typeof useMeSuspenseQuery>;
export type MeQueryResult = Apollo.QueryResult<MeQuery, MeQueryVariables>;
export const RideTypesDocument = gql`
    query RideTypes {
  rideTypes
}
    `;

/**
 * __useRideTypesQuery__
 *
 * To run a query within a React component, call `useRideTypesQuery` and pass it any options that fit your needs.
 * When your component renders, `useRideTypesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useRideTypesQuery({
 *   variables: {
 *   },
 * });
 */
export function useRideTypesQuery(baseOptions?: Apollo.QueryHookOptions<RideTypesQuery, RideTypesQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<RideTypesQuery, RideTypesQueryVariables>(RideTypesDocument, options);
      }
export function useRideTypesLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<RideTypesQuery, RideTypesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<RideTypesQuery, RideTypesQueryVariables>(RideTypesDocument, options);
        }
// @ts-ignore
export function useRideTypesSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<RideTypesQuery, RideTypesQueryVariables>): Apollo.UseSuspenseQueryResult<RideTypesQuery, RideTypesQueryVariables>;
export function useRideTypesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<RideTypesQuery, RideTypesQueryVariables>): Apollo.UseSuspenseQueryResult<RideTypesQuery | undefined, RideTypesQueryVariables>;
export function useRideTypesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<RideTypesQuery, RideTypesQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<RideTypesQuery, RideTypesQueryVariables>(RideTypesDocument, options);
        }
export type RideTypesQueryHookResult = ReturnType<typeof useRideTypesQuery>;
export type RideTypesLazyQueryHookResult = ReturnType<typeof useRideTypesLazyQuery>;
export type RideTypesSuspenseQueryHookResult = ReturnType<typeof useRideTypesSuspenseQuery>;
export type RideTypesQueryResult = Apollo.QueryResult<RideTypesQuery, RideTypesQueryVariables>;
export const RidesDocument = gql`
    query Rides($take: Int, $after: ID, $filter: RidesFilterInput) {
  rides(take: $take, after: $after, filter: $filter) {
    id
    garminActivityId
    stravaActivityId
    startTime
    durationSeconds
    distanceMiles
    elevationGainFeet
    averageHr
    rideType
    bikeId
    notes
    trailSystem
    location
  }
}
    `;

/**
 * __useRidesQuery__
 *
 * To run a query within a React component, call `useRidesQuery` and pass it any options that fit your needs.
 * When your component renders, `useRidesQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useRidesQuery({
 *   variables: {
 *      take: // value for 'take'
 *      after: // value for 'after'
 *      filter: // value for 'filter'
 *   },
 * });
 */
export function useRidesQuery(baseOptions?: Apollo.QueryHookOptions<RidesQuery, RidesQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<RidesQuery, RidesQueryVariables>(RidesDocument, options);
      }
export function useRidesLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<RidesQuery, RidesQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<RidesQuery, RidesQueryVariables>(RidesDocument, options);
        }
// @ts-ignore
export function useRidesSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<RidesQuery, RidesQueryVariables>): Apollo.UseSuspenseQueryResult<RidesQuery, RidesQueryVariables>;
export function useRidesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<RidesQuery, RidesQueryVariables>): Apollo.UseSuspenseQueryResult<RidesQuery | undefined, RidesQueryVariables>;
export function useRidesSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<RidesQuery, RidesQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<RidesQuery, RidesQueryVariables>(RidesDocument, options);
        }
export type RidesQueryHookResult = ReturnType<typeof useRidesQuery>;
export type RidesLazyQueryHookResult = ReturnType<typeof useRidesLazyQuery>;
export type RidesSuspenseQueryHookResult = ReturnType<typeof useRidesSuspenseQuery>;
export type RidesQueryResult = Apollo.QueryResult<RidesQuery, RidesQueryVariables>;
export const UnmappedStravaGearsDocument = gql`
    query UnmappedStravaGears {
  unmappedStravaGears {
    gearId
    gearName
    rideCount
    isMapped
  }
}
    `;

/**
 * __useUnmappedStravaGearsQuery__
 *
 * To run a query within a React component, call `useUnmappedStravaGearsQuery` and pass it any options that fit your needs.
 * When your component renders, `useUnmappedStravaGearsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useUnmappedStravaGearsQuery({
 *   variables: {
 *   },
 * });
 */
export function useUnmappedStravaGearsQuery(baseOptions?: Apollo.QueryHookOptions<UnmappedStravaGearsQuery, UnmappedStravaGearsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<UnmappedStravaGearsQuery, UnmappedStravaGearsQueryVariables>(UnmappedStravaGearsDocument, options);
      }
export function useUnmappedStravaGearsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<UnmappedStravaGearsQuery, UnmappedStravaGearsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<UnmappedStravaGearsQuery, UnmappedStravaGearsQueryVariables>(UnmappedStravaGearsDocument, options);
        }
// @ts-ignore
export function useUnmappedStravaGearsSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<UnmappedStravaGearsQuery, UnmappedStravaGearsQueryVariables>): Apollo.UseSuspenseQueryResult<UnmappedStravaGearsQuery, UnmappedStravaGearsQueryVariables>;
export function useUnmappedStravaGearsSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<UnmappedStravaGearsQuery, UnmappedStravaGearsQueryVariables>): Apollo.UseSuspenseQueryResult<UnmappedStravaGearsQuery | undefined, UnmappedStravaGearsQueryVariables>;
export function useUnmappedStravaGearsSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<UnmappedStravaGearsQuery, UnmappedStravaGearsQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<UnmappedStravaGearsQuery, UnmappedStravaGearsQueryVariables>(UnmappedStravaGearsDocument, options);
        }
export type UnmappedStravaGearsQueryHookResult = ReturnType<typeof useUnmappedStravaGearsQuery>;
export type UnmappedStravaGearsLazyQueryHookResult = ReturnType<typeof useUnmappedStravaGearsLazyQuery>;
export type UnmappedStravaGearsSuspenseQueryHookResult = ReturnType<typeof useUnmappedStravaGearsSuspenseQuery>;
export type UnmappedStravaGearsQueryResult = Apollo.QueryResult<UnmappedStravaGearsQuery, UnmappedStravaGearsQueryVariables>;
export const StravaGearMappingsDocument = gql`
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

/**
 * __useStravaGearMappingsQuery__
 *
 * To run a query within a React component, call `useStravaGearMappingsQuery` and pass it any options that fit your needs.
 * When your component renders, `useStravaGearMappingsQuery` returns an object from Apollo Client that contains loading, error, and data properties
 * you can use to render your UI.
 *
 * @param baseOptions options that will be passed into the query, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options;
 *
 * @example
 * const { data, loading, error } = useStravaGearMappingsQuery({
 *   variables: {
 *   },
 * });
 */
export function useStravaGearMappingsQuery(baseOptions?: Apollo.QueryHookOptions<StravaGearMappingsQuery, StravaGearMappingsQueryVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useQuery<StravaGearMappingsQuery, StravaGearMappingsQueryVariables>(StravaGearMappingsDocument, options);
      }
export function useStravaGearMappingsLazyQuery(baseOptions?: Apollo.LazyQueryHookOptions<StravaGearMappingsQuery, StravaGearMappingsQueryVariables>) {
          const options = {...defaultOptions, ...baseOptions}
          return Apollo.useLazyQuery<StravaGearMappingsQuery, StravaGearMappingsQueryVariables>(StravaGearMappingsDocument, options);
        }
// @ts-ignore
export function useStravaGearMappingsSuspenseQuery(baseOptions?: Apollo.SuspenseQueryHookOptions<StravaGearMappingsQuery, StravaGearMappingsQueryVariables>): Apollo.UseSuspenseQueryResult<StravaGearMappingsQuery, StravaGearMappingsQueryVariables>;
export function useStravaGearMappingsSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<StravaGearMappingsQuery, StravaGearMappingsQueryVariables>): Apollo.UseSuspenseQueryResult<StravaGearMappingsQuery | undefined, StravaGearMappingsQueryVariables>;
export function useStravaGearMappingsSuspenseQuery(baseOptions?: Apollo.SkipToken | Apollo.SuspenseQueryHookOptions<StravaGearMappingsQuery, StravaGearMappingsQueryVariables>) {
          const options = baseOptions === Apollo.skipToken ? baseOptions : {...defaultOptions, ...baseOptions}
          return Apollo.useSuspenseQuery<StravaGearMappingsQuery, StravaGearMappingsQueryVariables>(StravaGearMappingsDocument, options);
        }
export type StravaGearMappingsQueryHookResult = ReturnType<typeof useStravaGearMappingsQuery>;
export type StravaGearMappingsLazyQueryHookResult = ReturnType<typeof useStravaGearMappingsLazyQuery>;
export type StravaGearMappingsSuspenseQueryHookResult = ReturnType<typeof useStravaGearMappingsSuspenseQuery>;
export type StravaGearMappingsQueryResult = Apollo.QueryResult<StravaGearMappingsQuery, StravaGearMappingsQueryVariables>;
export const CreateStravaGearMappingDocument = gql`
    mutation CreateStravaGearMapping($input: CreateStravaGearMappingInput!) {
  createStravaGearMapping(input: $input) {
    id
    stravaGearId
    stravaGearName
    bikeId
  }
}
    `;
export type CreateStravaGearMappingMutationFn = Apollo.MutationFunction<CreateStravaGearMappingMutation, CreateStravaGearMappingMutationVariables>;

/**
 * __useCreateStravaGearMappingMutation__
 *
 * To run a mutation, you first call `useCreateStravaGearMappingMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useCreateStravaGearMappingMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [createStravaGearMappingMutation, { data, loading, error }] = useCreateStravaGearMappingMutation({
 *   variables: {
 *      input: // value for 'input'
 *   },
 * });
 */
export function useCreateStravaGearMappingMutation(baseOptions?: Apollo.MutationHookOptions<CreateStravaGearMappingMutation, CreateStravaGearMappingMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<CreateStravaGearMappingMutation, CreateStravaGearMappingMutationVariables>(CreateStravaGearMappingDocument, options);
      }
export type CreateStravaGearMappingMutationHookResult = ReturnType<typeof useCreateStravaGearMappingMutation>;
export type CreateStravaGearMappingMutationResult = Apollo.MutationResult<CreateStravaGearMappingMutation>;
export type CreateStravaGearMappingMutationOptions = Apollo.BaseMutationOptions<CreateStravaGearMappingMutation, CreateStravaGearMappingMutationVariables>;
export const DeleteStravaGearMappingDocument = gql`
    mutation DeleteStravaGearMapping($id: ID!) {
  deleteStravaGearMapping(id: $id) {
    ok
    id
  }
}
    `;
export type DeleteStravaGearMappingMutationFn = Apollo.MutationFunction<DeleteStravaGearMappingMutation, DeleteStravaGearMappingMutationVariables>;

/**
 * __useDeleteStravaGearMappingMutation__
 *
 * To run a mutation, you first call `useDeleteStravaGearMappingMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useDeleteStravaGearMappingMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [deleteStravaGearMappingMutation, { data, loading, error }] = useDeleteStravaGearMappingMutation({
 *   variables: {
 *      id: // value for 'id'
 *   },
 * });
 */
export function useDeleteStravaGearMappingMutation(baseOptions?: Apollo.MutationHookOptions<DeleteStravaGearMappingMutation, DeleteStravaGearMappingMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<DeleteStravaGearMappingMutation, DeleteStravaGearMappingMutationVariables>(DeleteStravaGearMappingDocument, options);
      }
export type DeleteStravaGearMappingMutationHookResult = ReturnType<typeof useDeleteStravaGearMappingMutation>;
export type DeleteStravaGearMappingMutationResult = Apollo.MutationResult<DeleteStravaGearMappingMutation>;
export type DeleteStravaGearMappingMutationOptions = Apollo.BaseMutationOptions<DeleteStravaGearMappingMutation, DeleteStravaGearMappingMutationVariables>;
export const UpdateRideDocument = gql`
    mutation UpdateRide($id: ID!, $input: UpdateRideInput!) {
  updateRide(id: $id, input: $input) {
    id
    startTime
    durationSeconds
    distanceMiles
    elevationGainFeet
    averageHr
    rideType
    bikeId
    notes
    trailSystem
    location
    updatedAt
  }
}
    `;
export type UpdateRideMutationFn = Apollo.MutationFunction<UpdateRideMutation, UpdateRideMutationVariables>;

/**
 * __useUpdateRideMutation__
 *
 * To run a mutation, you first call `useUpdateRideMutation` within a React component and pass it any options that fit your needs.
 * When your component renders, `useUpdateRideMutation` returns a tuple that includes:
 * - A mutate function that you can call at any time to execute the mutation
 * - An object with fields that represent the current status of the mutation's execution
 *
 * @param baseOptions options that will be passed into the mutation, supported options are listed on: https://www.apollographql.com/docs/react/api/react-hooks/#options-2;
 *
 * @example
 * const [updateRideMutation, { data, loading, error }] = useUpdateRideMutation({
 *   variables: {
 *      id: // value for 'id'
 *      input: // value for 'input'
 *   },
 * });
 */
export function useUpdateRideMutation(baseOptions?: Apollo.MutationHookOptions<UpdateRideMutation, UpdateRideMutationVariables>) {
        const options = {...defaultOptions, ...baseOptions}
        return Apollo.useMutation<UpdateRideMutation, UpdateRideMutationVariables>(UpdateRideDocument, options);
      }
export type UpdateRideMutationHookResult = ReturnType<typeof useUpdateRideMutation>;
export type UpdateRideMutationResult = Apollo.MutationResult<UpdateRideMutation>;
export type UpdateRideMutationOptions = Apollo.BaseMutationOptions<UpdateRideMutation, UpdateRideMutationVariables>;