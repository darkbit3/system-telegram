const assert = require('assert');
const { buildMiniAppLaunchUrl } = require('../src/utils/miniAppLaunch');

const url = buildMiniAppLaunchUrl({
  baseUrl: 'https://game.example/app',
  gameToken: 'game-token-123',
  launchToken: 'opaque-launch-payload',
});

assert.ok(url, 'expected a launch URL to be built');
assert.match(url, /token=game-token-123/);
assert.match(url, /launch=opaque-launch-payload/);
console.log('mini app launch URL test passed');
