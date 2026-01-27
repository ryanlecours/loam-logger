import {
  WHOOP_CYCLING_SPORT_IDS,
  WHOOP_CYCLING_SPORT_NAMES,
  WHOOP_API_BASE,
  WHOOP_AUTH_URL,
  WHOOP_TOKEN_URL,
  isWhoopCyclingWorkout,
  getWhoopRideType,
  type WhoopWorkout,
  type WhoopWorkoutScore,
  type WhoopZoneDuration,
  type WhoopUserProfile,
  type WhoopPaginatedResponse,
  type WhoopTokenResponse,
} from './whoop';

describe('WHOOP types and constants', () => {
  describe('WHOOP_CYCLING_SPORT_IDS', () => {
    it('should include cycling sport id (1)', () => {
      expect(WHOOP_CYCLING_SPORT_IDS).toContain(1);
    });

    it('should include mountain biking sport id (57)', () => {
      expect(WHOOP_CYCLING_SPORT_IDS).toContain(57);
    });

    it('should be a readonly array with 2 entries', () => {
      expect(Array.isArray(WHOOP_CYCLING_SPORT_IDS)).toBe(true);
      expect(WHOOP_CYCLING_SPORT_IDS.length).toBe(2);
    });
  });

  describe('WHOOP_CYCLING_SPORT_NAMES', () => {
    it('should include cycling-related sport names', () => {
      expect(WHOOP_CYCLING_SPORT_NAMES).toContain('cycling');
      expect(WHOOP_CYCLING_SPORT_NAMES).toContain('mountain biking');
      expect(WHOOP_CYCLING_SPORT_NAMES).toContain('mtb');
      expect(WHOOP_CYCLING_SPORT_NAMES).toContain('gravel');
    });
  });

  describe('WHOOP_API_BASE', () => {
    it('should be the correct API v2 base URL', () => {
      expect(WHOOP_API_BASE).toBe('https://api.prod.whoop.com/developer/v2');
    });
  });

  describe('WHOOP_AUTH_URL', () => {
    it('should be the correct OAuth authorization URL', () => {
      expect(WHOOP_AUTH_URL).toBe('https://api.prod.whoop.com/oauth/oauth2/auth');
    });
  });

  describe('WHOOP_TOKEN_URL', () => {
    it('should be the correct OAuth token URL', () => {
      expect(WHOOP_TOKEN_URL).toBe('https://api.prod.whoop.com/oauth/oauth2/token');
    });
  });

  describe('WhoopWorkout type', () => {
    it('should allow valid workout objects with v2 UUID id', () => {
      const workout: WhoopWorkout = {
        id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        activity_v1_id: 12345,
        user_id: 67890,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:30:00Z',
        start: '2024-01-15T10:00:00Z',
        end: '2024-01-15T11:00:00Z',
        timezone_offset: '-05:00',
        sport_id: 1,
        sport_name: 'Cycling',
        score_state: 'SCORED',
        score: {
          strain: 12.5,
          average_heart_rate: 145,
          max_heart_rate: 175,
          kilojoule: 800,
          percent_recorded: 98,
          distance_meter: 25000,
          altitude_gain_meter: 300,
        },
      };

      expect(workout.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(workout.activity_v1_id).toBe(12345);
      expect(workout.sport_id).toBe(1);
      expect(workout.sport_name).toBe('Cycling');
      expect(workout.score_state).toBe('SCORED');
      expect(workout.score?.distance_meter).toBe(25000);
    });

    it('should allow workout without score (UNSCORABLE)', () => {
      const workout: WhoopWorkout = {
        id: 'b2c3d4e5-f6a7-8901-bcde-f23456789012',
        user_id: 67890,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:30:00Z',
        start: '2024-01-15T10:00:00Z',
        end: '2024-01-15T10:30:00Z',
        timezone_offset: '-05:00',
        sport_id: 1,
        score_state: 'UNSCORABLE',
      };

      expect(workout.score).toBeUndefined();
      expect(workout.score_state).toBe('UNSCORABLE');
    });

    it('should allow PENDING_SCORE state', () => {
      const workout: WhoopWorkout = {
        id: 'c3d4e5f6-a7b8-9012-cdef-345678901234',
        user_id: 67890,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:30:00Z',
        start: '2024-01-15T10:00:00Z',
        end: '2024-01-15T10:30:00Z',
        timezone_offset: '-05:00',
        sport_id: 1,
        score_state: 'PENDING_SCORE',
      };

      expect(workout.score_state).toBe('PENDING_SCORE');
    });

    it('should allow Mountain Biking workout (sport_id=57)', () => {
      const workout: WhoopWorkout = {
        id: 'd4e5f6a7-b8c9-0123-def4-567890123456',
        user_id: 67890,
        created_at: '2024-01-15T10:00:00Z',
        updated_at: '2024-01-15T10:30:00Z',
        start: '2024-01-15T10:00:00Z',
        end: '2024-01-15T11:30:00Z',
        timezone_offset: '-05:00',
        sport_id: 57,
        sport_name: 'Mountain Biking',
        score_state: 'SCORED',
      };

      expect(workout.sport_id).toBe(57);
      expect(workout.sport_name).toBe('Mountain Biking');
    });
  });

  describe('WhoopWorkoutScore type', () => {
    it('should allow valid score objects', () => {
      const score: WhoopWorkoutScore = {
        strain: 15.5,
        average_heart_rate: 150,
        max_heart_rate: 180,
        kilojoule: 1000,
        percent_recorded: 99,
        distance_meter: 30000,
        altitude_gain_meter: 500,
        altitude_change_meter: 100,
      };

      expect(score.strain).toBe(15.5);
      expect(score.average_heart_rate).toBe(150);
    });

    it('should allow optional fields', () => {
      const score: WhoopWorkoutScore = {
        strain: 10,
        average_heart_rate: 140,
        max_heart_rate: 165,
        kilojoule: 500,
        percent_recorded: 95,
      };

      expect(score.distance_meter).toBeUndefined();
      expect(score.altitude_gain_meter).toBeUndefined();
    });

    it('should allow zone duration', () => {
      const score: WhoopWorkoutScore = {
        strain: 12,
        average_heart_rate: 145,
        max_heart_rate: 170,
        kilojoule: 600,
        percent_recorded: 98,
        zone_duration: {
          zone_zero_milli: 60000,
          zone_one_milli: 120000,
          zone_two_milli: 180000,
          zone_three_milli: 240000,
          zone_four_milli: 300000,
          zone_five_milli: 60000,
        },
      };

      expect(score.zone_duration?.zone_three_milli).toBe(240000);
    });
  });

  describe('WhoopZoneDuration type', () => {
    it('should allow all optional zone fields', () => {
      const zones: WhoopZoneDuration = {};
      expect(zones.zone_zero_milli).toBeUndefined();
    });

    it('should allow partial zone data', () => {
      const zones: WhoopZoneDuration = {
        zone_two_milli: 300000,
        zone_three_milli: 600000,
      };

      expect(zones.zone_two_milli).toBe(300000);
      expect(zones.zone_one_milli).toBeUndefined();
    });
  });

  describe('WhoopUserProfile type', () => {
    it('should allow valid profile objects', () => {
      const profile: WhoopUserProfile = {
        user_id: 12345,
        email: 'test@example.com',
        first_name: 'Test',
        last_name: 'User',
      };

      expect(profile.user_id).toBe(12345);
      expect(profile.email).toBe('test@example.com');
    });
  });

  describe('WhoopPaginatedResponse type', () => {
    it('should allow paginated workout response', () => {
      const response: WhoopPaginatedResponse<WhoopWorkout> = {
        records: [
          {
            id: 'e5f6a7b8-c9d0-1234-ef56-789012345678',
            user_id: 123,
            created_at: '2024-01-15T10:00:00Z',
            updated_at: '2024-01-15T10:30:00Z',
            start: '2024-01-15T10:00:00Z',
            end: '2024-01-15T11:00:00Z',
            timezone_offset: '-05:00',
            sport_id: 1,
            score_state: 'SCORED',
          },
        ],
        next_token: 'next-page-token',
      };

      expect(response.records.length).toBe(1);
      expect(response.next_token).toBe('next-page-token');
    });

    it('should allow response without next_token (last page)', () => {
      const response: WhoopPaginatedResponse<WhoopWorkout> = {
        records: [],
      };

      expect(response.records.length).toBe(0);
      expect(response.next_token).toBeUndefined();
    });
  });

  describe('WhoopTokenResponse type', () => {
    it('should allow valid token response', () => {
      const response: WhoopTokenResponse = {
        access_token: 'access-token-123',
        refresh_token: 'refresh-token-456',
        expires_in: 3600,
        token_type: 'bearer',
        scope: 'read:workout read:profile offline',
      };

      expect(response.access_token).toBe('access-token-123');
      expect(response.expires_in).toBe(3600);
      expect(response.token_type).toBe('bearer');
    });
  });

  describe('isWhoopCyclingWorkout', () => {
    const baseWorkout: WhoopWorkout = {
      id: 'test-uuid-1234',
      user_id: 123,
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:30:00Z',
      start: '2024-01-15T10:00:00Z',
      end: '2024-01-15T11:00:00Z',
      timezone_offset: '-05:00',
      sport_id: 0,
      score_state: 'SCORED',
    };

    it('should return true for Cycling sport_name', () => {
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_name: 'Cycling' })).toBe(true);
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_name: 'cycling' })).toBe(true);
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_name: 'CYCLING' })).toBe(true);
    });

    it('should return true for Mountain Biking sport_name', () => {
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_name: 'Mountain Biking' })).toBe(true);
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_name: 'mountain biking' })).toBe(true);
    });

    it('should return true for other cycling-related sport names', () => {
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_name: 'MTB' })).toBe(true);
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_name: 'Gravel Ride' })).toBe(true);
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_name: 'Bike' })).toBe(true);
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_name: 'bicycle' })).toBe(true);
    });

    it('should return true for sport_id=1 (Cycling) without sport_name', () => {
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_id: 1 })).toBe(true);
    });

    it('should return true for sport_id=57 (Mountain Biking) without sport_name', () => {
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_id: 57 })).toBe(true);
    });

    it('should return false for non-cycling activities', () => {
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_id: 0, sport_name: 'Running' })).toBe(false);
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_id: 42, sport_name: 'Swimming' })).toBe(false);
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_id: 99 })).toBe(false);
    });

    it('should prefer sport_name over sport_id when both present', () => {
      // sport_name indicates cycling even though sport_id doesn't
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_id: 99, sport_name: 'Cycling' })).toBe(true);
      // sport_name indicates non-cycling even though sport_id is cycling
      expect(isWhoopCyclingWorkout({ ...baseWorkout, sport_id: 1, sport_name: 'Running' })).toBe(true);
    });
  });

  describe('getWhoopRideType', () => {
    const baseWorkout: WhoopWorkout = {
      id: 'test-uuid-5678',
      user_id: 123,
      created_at: '2024-01-15T10:00:00Z',
      updated_at: '2024-01-15T10:30:00Z',
      start: '2024-01-15T10:00:00Z',
      end: '2024-01-15T11:00:00Z',
      timezone_offset: '-05:00',
      sport_id: 1,
      score_state: 'SCORED',
    };

    it('should return "Cycling" for sport_id=1', () => {
      expect(getWhoopRideType({ ...baseWorkout, sport_id: 1 })).toBe('Cycling');
    });

    it('should return "Mountain Bike" for sport_id=57', () => {
      expect(getWhoopRideType({ ...baseWorkout, sport_id: 57 })).toBe('Mountain Bike');
    });

    it('should return "Mountain Bike" for sport_name containing "mountain"', () => {
      expect(getWhoopRideType({ ...baseWorkout, sport_name: 'Mountain Biking' })).toBe('Mountain Bike');
      expect(getWhoopRideType({ ...baseWorkout, sport_name: 'mountain bike' })).toBe('Mountain Bike');
    });

    it('should return "Cycling" for regular cycling sport_name', () => {
      expect(getWhoopRideType({ ...baseWorkout, sport_name: 'Cycling' })).toBe('Cycling');
      expect(getWhoopRideType({ ...baseWorkout, sport_name: 'Gravel' })).toBe('Cycling');
    });

    it('should return "Cycling" for unknown sport IDs', () => {
      expect(getWhoopRideType({ ...baseWorkout, sport_id: 99 })).toBe('Cycling');
    });
  });
});
