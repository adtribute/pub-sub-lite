/* eslint-disable no-underscore-dangle */

import PubSubLiteConfig from '../config';
import _ from 'lodash';
import { check, Match } from 'meteor/check';

export const methodCallsCache = {
  // 'hashed-method-call-arguments': { data, mergedWithMinimongo, durationMs, lastCalledAt }
};

export const getActiveMethodCallCache = (
  hashedMethodCallArgs,
  newDurationMs,
  skipCachedDataUpdate
) => {
  const methodCallCache = methodCallsCache[hashedMethodCallArgs];

  if (!methodCallCache || !PubSubLiteConfig._methodCallCacheEnabled)
    return null;

  const durationMs = _.isNumber(newDurationMs)
    ? newDurationMs
    : methodCallCache.durationMs;
  const isDeprecated =
    Date.now() - methodCallCache.lastCalledAt.valueOf() >
    (_.isNumber(durationMs)
      ? durationMs
      : PubSubLiteConfig._methodCallCacheDurationMs);

  // Before returning the cache, update its data with the latest version
  // in Minimongo (if it was previously merged into Minimongo). Any docs
  // removed from Minimongo will be removed from the cached data as well.
  if (!isDeprecated) {
    if (
      !skipCachedDataUpdate &&
      methodCallCache.data &&
      methodCallCache.mergedWithMinimongo
    ) {
      // Array of docs
      if (_.isArray(methodCallCache.data)) {
        const localCollection =
          Meteor.connection._mongo_livedata_collections[
            methodCallCache.collectionName
          ];
        if (localCollection)
          methodCallCache.data = localCollection
            .find({
              _id: {
                $in: methodCallCache.data.map(doc => doc._id),
              },
            })
            .fetch();
        // Single doc
      } else if (_.isObject(methodCallCache.data) && methodCallCache.data._id) {
        const localCollection =
          Meteor.connection._mongo_livedata_collections[
            methodCallCache.collectionName
          ];
        if (localCollection)
          methodCallCache.data = localCollection.findOne(
            methodCallCache.data._id
          );
        // Dictionary of collection names and their docs
      } else if (_.isObject(methodCallCache.data)) {
        const updatedData = {};
        Object.entries(methodCallCache.data).forEach(
          ([collectionName, docs]) => {
            const localCollection =
              Meteor.connection._mongo_livedata_collections[collectionName];
            if (localCollection)
              updatedData[collectionName] = localCollection
                .find({
                  _id: {
                    $in: docs.map(doc => doc._id),
                  },
                })
                .fetch();
          }
        );
        methodCallCache.data = updatedData;
      }
    }
    return methodCallCache;
  }

  return null;
};

export const addMethodCallCache = ({
  hashedMethodCallArgs,
  data,
  collectionName,
  mergedWithMinimongo,
  durationMs,
}) => {
  check(hashedMethodCallArgs, String);
  check(data, Match.Any);
  check(collectionName, Match.Optional(String));
  check(mergedWithMinimongo, Match.Optional(Boolean));
  check(durationMs, Match.Optional(Number));

  methodCallsCache[hashedMethodCallArgs] = {
    data,
    collectionName,
    mergedWithMinimongo,
    durationMs,
    lastCalledAt: new Date(),
  };
};

export const updateMethodCallCacheDurationMs = (
  hashedMethodCallArgs,
  durationMs
) => {
  check(hashedMethodCallArgs, String);
  check(durationMs, Match.Optional(Number));
  methodCallsCache[hashedMethodCallArgs].durationMs = durationMs;
};

export const removeMethodCallCache = hashedMethodCallArgs =>
  delete methodCallsCache[hashedMethodCallArgs];
