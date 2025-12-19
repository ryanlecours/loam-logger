// Cypress E2E support file

// Helper function to generate unique email
export function generateUniqueEmail() {
  return `test-${Date.now()}@loamlogger.test`;
}

// Helper function to get test data
export function getTestData() {
  return {
    email: generateUniqueEmail(),
    password: 'TestPassword123!',
    name: 'Test User',
    age: '28',
    location: 'Bellingham, WA',
    bike: {
      year: '2024',
      make: 'Propain',
      model: 'Tyee',
      fork: 'RockShox Zeb Ultimate',
      rearShock: 'Rockshox Vivid Ultimate',
      wheels: 'Project 321 NOBL',
      dropperPost: 'Yoke 200mm',
    },
    ride: {
      name: 'Test Ride',
      type: 'Enduro',
      trail: 'Local Trail',
      distance: '12.5',
      elevation: '2500',
      duration: '2:30',
    },
    newBike: {
      year: '2023',
      make: 'Trek',
      model: 'Slash',
      fork: 'RockShox Zeb Select',
      rearShock: 'Fox Float X',
      wheels: 'NOBL Project 321',
      dropperPost: 'PNW Loam',
    },
  };
}
