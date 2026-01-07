export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
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
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
};
