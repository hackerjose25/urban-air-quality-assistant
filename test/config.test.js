'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { config } = require('../src/config');
const { normalizeAirQuality } = require('../src/airQuality');

test('config is deeply frozen so limits cannot be changed at runtime', () => {
  assert.ok(Object.isFrozen(config));
  for (const section of Object.values(config)) assert.ok(Object.isFrozen(section));
});

test('config limits are sane', () => {
  assert.ok(config.rateLimit.perWindow > 0);
  assert.ok(config.gemini.timeoutMs > config.upstream.timeoutMs);
  assert.ok(config.limits.cityMinLength < config.limits.cityMaxLength);
});

test('normalizeAirQuality maps Open-Meteo fields and drops missing hours', () => {
  const reading = normalizeAirQuality({
    current: { us_aqi: 180, pm2_5: 90, pm10: 120, nitrogen_dioxide: 40, ozone: 10, carbon_monoxide: 300, time: 't0' },
    hourly: { time: ['t1', 't2', 't3'], us_aqi: [170, null, 150] },
  });
  assert.equal(reading.aqi, 180);
  assert.equal(reading.pm25, 90);
  assert.equal(reading.o3, 10);
  assert.deepEqual(reading.hourly, [{ time: 't1', aqi: 170 }, { time: 't3', aqi: 150 }]);
});

test('normalizeAirQuality rejects responses without a current AQI', () => {
  assert.throws(() => normalizeAirQuality({}), /unavailable/);
  assert.throws(() => normalizeAirQuality({ current: { us_aqi: 'bad' } }), /unavailable/);
});

test('normalizeAirQuality tolerates a missing hourly block', () => {
  assert.deepEqual(normalizeAirQuality({ current: { us_aqi: 10 } }).hourly, []);
});
