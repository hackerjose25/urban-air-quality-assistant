'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseModelJson, generateAdvice, buildPrompt } = require('../src/gemini');
const { ruleBasedAdvice } = require('../src/aqi');

const good = {
  summary: 'Very poor air today.',
  routines: [{ title: 'Stay in', detail: 'd', impact: 'i' }],
  indoor: [{ title: 'Purifier', detail: 'd', impact: 'i' }],
  sustainable: [],
};

test('parseModelJson accepts plain and fenced JSON', () => {
  assert.equal(parseModelJson(JSON.stringify(good)).summary, good.summary);
  assert.equal(parseModelJson('```json\n' + JSON.stringify(good) + '\n```').routines.length, 1);
});

test('parseModelJson drops malformed items and clips long text', () => {
  const out = parseModelJson(JSON.stringify({
    ...good,
    routines: [null, { title: 5 }, { title: 'x'.repeat(500), detail: 'd', impact: 'i' }],
  }));
  assert.equal(out.routines.length, 1);
  assert.equal(out.routines[0].title.length, 120);
});

test('parseModelJson rejects incomplete or invalid output', () => {
  assert.throws(() => parseModelJson('not json'));
  assert.throws(() => parseModelJson(JSON.stringify({ summary: '', routines: [] })));
});

test('buildPrompt only includes whitelisted fields', () => {
  const air = { aqi: 200, pm25: 100, hourly: [{ time: 't', aqi: 190 }] };
  const profile = { lat: 1, lon: 2, city: 'X', household: [], commuteMode: 'wfh', commuteKm: 0, hasPurifier: false, secret: 'nope' };
  const p = JSON.parse(buildPrompt(air, profile, ruleBasedAdvice(air, profile)));
  assert.deepEqual(p.air.next24hAqi, [190]);
  assert.ok(!JSON.stringify(p).includes('nope'));
});

test('generateAdvice sends the key as a header (not in the URL) and parses the response', async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, opts };
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(good) }] } }] }),
    };
  };
  const air = { aqi: 312, pm25: 180, hourly: [] };
  const profile = { lat: 28.6, lon: 77.2, city: 'Delhi', household: [], commuteMode: 'wfh', commuteKm: 0, hasPurifier: false };
  const out = await generateAdvice(air, profile, ruleBasedAdvice(air, profile), { apiKey: 'k', fetchImpl });
  assert.equal(out.summary, good.summary);
  assert.equal(captured.opts.headers['x-goog-api-key'], 'k');
  assert.ok(!captured.url.includes('k='));
});

test('generateAdvice throws on HTTP errors', async () => {
  const fetchImpl = async () => ({ ok: false, status: 429 });
  await assert.rejects(
    generateAdvice({ aqi: 1, hourly: [] }, { lat: 0, lon: 0 }, { routines: [], indoor: [], sustainable: [] }, { apiKey: 'k', fetchImpl }),
    /429/,
  );
});
