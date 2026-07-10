// Jest config for an ESM ("type": "module") Node project.
// Tests run with NODE_OPTIONS=--experimental-vm-modules (set in the npm script),
// so no Babel transform is needed — Node executes the ES modules natively.
export default {
  testEnvironment: "node",
  transform: {}, // disable transforms; run native ESM
  testMatch: ["**/tests/**/*.test.js"],
  // Keep noisy console.error (fail-open logs, etc.) out of the test report.
  silent: false,
};
