// JavaScript: CommonJS-era config.
const someName = 'NOT_DETECTED';

module.exports = {
  secret: process.env.SESSION_SECRET,
  nodeOptions: process.env.NODE_OPTIONS,
  dynamic: process.env[someName], // dynamic keys are intentionally not reported
};
