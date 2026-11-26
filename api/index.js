'use strict';

// Vercel serverless entry point: every request is handled by the Express app.
const { createApp } = require('../src/app');

module.exports = createApp();
