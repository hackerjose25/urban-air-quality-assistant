'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { categorize, commuteImpact, indoorPm25, ruleBasedAdvice } = require('../src/aqi');

test('categorize maps AQI band boundaries correctly', () => {
  assert.equal(categorize(0).level, 'good');
  assert.equal(categorize(50).level, 'good');
  assert.equal(categorize(51).level, 'moderate');
  assert.equal(categorize(150).level, 'sensitive');
  assert.equal(categorize(200).level, 'unhealthy');
  assert.equal(categorize(312).level, 'hazardous');
  assert.equal(categorize(250).label, 'Very Unhealthy');
});

test('categorize rejects invalid input', () => {
  for (const bad of [-1, NaN, Infinity, '100', null]) {
    assert.throws(() => categorize(bad), TypeError);
  }
});

test('commuteImpact computes weekly and yearly CO2 savings', () => {
  const r = commuteImpact(10, 'metro');
  assert.equal(r.weeklyKm, 100);
  assert.equal(r.co2SavedKgPerWeek, 14); // (0.17 - 0.03) * 100
  assert.equal(r.co2SavedKgPerYear, 728);
  assert.equal(commuteImpact(5, 'cycle').co2SavedKgPerWeek, 8.5);
});

test('commuteImpact validates input', () => {
  assert.throws(() => commuteImpact(-1, 'walk'), RangeError);
  assert.throws(() => commuteImpact(5, 'rocket'), RangeError);
  assert.throws(() => commuteImpact(5, 'walk', 8), RangeError);
});

test('indoorPm25 applies multiplicative reductions', () => {
  assert.equal(indoorPm25(100), 80);
  assert.equal(indoorPm25(100, { hepa: true }), 40);
  assert.equal(indoorPm25(100, { hepa: true, sealing: true }), 32);
  assert.throws(() => indoorPm25(-5), RangeError);
});

test('ruleBasedAdvice recommends N95 and indoor activity on very polluted days', () => {
  const a = ruleBasedAdvice({ aqi: 312, pm25: 180 }, { household: ['children'] });
  assert.equal(a.source, 'rules');
  assert.match(a.summary, /Hazardous/);
  assert.match(a.summary, /children/);
  assert.ok(a.routines.some((r) => /N95/.test(r.title)));
  assert.ok(a.indoor.some((r) => /µg\/m³/.test(r.impact)), 'quantifies indoor PM reduction');
  for (const list of [a.routines, a.indoor, a.sustainable]) {
    for (const i of list) assert.ok(i.title && i.detail && i.impact, 'every item explains its impact');
  }
});

test('ruleBasedAdvice treats sensitive households with extra caution at moderate-high AQI', () => {
  const withKids = ruleBasedAdvice({ aqi: 120 }, { household: ['asthma'] });
  const without = ruleBasedAdvice({ aqi: 120 }, { household: [] });
  assert.ok(withKids.routines.some((r) => /N95/.test(r.title)));
  assert.ok(!without.routines.some((r) => /N95/.test(r.title)));
});

test('ruleBasedAdvice suggests ventilation on clean days', () => {
  const a = ruleBasedAdvice({ aqi: 30 }, {});
  assert.match(a.routines[0].title, /Good time/);
  assert.match(a.indoor[0].title, /Air out/);
});

test('ruleBasedAdvice quantifies car commute alternatives', () => {
  const short = ruleBasedAdvice({ aqi: 80 }, { commuteMode: 'car', commuteKm: 2 });
  assert.match(short.sustainable[0].title, /walking/);
  const long = ruleBasedAdvice({ aqi: 80 }, { commuteMode: 'car', commuteKm: 15 });
  assert.match(long.sustainable[0].title, /public transport/);
  assert.match(long.sustainable[0].impact, /kg CO₂/);
  const severe = ruleBasedAdvice({ aqi: 250 }, { commuteMode: 'car', commuteKm: 5 });
  assert.match(severe.sustainable[0].detail, /too polluted/);
});
