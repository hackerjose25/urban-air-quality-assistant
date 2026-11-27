'use strict';

/**
 * Pure domain logic: AQI categorisation, rule-based advice and impact estimates.
 * No I/O here, so everything is easy to unit-test.
 */

/** US EPA AQI bands. */
const AQI_BANDS = Object.freeze([
  { max: 50, level: 'good', label: 'Good', color: '#2e7d32' },
  { max: 100, level: 'moderate', label: 'Moderate', color: '#8a6d00' },
  { max: 150, level: 'sensitive', label: 'Unhealthy for Sensitive Groups', color: '#b35400' },
  { max: 200, level: 'unhealthy', label: 'Unhealthy', color: '#c62828' },
  { max: 300, level: 'very_unhealthy', label: 'Very Unhealthy', color: '#6a1b9a' },
  { max: Infinity, level: 'hazardous', label: 'Hazardous', color: '#4e0d1c' },
]);

/**
 * @param {number} aqi
 * @returns {{level:string,label:string,color:string}}
 */
function categorize(aqi) {
  if (typeof aqi !== 'number' || !Number.isFinite(aqi) || aqi < 0) {
    throw new TypeError('AQI must be a non-negative finite number');
  }
  const { level, label, color } = AQI_BANDS.find((b) => aqi <= b.max);
  return { level, label, color };
}

const SENSITIVE = new Set(['children', 'elderly', 'asthma', 'heart', 'pregnant']);

/**
 * Conservative reduction factors drawn from published studies:
 * a HEPA purifier sized to the room cuts indoor PM2.5 by about 50%,
 * sealing gaps and keeping windows shut cuts it by about 20%,
 * and a well-fitted N95 filters 90% or more.
 */
const IMPACT = Object.freeze({
  hepa: 0.5,
  sealing: 0.2,
  n95: 0.9,
  carKgPerKm: 0.17, // average petrol car, kg CO2 per km
  busKgPerKm: 0.08,
  metroKgPerKm: 0.03,
});

function round(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Estimate the CO2 saved by switching a car commute to another mode.
 * @param {number} km one-way commute distance
 * @param {'walk'|'cycle'|'bus'|'metro'} mode
 * @param {number} [daysPerWeek=5]
 */
function commuteImpact(km, mode, daysPerWeek = 5) {
  if (!(km >= 0) || !(daysPerWeek >= 0 && daysPerWeek <= 7)) {
    throw new RangeError('Invalid commute parameters');
  }
  const perKm = { walk: 0, cycle: 0, bus: IMPACT.busKgPerKm, metro: IMPACT.metroKgPerKm }[mode];
  if (perKm === undefined) throw new RangeError(`Unknown mode: ${mode}`);
  const weeklyKm = km * 2 * daysPerWeek;
  const savedKgPerWeek = (IMPACT.carKgPerKm - perKm) * weeklyKm;
  return {
    weeklyKm: round(weeklyKm),
    co2SavedKgPerWeek: round(savedKgPerWeek),
    co2SavedKgPerYear: round(savedKgPerWeek * 52),
  };
}

/**
 * Estimated indoor PM2.5 after applying measures (multiplicative reductions).
 * @param {number} outdoorPm25 µg/m³
 * @param {{hepa?:boolean, sealing?:boolean}} measures
 */
function indoorPm25(outdoorPm25, measures = {}) {
  if (!(outdoorPm25 >= 0)) throw new RangeError('PM2.5 must be >= 0');
  let v = outdoorPm25 * 0.8; // baseline infiltration
  if (measures.sealing) v *= 1 - IMPACT.sealing;
  if (measures.hepa) v *= 1 - IMPACT.hepa;
  return round(v);
}

/** Build one advice item. */
const item = (title, detail, impact) => ({ title, detail, impact });

const SEVERE_LEVELS = new Set(['unhealthy', 'very_unhealthy', 'hazardous']);

/** Commute distances (km) up to which walking, then cycling, is suggested. */
const WALK_MAX_KM = 3;
const CYCLE_MAX_KM = 8;
const MODE_LABELS = Object.freeze({ walk: 'walking', cycle: 'cycling', metro: 'public transport' });

/**
 * Derive the risk context shared by every advice section.
 * @param {{aqi:number, pm25?:number}} air
 * @param {{household?:string[]}} profile
 */
function assessRisk(air, profile) {
  const category = categorize(air.aqi);
  const household = (profile.household || []).filter((h) => SENSITIVE.has(h));
  const severe = SEVERE_LEVELS.has(category.level);
  return {
    category,
    household,
    sensitive: household.length > 0,
    severe,
    elevated: severe || category.level === 'sensitive',
    pm25: typeof air.pm25 === 'number' ? air.pm25 : null,
  };
}

/** Low-exposure daily routine suggestions. */
function routineAdvice({ severe, elevated, sensitive }) {
  if (severe || (elevated && sensitive)) {
    return [
      item(
        'Move outdoor activity indoors',
        'Do exercise and play indoors today. If you have to go out, early afternoon is usually best, when winter inversions are weakest.',
        'Lowers the pollution you breathe in; breathing rate during exercise is 3–5 times the resting rate.',
      ),
      item(
        'Wear a well-fitted N95/FFP2 outdoors',
        'Cloth and surgical masks do little against PM2.5.',
        `Filters about ${IMPACT.n95 * 100}% of fine particles when sealed properly.`,
      ),
    ];
  }
  if (elevated) {
    return [item(
      'Keep outdoor exercise light and short',
      'Choose parks away from main roads and avoid rush hours.',
      'PM levels next to a busy road can be twice those one block away.',
    )];
  }
  return [item(
    'Good time for outdoor activities',
    'The air is fairly clean right now, so it is a good moment to air out your home and exercise outside.',
    'Clears out indoor pollutants that build up overnight.',
  )];
}

/** Filtration advice, tailored to whether the household owns a purifier. */
function filtrationItem(hasPurifier, pm25) {
  const impact = pm25 !== null
    ? `Indoor PM2.5 should fall from about ${indoorPm25(pm25)} to about ${indoorPm25(pm25, { hepa: true, sealing: true })} µg/m³ if you also seal gaps.`
    : 'Can roughly halve indoor PM2.5 in a closed room.';
  return hasPurifier
    ? item('Run your purifier on high in the main room', 'Close the door and leave the purifier running all the time.', impact)
    : item('Build a DIY box-fan filter', 'Tape a MERV-13 furnace filter to a box fan. It costs a fraction of a commercial purifier.', impact);
}

/** Indoor air quality suggestions. */
function indoorAdvice({ elevated, pm25 }, profile) {
  if (!elevated) {
    return [item(
      'Air out the home for 10 minutes',
      'Open windows on opposite sides to let stale indoor air out.',
      'Lowers indoor CO₂ and VOCs.',
    )];
  }
  return [
    filtrationItem(profile.hasPurifier, pm25),
    item(
      'Seal gaps and keep windows shut',
      'Put draught strips on windows and doors. Air out the home briefly only when the AQI drops.',
      'Cuts the outdoor air leaking in by about 20%.',
    ),
    item(
      'Avoid burning anything indoors',
      'Skip incense, candles and wood or coal heaters, and run the extractor hood while cooking.',
      'Burning things indoors can add as much PM2.5 as a smoggy day outside.',
    ),
  ];
}

/** Pick the cleanest practical alternative for a car commute of this length. */
function alternativeMode(km) {
  if (km <= WALK_MAX_KM) return 'walk';
  return km <= CYCLE_MAX_KM ? 'cycle' : 'metro';
}

/** Lower-emission alternatives, with quantified CO₂ savings for car commuters. */
function sustainableAdvice({ severe }, profile) {
  const advice = [];
  const km = Number(profile.commuteKm) || 0;
  if (profile.commuteMode === 'car' && km > 0) {
    const mode = alternativeMode(km);
    const impact = commuteImpact(km, mode);
    advice.push(item(
      `Try ${MODE_LABELS[mode]} for your ${km} km commute`,
      severe && mode !== 'metro'
        ? 'The air is too polluted for walking or cycling today. Take public transport now and switch on cleaner days.'
        : 'Even 2–3 days a week makes a difference.',
      `Saves about ${impact.co2SavedKgPerWeek} kg CO₂ per week (${impact.co2SavedKgPerYear} kg per year) and cuts local NO₂ and PM.`,
    ));
  }
  advice.push(item(
    'Avoid idling and burning waste or leaves',
    'Switch off the engine at signals longer than 10 seconds, and report open burning.',
    'Open burning is a major source of winter PM2.5 in many cities.',
  ));
  return advice;
}

/**
 * Deterministic rule-based advice. This is the fallback when no LLM is
 * configured, and it is also passed to the LLM as grounding.
 * @param {{aqi:number, pm25?:number}} air
 * @param {{household?:string[], commuteKm?:number, commuteMode?:string, hasPurifier?:boolean}} profile
 */
function ruleBasedAdvice(air, profile = {}) {
  const risk = assessRisk(air, profile);
  const care = risk.sensitive ? ` Take extra care for: ${risk.household.join(', ')}.` : '';
  return {
    summary: `Air quality is ${risk.category.label} (AQI ${Math.round(air.aqi)}).${care}`,
    category: risk.category,
    routines: routineAdvice(risk),
    indoor: indoorAdvice(risk, profile),
    sustainable: sustainableAdvice(risk, profile),
    source: 'rules',
  };
}

module.exports = { categorize, commuteImpact, indoorPm25, ruleBasedAdvice, AQI_BANDS, IMPACT, SENSITIVE };
