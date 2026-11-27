'use strict';

/**
 * Central configuration. Every tunable value lives here, so limits and
 * timeouts are documented in one place instead of scattered as magic numbers.
 */
const config = Object.freeze({
  server: Object.freeze({
    defaultPort: 8080,
    bodyLimit: '10kb',
    staticMaxAge: '1h',
  }),
  rateLimit: Object.freeze({
    windowMs: 60_000,
    perWindow: 30,
  }),
  upstream: Object.freeze({
    timeoutMs: 8_000,
    forecastHours: 24,
    geocodeResults: 5,
  }),
  cache: Object.freeze({
    ttlMs: 10 * 60 * 1000,
    maxEntries: 500,
  }),
  gemini: Object.freeze({
    defaultModel: 'gemini-3.5-flash-lite',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
    timeoutMs: 25_000,
    temperature: 0.4,
    maxOutputTokens: 4096,
  }),
  limits: Object.freeze({
    cityMaxLength: 80,
    cityMinLength: 2,
    commuteKmMax: 200,
    adviceItemsMax: 5,
    titleMaxLength: 120,
    fieldMaxLength: 300,
    summaryMaxLength: 400,
  }),
});

module.exports = { config };
