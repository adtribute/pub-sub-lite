/* eslint-disable no-underscore-dangle */

import { check } from 'meteor/check';

// Custom config values that can't be set dynamically and must be hard coded
const CUSTOM_HARD_CODED_CONFIG = {
  /* Define your custom MongoDB connection poolSize here */
  mongoConnectionPoolSize: null,
};

/* *************************************************************************** */

// The pub-sub-lite package uses Change Streams to detect changes in update
// operations. Because each stream may open a separate MongoDB connection,
// the package tries to minimize the number of streams to at most 1 per
// collection. This means the maximum number of streams opened at once
// is theoretically equal to the number of collections.
// By default the maximum poolSize is set to 5 in Node.js MongoDB driver.
// This value is set for legacy reasons only, and is too small for the
// connections potentially opened by pub-sub-lite. So the package set this
// value to 100 by default (an arbitrary number inspired by the default value
// in the MongoDB Python driver).
// To customize this value, edit mongoConnectionPoolSize in the
// CUSTOM_HARD_CODED_CONFIG object above.
const _defaultMongoConnectionPoolSize = 100;

// Cache subscribeLite(), Meteor.callEnhanced() and Meteor.applyEnhanced() for
// 5 mins by default
const _defaultCacheDurationMs = 5 * 60 * 1000;

const PubSubLiteConfig = {
  _mongoConnectionPoolSize:
    CUSTOM_HARD_CODED_CONFIG.mongoConnectionPoolSize ||
    _defaultMongoConnectionPoolSize,
  _subsCacheEnabled: true,
  _subsCacheDurationMs: _defaultCacheDurationMs,
  _methodCallCacheEnabled: true,
  _methodCallCacheDurationMs: _defaultCacheDurationMs,

  disableSubsCache() {
    this._subsCacheEnabled = false;
  },
  setDefaultSubsCacheDurationMs(ms) {
    check(ms, Number);
    this._subsCacheDurationMs = ms;
  },
  disableMethodCallCache() {
    this._methodCallCacheEnabled = false;
  },
  setDefaultMethodCallCacheDurationMs(ms) {
    check(ms, Number);
    this._methodCallCacheDurationMs = ms;
  },
};

export default PubSubLiteConfig;
