'use strict';

const { config } = require('./config');

/** Minimal TTL cache with a size bound and LRU eviction, so upstream APIs are not called repeatedly. */
class TtlCache {
  /** @param {{ttlMs?: number, max?: number}} [options] */
  constructor({ ttlMs = config.cache.ttlMs, max = config.cache.maxEntries } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.map = new Map();
  }

  /**
   * @param {string} key
   * @returns {*} the cached value, or undefined if missing or expired
   */
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    if (Date.now() > hit.exp) return undefined;
    this.map.set(key, hit); // move to most-recently-used
    return hit.value;
  }

  /**
   * Store a value, evicting the least-recently-used entry when full.
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    this.map.delete(key);
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, exp: Date.now() + this.ttlMs });
  }
}

module.exports = { TtlCache };
