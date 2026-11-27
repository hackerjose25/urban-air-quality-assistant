'use strict';

const { TtlCache } = require('./cache');
const { config } = require('./config');

const AQ_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';

/**
 * GET a JSON document with a timeout.
 * @param {string} url
 * @param {typeof fetch} fetchImpl
 * @param {number} [timeoutMs]
 * @throws {Error} on non-2xx responses or timeout
 */
async function fetchJson(url, fetchImpl, timeoutMs = config.upstream.timeoutMs) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`Upstream error ${res.status}`);
  return res.json();
}

/** Round a coordinate to 2 decimals (about 1 km), for privacy and cache hits. */
const roundCoord = (value) => value.toFixed(2);

/**
 * Convert an Open-Meteo air-quality response into the app's reading shape.
 * @param {object} data raw API response
 * @returns {object} normalised reading
 * @throws {Error} when the response has no current AQI
 */
function normalizeAirQuality(data) {
  const current = data.current || {};
  if (typeof current.us_aqi !== 'number') throw new Error('Air quality data unavailable for this location');
  const times = data.hourly?.time || [];
  const values = data.hourly?.us_aqi || [];
  return {
    aqi: current.us_aqi,
    pm25: current.pm2_5,
    pm10: current.pm10,
    no2: current.nitrogen_dioxide,
    o3: current.ozone,
    co: current.carbon_monoxide,
    time: current.time,
    hourly: times.map((time, i) => ({ time, aqi: values[i] })).filter((h) => typeof h.aqi === 'number'),
  };
}

/**
 * Build Open-Meteo clients (free, no API key) with their own cache.
 * @param {{fetchImpl?: typeof fetch, cache?: TtlCache}} [opts]
 */
function createAirQualityClient({ fetchImpl = fetch, cache = new TtlCache() } = {}) {
  /**
   * Current air quality plus the next 24 hours of AQI forecast.
   * Coordinates are rounded to about 1 km, for privacy and better cache hits.
   */
  async function getAirQuality(lat, lon) {
    const latitude = roundCoord(lat);
    const longitude = roundCoord(lon);
    const key = `aq:${latitude},${longitude}`;
    const cached = cache.get(key);
    if (cached) return cached;

    const params = new URLSearchParams({
      latitude,
      longitude,
      current: 'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide',
      hourly: 'us_aqi',
      forecast_hours: String(config.upstream.forecastHours),
      timezone: 'auto',
    });
    const result = normalizeAirQuality(await fetchJson(`${AQ_URL}?${params}`, fetchImpl));
    cache.set(key, result);
    return result;
  }

  /** Resolve a place name to up to five coordinate matches. */
  async function geocode(name) {
    const key = `geo:${name.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const params = new URLSearchParams({ name, count: String(config.upstream.geocodeResults), language: 'en', format: 'json' });
    const data = await fetchJson(`${GEO_URL}?${params}`, fetchImpl);
    const results = (data.results || []).map((r) => ({
      name: [r.name, r.admin1, r.country].filter(Boolean).join(', '),
      lat: r.latitude,
      lon: r.longitude,
    }));
    cache.set(key, results);
    return results;
  }

  return { getAirQuality, geocode };
}

module.exports = { createAirQualityClient, normalizeAirQuality };
