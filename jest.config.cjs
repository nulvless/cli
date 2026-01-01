/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  restoreMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/tests/**', '!src/index.ts'],
}
