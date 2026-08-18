// Runs before every test file, before that file's imports are evaluated.
//
// Pins NODE_ENV so the suite cannot inherit it from the surrounding
// environment. Two things set it out from under us otherwise:
//
//   1. Nx auto-loads apps/api/.env into a task's environment, and a working
//      dev .env carries NODE_ENV=production. So `nx test api` ran the whole
//      suite in production mode while a bare `npx jest` ran it in test mode,
//      and the two disagreed about which branches execute. That is how
//      admin.validation.test.ts came to fail only under Nx: the unified-send
//      handler bails out with "Server configuration error" when NODE_ENV is
//      production and any configured URL still points at localhost, so it
//      never reached the subject validation the test was asserting on.
//
//   2. Jest workers run several test files per process and process.env is
//      shared between them, so a test file that assigns NODE_ENV without
//      restoring it leaks into whatever runs next in that worker. Assigning
//      here rather than only in a global setup is what contains that.
//
// A test that genuinely needs another value still sets its own (see
// auth.whoop.test.ts, which asks for 'development'); this only decides where
// every file starts.
process.env.NODE_ENV = 'test';
