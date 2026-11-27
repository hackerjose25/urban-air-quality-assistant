'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { validateAdviceRequest, validateCityQuery } = require('./validate');
const { ruleBasedAdvice, categorize } = require('./aqi');
const { createAirQualityClient } = require('./airQuality');
const gemini = require('./gemini');
const { config } = require('./config');

const HTTP = Object.freeze({
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
  BAD_GATEWAY: 502,
});

/** Content Security Policy: same-origin only, no inline scripts, no framing. */
const CSP_DIRECTIVES = Object.freeze({
  defaultSrc: ["'self'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
});

/**
 * Register security headers, the JSON body limit and API rate limiting.
 * @param {import('express').Express} app
 * @param {number} rateLimitPerMin
 */
function applySecurityMiddleware(app, rateLimitPerMin) {
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: { directives: CSP_DIRECTIVES } }));
  app.use(express.json({ limit: config.server.bodyLimit }));
  app.use('/api/', rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: rateLimitPerMin,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down' },
  }));
}

/**
 * GET /api/geocode?q=… : resolve a place name to coordinates.
 * @param {{airClient: object, logger: Console}} deps
 */
function createGeocodeHandler({ airClient, logger }) {
  return async (req, res) => {
    const query = validateCityQuery(req.query.q);
    if (!query) {
      return res.status(HTTP.BAD_REQUEST).json({ error: 'Query must be at least 2 characters' });
    }
    try {
      return res.json({ results: await airClient.geocode(query) });
    } catch (err) {
      logger.error('geocode failed:', err.message);
      return res.status(HTTP.BAD_GATEWAY).json({ error: 'Location lookup failed' });
    }
  };
}

/**
 * Personalise the rule-based baseline with Gemini. Falls back to the
 * baseline when no API key is configured or the model call fails.
 * @returns {Promise<object>} the advice to send to the client
 */
async function personaliseAdvice(air, profile, baseline, { generateAdvice, apiKey, model, logger }) {
  if (!apiKey) return baseline;
  try {
    const ai = await generateAdvice(air, profile, baseline, { apiKey, model });
    return { ...ai, category: categorize(air.aqi), source: 'gemini' };
  } catch (err) {
    logger.warn('Gemini failed, using rule engine:', err.message);
    return baseline;
  }
}

/**
 * POST /api/advice : live air data plus a personalised plan.
 * @param {{airClient: object, generateAdvice: Function, apiKey?: string, model?: string, logger: Console}} deps
 */
function createAdviceHandler(deps) {
  return async (req, res) => {
    const validation = validateAdviceRequest(req.body);
    if (!validation.ok) return res.status(HTTP.BAD_REQUEST).json({ error: validation.error });
    const profile = validation.value;

    let air;
    try {
      air = await deps.airClient.getAirQuality(profile.lat, profile.lon);
    } catch (err) {
      deps.logger.error('air quality failed:', err.message);
      return res.status(HTTP.BAD_GATEWAY).json({ error: 'Could not fetch air quality for this location' });
    }

    const baseline = ruleBasedAdvice(air, profile);
    const advice = await personaliseAdvice(air, profile, baseline, deps);
    return res.json({ air, advice });
  };
}

/**
 * Final error handler: maps body-parser errors to 4xx and hides internals.
 * @param {Console} logger
 */
function createErrorHandler(logger) {
  return (err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(HTTP.BAD_REQUEST).json({ error: 'Invalid JSON' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(HTTP.PAYLOAD_TOO_LARGE).json({ error: 'Payload too large' });
    }
    logger.error(err);
    return res.status(HTTP.INTERNAL_ERROR).json({ error: 'Internal error' });
  };
}

/**
 * App factory. Dependencies can be injected, so tests run without network access.
 * @param {object} [options]
 * @param {object} [options.airClient] Open-Meteo client (see airQuality.js)
 * @param {Function} [options.generateAdvice] LLM advice generator (see gemini.js)
 * @param {string} [options.apiKey] Gemini API key; when empty, only the rule engine is used
 * @param {string} [options.model] Gemini model name
 * @param {number} [options.rateLimitPerMin] requests per minute per IP on /api
 * @param {Console} [options.logger]
 * @returns {import('express').Express}
 */
function createApp({
  airClient = createAirQualityClient(),
  generateAdvice = gemini.generateAdvice,
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL,
  rateLimitPerMin = config.rateLimit.perWindow,
  logger = console,
} = {}) {
  const app = express();
  applySecurityMiddleware(app, rateLimitPerMin);

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', ai: Boolean(apiKey) }));
  app.get('/api/geocode', createGeocodeHandler({ airClient, logger }));
  app.post('/api/advice', createAdviceHandler({ airClient, generateAdvice, apiKey, model, logger }));
  app.use('/api/', (_req, res) => res.status(HTTP.NOT_FOUND).json({ error: 'Not found' }));

  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: config.server.staticMaxAge }));
  app.use(createErrorHandler(logger));
  return app;
}

module.exports = { createApp };
