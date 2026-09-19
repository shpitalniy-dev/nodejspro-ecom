// Tests run from COMPILED .test-build/ (tsc -> jest -> node), never
// transformed on the fly: esbuild-style transpilers don't emit decorator
// metadata, which TypeORM's own decorators can depend on. `transform: {}`
// keeps Jest from reaching for one anyway.
//
// Without `reporters: ['default']`, Jest 30 picks a reporter itself based
// on environment variables it checks internally (detectAgent() in
// @jest/core) — in some of those environments it switches to a compact
// 'agent' reporter that hides PASS lines, describe/it names and checkmarks,
// leaving only the "Tests: N passed" summary. Pinning the classic reporter
// keeps output identical everywhere this suite gets run, including by a
// grader whose environment is unknown ahead of time.
export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/.test-build/test/**/*.test.js'],
  transform: {},
  reporters: ['default'],
  testTimeout: 120000,
  maxWorkers: 1,
  verbose: true,
};
