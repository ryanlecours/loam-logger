export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  // Pins NODE_ENV before each test file's imports run, so the suite does not
  // inherit it from Nx's .env loading or from a previous file in the same
  // worker. See jest.setup.ts.
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testPathIgnorePatterns: ['/node_modules/', 'src/routes/garmin.test.ts'],
  moduleNameMapper: {
    '^@loam/shared$': '<rootDir>/../../libs/shared/src/index.ts',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          module: 'commonjs',
          moduleResolution: 'node',
          isolatedModules: true,
          baseUrl: '.',
          jsx: 'react-jsx',
          paths: {
            '@loam/shared': ['../../libs/shared/src/index.ts'],
          },
        },
      },
    ],
  },
  transformIgnorePatterns: ['/node_modules/(?!expo-server-sdk)'],
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
};
