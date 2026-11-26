'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/app');
const { createAirQualityClient } = require('../src/airQuality');

const AIR = { aqi: 312, pm25: 180, pm10: 250, no2: 60, o3: 10, co: 900, time: '2026-11-26T08:00', hourly: [{ time: '2026-11-26T09:00', aqi: 300 }] };
const silent = { error() {}, warn() {}, log() {} };

async function withServer(opts, fn) {
  const app = createApp({ logger: silent, apiKey: '', ...opts });
  const server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.close(); }
}

const fakeAir = (overrides = {}) => ({
  getAirQuality: async () => AIR,
  geocode: async (q) => [{ name: `${q}, India`, lat: 28.6, lon: 77.2 }],
  ...overrides,
});

const post = (base, body, raw) => fetch(`${base}/api/advice`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: raw ?? JSON.stringify(body),
});

test('GET /api/health reports status and AI availability', async () => {
  await withServer({ airClient: fakeAir() }, async (base) => {
    const res = await fetch(`${base}/api/health`);
    assert.deepEqual(await res.json(), { status: 'ok', ai: false });
  });
});

test('security headers are set and x-powered-by is hidden', async () => {
  await withServer({ airClient: fakeAir() }, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

test('POST /api/advice falls back to the rule engine without a key', async () => {
  await withServer({ airClient: fakeAir() }, async (base) => {
    const res = await post(base, { lat: 28.6, lon: 77.2, household: ['children'] });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.air.aqi, 312);
    assert.equal(data.advice.source, 'rules');
    assert.equal(data.advice.category.level, 'hazardous');
  });
});

test('POST /api/advice uses Gemini when configured', async () => {
  const generateAdvice = async () => ({ summary: 'AI', routines: [{ title: 't', detail: 'd', impact: 'i' }], indoor: [], sustainable: [] });
  await withServer({ airClient: fakeAir(), apiKey: 'k', generateAdvice }, async (base) => {
    const data = await (await post(base, { lat: 1, lon: 1 })).json();
    assert.equal(data.advice.source, 'gemini');
    assert.equal(data.advice.summary, 'AI');
    assert.equal(data.advice.category.level, 'hazardous');
  });
});

test('POST /api/advice degrades gracefully when Gemini fails', async () => {
  const generateAdvice = async () => { throw new Error('boom'); };
  await withServer({ airClient: fakeAir(), apiKey: 'k', generateAdvice }, async (base) => {
    const data = await (await post(base, { lat: 1, lon: 1 })).json();
    assert.equal(data.advice.source, 'rules');
  });
});

test('POST /api/advice validates input and handles bad JSON', async () => {
  await withServer({ airClient: fakeAir() }, async (base) => {
    assert.equal((await post(base, { lat: 999, lon: 0 })).status, 400);
    assert.equal((await post(base, null, '{bad')).status, 400);
    assert.equal((await post(base, null, JSON.stringify({ lat: 1, lon: 1, pad: 'x'.repeat(20000) }))).status, 413);
  });
});

test('POST /api/advice returns 502 when the air quality provider fails', async () => {
  const airClient = fakeAir({ getAirQuality: async () => { throw new Error('down'); } });
  await withServer({ airClient }, async (base) => {
    const res = await post(base, { lat: 1, lon: 1 });
    assert.equal(res.status, 502);
    assert.doesNotMatch((await res.json()).error, /down/, 'internal errors are not leaked');
  });
});

test('GET /api/geocode validates and returns results', async () => {
  await withServer({ airClient: fakeAir() }, async (base) => {
    assert.equal((await fetch(`${base}/api/geocode?q=a`)).status, 400);
    const data = await (await fetch(`${base}/api/geocode?q=Delhi`)).json();
    assert.equal(data.results[0].name, 'Delhi, India');
  });
});

test('unknown API routes return JSON 404', async () => {
  await withServer({ airClient: fakeAir() }, async (base) => {
    const res = await fetch(`${base}/api/nope`);
    assert.equal(res.status, 404);
  });
});

test('rate limiter returns 429 after the limit', async () => {
  await withServer({ airClient: fakeAir(), rateLimitPerMin: 2 }, async (base) => {
    await fetch(`${base}/api/health`);
    await fetch(`${base}/api/health`);
    assert.equal((await fetch(`${base}/api/health`)).status, 429);
  });
});

test('air quality client rounds coordinates, parses data and caches results', async () => {
  let calls = 0;
  let lastUrl = '';
  const fetchImpl = async (url) => {
    calls += 1;
    lastUrl = url;
    return {
      ok: true,
      json: async () => ({
        current: { us_aqi: 150, pm2_5: 55.5, pm10: 80, nitrogen_dioxide: 30, ozone: 20, carbon_monoxide: 400, time: 't' },
        hourly: { time: ['a', 'b'], us_aqi: [140, null] },
      }),
    };
  };
  const client = createAirQualityClient({ fetchImpl });
  const r = await client.getAirQuality(28.61394, 77.20902);
  assert.equal(r.aqi, 150);
  assert.equal(r.hourly.length, 1, 'null forecast values are dropped');
  assert.match(lastUrl, /latitude=28\.61&longitude=77\.21/);
  await client.getAirQuality(28.6139, 77.2091);
  assert.equal(calls, 1, 'second call served from cache');
});

test('geocode formats place names and caches case-insensitively', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: true,
      json: async () => ({ results: [{ name: 'Delhi', admin1: 'NCT', country: 'India', latitude: 28.6, longitude: 77.2 }] }),
    };
  };
  const client = createAirQualityClient({ fetchImpl });
  const r = await client.geocode('Delhi');
  assert.deepEqual(r, [{ name: 'Delhi, NCT, India', lat: 28.6, lon: 77.2 }]);
  await client.geocode('DELHI');
  assert.equal(calls, 1);
  const none = createAirQualityClient({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }) });
  assert.deepEqual(await none.geocode('Nowhere'), []);
});

test('geocode returns 502 when the provider fails', async () => {
  const airClient = fakeAir({ geocode: async () => { throw new Error('down'); } });
  await withServer({ airClient }, async (base) => {
    assert.equal((await fetch(`${base}/api/geocode?q=Delhi`)).status, 502);
  });
});

test('air quality client surfaces upstream errors', async () => {
  const client = createAirQualityClient({ fetchImpl: async () => ({ ok: false, status: 500 }) });
  await assert.rejects(client.getAirQuality(0, 0), /500/);
  const empty = createAirQualityClient({ fetchImpl: async () => ({ ok: true, json: async () => ({ current: {} }) }) });
  await assert.rejects(empty.getAirQuality(0, 0), /unavailable/);
});
