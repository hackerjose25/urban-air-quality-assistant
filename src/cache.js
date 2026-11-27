'use strict';

/** Minimal TTL cache with a size bound and LRU eviction, so upstream APIs are not called repeatedly. */
class TtlCache {
  constructor({ ttlMs = 10 * 60 * 1000, max = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.map = new Map();
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    this.map.delete(key);
    if (Date.now() > hit.exp) return undefined;
    this.map.set(key, hit); // move to most-recently-used
    return hit.value;
  }

  set(key, value) {
    this.map.delete(key);
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value);
    this.map.set(key, { value, exp: Date.now() + this.ttlMs });
  }
}

module.exports = { TtlCache };
