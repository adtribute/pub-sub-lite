/* eslint-disable no-underscore-dangle */

import _ from 'lodash';
import { check, Match } from 'meteor/check';
import PubSubLiteConfig from '../config';

const subsCache = {
  // 'hashed-sub-arguments': { handle, durationMs, refreshedAt }
};

const findSubCache = hashedSubArgs => {
  check(hashedSubArgs, String);
  return subsCache[hashedSubArgs];
};

export const getCachedSubHandle = hashedSubArgs => {
  const subCache = findSubCache(hashedSubArgs);
  return subCache?.handle;
};

export const isSubCacheDeprecated = (hashedSubArgs, newDurationMs) => {
  if (!PubSubLiteConfig._subsCacheEnabled) return true;

  const subCache = findSubCache(hashedSubArgs);
  const durationMs = _.isNumber(newDurationMs)
    ? newDurationMs
    : subCache.durationMs;
  const isDeprecated =
    subCache &&
    Date.now() - subCache.refreshedAt.valueOf() >
      (_.isNumber(durationMs)
        ? durationMs
        : PubSubLiteConfig._subsCacheDurationMs);

  if (!subCache) throw new Meteor.Error('Subscription cache not found.');

  return isDeprecated;
};

// Add or override existing sub cache
export const addSubCache = ({ hashedSubArgs, handle, durationMs }) => {
  check(hashedSubArgs, String);
  check(handle, Object);
  check(durationMs, Match.Optional(Number));

  subsCache[hashedSubArgs] = {
    handle,
    durationMs,
    refreshedAt: new Date(),
  };
};

export const removeSubCache = hashedSubArgs => delete subsCache[hashedSubArgs];
