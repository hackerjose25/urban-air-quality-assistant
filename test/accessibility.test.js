'use strict';

/**
 * Static accessibility checks on the HTML page (WCAG 2.2 basics),
 * using no extra dependencies.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');

test('document declares language, title and viewport', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /name="viewport"/);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/, 'zoom must not be disabled');
});

test('page has landmarks, a skip link and one h1', () => {
  for (const tag of ['<header', '<main', '<footer']) assert.ok(html.includes(tag), `missing ${tag}`);
  assert.match(html, /class="skip-link" href="#main"/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
});

test('every text input and select has an associated label', () => {
  const ids = [...html.matchAll(/<(?:input|select)[^>]*\bid="([^"]+)"[^>]*>/g)]
    .filter((m) => !/type="checkbox"/.test(m[0]))
    .map((m) => m[1]);
  assert.ok(ids.length >= 3);
  for (const id of ids) assert.match(html, new RegExp(`<label for="${id}"`), `no label for #${id}`);
});

test('checkboxes are wrapped in labels and grouped in fieldsets with legends', () => {
  const boxes = (html.match(/type="checkbox"/g) || []).length;
  const wrapped = (html.match(/<label[^>]*><input[^>]*type="checkbox"/g) || []).length;
  assert.equal(wrapped, boxes);
  assert.equal((html.match(/<fieldset>/g) || []).length, (html.match(/<legend>/g) || []).length);
});

test('dynamic updates are announced to screen readers', () => {
  assert.match(html, /role="status"[^>]*aria-live="polite"/);
  assert.match(html, /role="alert"/);
});

test('the forecast chart has a text alternative', () => {
  assert.match(html, /id="forecast-bars"[^>]*role="img"/);
  const js = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  assert.match(js, /forecast-bars'\)\.setAttribute\('aria-label'/);
});

test('styles provide visible focus, 44px targets, dark mode and reduced motion', () => {
  assert.match(css, /:focus-visible\s*{[^}]*outline/);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /prefers-reduced-motion/);
});

test('buttons have accessible names and external links are safe', () => {
  for (const m of html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)) {
    assert.ok(m[1].trim().length > 0, 'button without text');
  }
  for (const m of html.matchAll(/<a [^>]*href="https?:[^>]*>/g)) {
    assert.match(m[0], /rel="noopener noreferrer"/);
  }
});

/** WCAG relative-luminance contrast ratio. */
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('text colours meet WCAG AA contrast (4.5:1) in light and dark themes', () => {
  const pairs = [
    ['#13231c', '#ffffff'], ['#4a5d54', '#ffffff'], ['#1b6e4f', '#ffffff'], ['#b3261e', '#ffffff'], // light
    ['#e6f0eb', '#16231d'], ['#a9bdb3', '#16231d'], ['#5fc79a', '#16231d'], ['#ffb4ab', '#16231d'], // dark
  ];
  for (const [fg, bg] of pairs) {
    assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg} is ${contrast(fg, bg).toFixed(2)}:1`);
  }
});
