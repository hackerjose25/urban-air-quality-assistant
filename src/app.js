'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { validateAdviceRequest, validateCityQuery } = require('./validate');
const { ruleBasedAdvice, categorize } = require('./aqi');
const { createAirQualityClient } = require('./airQuality');
const gemini = require('./gemini');

/**
 * App factory. Dependencies can be injected, so tests run without network access.
 */
function createApp({
  airClient = createAirQualityClient(),
  generateAdvice = gemini.generateAdvice,
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL,
  rateLimitPerMin = 30,
  logger = console,
} = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }));
  app.use(express.json({ limit: '10kb' }));
  app.use('/api/', rateLimit({
    windowMs: 60_000,
    limit: rateLimitPerMin,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests, please slow down' },
  }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok', ai: Boolean(apiKey) }));

  app.get('/api/geocode', async (req, res) => {
    const q = validateCityQuery(req.query.q);
    if (!q) return res.status(400).json({ error: 'Query must be at least 2 characters' });
    try {
      return res.json({ results: await airClient.geocode(q) });
    } catch (err) {
      logger.error('geocode failed:', err.message);
      return res.status(502).json({ error: 'Location lookup failed' });
    }
  });

  app.post('/api/advice', async (req, res) => {
    const v = validateAdviceRequest(req.body);
    if (!v.ok) return res.status(400).json({ error: v.error });
    const profile = v.value;

    let air;
    try {
      air = await airClient.getAirQuality(profile.lat, profile.lon);
    } catch (err) {
      logger.error('air quality failed:', err.message);
      return res.status(502).json({ error: 'Could not fetch air quality for this location' });
    }

    const baseline = ruleBasedAdvice(air, profile);
    let advice = baseline;
    if (apiKey) {
      try {
        const ai = await generateAdvice(air, profile, baseline, { apiKey, model });
        advice = { ...ai, category: categorize(air.aqi), source: 'gemini' };
      } catch (err) {
        logger.warn('Gemini failed, using rule engine:', err.message);
      }
    }
    return res.json({ air, advice });
  });

  app.use('/api/', (_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Payload too large' });
    logger.error(err);
    return res.status(500).json({ error: 'Internal error' });
  });

  return app;
}

module.exports = { createApp };
