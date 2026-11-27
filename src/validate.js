'use strict';

const { config } = require('./config');

const { cityMaxLength, cityMinLength, commuteKmMax } = config.limits;
const LAT_MAX = 90;
const LON_MAX = 180;

const HOUSEHOLD = ['children', 'elderly', 'asthma', 'heart', 'pregnant', 'adults'];
const MODES = ['car', 'bus', 'metro', 'cycle', 'walk', 'wfh'];
const TEXT_RE = /[^\p{L}\p{N} ,.'-]/gu;

/** Strip everything except letters, digits and basic punctuation. */
function cleanText(s, max = cityMaxLength) {
  return typeof s === 'string' ? s.replace(TEXT_RE, '').trim().slice(0, max) : '';
}

/**
 * Parse a coordinate that must lie within [-limit, limit].
 * @param {unknown} raw
 * @param {number} limit
 * @returns {number|null} the number, or null when missing or out of range
 */
function toNumberInRange(raw, limit) {
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : null;
}

/**
 * Validate and normalise the advice request body. Every field is whitelisted,
 * so nothing unexpected reaches the LLM prompt (prompt-injection hardening).
 * @returns {{ok:true,value:object}|{ok:false,error:string}}
 */
function validateAdviceRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Body must be a JSON object' };
  }
  const lat = toNumberInRange(body.lat, LAT_MAX);
  if (lat === null) return { ok: false, error: `lat must be between -${LAT_MAX} and ${LAT_MAX}` };
  const lon = toNumberInRange(body.lon, LON_MAX);
  if (lon === null) return { ok: false, error: `lon must be between -${LON_MAX} and ${LON_MAX}` };

  const commuteKm = parseCommuteKm(body.commuteKm);
  if (commuteKm === null) return { ok: false, error: `commuteKm must be between 0 and ${commuteKmMax}` };

  return {
    ok: true,
    value: {
      lat,
      lon,
      city: cleanText(body.city),
      household: parseHousehold(body.household),
      commuteMode: MODES.includes(body.commuteMode) ? body.commuteMode : 'wfh',
      commuteKm,
      hasPurifier: body.hasPurifier === true,
    },
  };
}

/**
 * Keep only known household groups, without duplicates.
 * @param {unknown} raw
 * @returns {string[]}
 */
function parseHousehold(raw) {
  return Array.isArray(raw) ? [...new Set(raw.filter((h) => HOUSEHOLD.includes(h)))] : [];
}

/**
 * Parse the one-way commute distance, rounded to 0.1 km.
 * @param {unknown} raw
 * @returns {number|null} null when out of range
 */
function parseCommuteKm(raw) {
  const km = Number(raw ?? 0);
  if (!Number.isFinite(km) || km < 0 || km > commuteKmMax) return null;
  return Math.round(km * 10) / 10;
}

/** @returns {string|null} a cleaned query, or null if it is too short */
function validateCityQuery(q) {
  const clean = cleanText(q);
  return clean.length >= cityMinLength ? clean : null;
}

module.exports = { validateAdviceRequest, validateCityQuery, HOUSEHOLD, MODES };
