/* eslint-disable no-param-reassign */
/* eslint-disable no-underscore-dangle */
/* eslint-disable prefer-rest-params */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import _ from 'lodash';
import objectHash from 'object-hash';
import PubSubLiteConfig from '../config';
import { mergeDataIntoMinimongo } from '../utils';
import {
  getActiveMethodCallCache,
  addMethodCallCache,
  updateMethodCallCacheDurationMs,
  removeMethodCallCache,
} from '../caching/method-calls-cache';

const isDataDictionaryMergeableToMinimongo = data =>
  !_.isArray(data) &&
  _.isObject(data) &&
  Object.entries(_.omit(data, 'cacheMethodResultInMinimongo')).every(
    ([collectionName, docs]) =>
      Meteor.connection._mongo_livedata_collections[collectionName] &&
      _.isArray(docs) &&
      docs.every(doc => doc._id)
  );

Meteor.applyEnhanced = function (name, args, options, callback) {
  if (!callback && _.isFunction(options)) {
    callback = options;
    options = {};
  }
  options = options || {};
  const methodCallCacheEnabled = PubSubLiteConfig._methodCallCacheEnabled;
  let hashedMethodCallArgs;
  let activeMethodCallCache;

  if (methodCallCacheEnabled) {
    hashedMethodCallArgs = objectHash({ name, args });
    activeMethodCallCache = getActiveMethodCallCache(
      hashedMethodCallArgs,
      options.cacheDurationMs
    );
    if (activeMethodCallCache) {
      if (options.cacheDurationMs !== activeMethodCallCache.durationMs)
        updateMethodCallCacheDurationMs(
          hashedMethodCallArgs,
          options.cacheDurationMs
        );
      return callback?.(null, activeMethodCallCache.data);
    }
  }

  // Auto Minimongo data merging and method call caching
  const enhancedCallback = (error, result) => {
    if (error) {
      // In case of error the existing cache of this method should be cleared
      removeMethodCallCache(hashedMethodCallArgs);
    } else if (result?.cacheMethodResultInMinimongo) {
      if (!isDataDictionaryMergeableToMinimongo(result)) {
        console.error(
          `
           Invalid data format. Data must be an object whose keys are collection names
           and values are arrays of documents. 
           
           If you don't want to modify the shape of data returned from server, remove the
           'cacheMethodResultInMinimongo' property from result data and use PubSubLite.cacheMethodResult
           instead.         

           Note that PubSubLite.cacheMethodResult only caches data and won't automatically merge it to Minimongo.
          `
        );
        throw new Meteor.Error('Invalid data format');
      }

      mergeDataIntoMinimongo(result);

      if (methodCallCacheEnabled)
        addMethodCallCache({
          hashedMethodCallArgs,
          data: _.omit(result, 'cacheMethodResultInMinimongo'),
          mergedWithMinimongo: true,
          durationMs: options.cacheDurationMs,
        });
    }
    callback?.(error, result);
  };

  // eslint-disable-next-line consistent-return
  return Meteor.apply(name, args, options, enhancedCallback);
};

Meteor.callEnhanced = function (name, ...args) {
  let callback;
  let options;

  if (args.length && _.isFunction(args[args.length - 1])) callback = args.pop();
  // cacheDurationMs option can be passed as the last argument before callback
  if (args.length && _.has(args[args.length - 1], 'cacheDurationMs'))
    options = args.pop();

  return Meteor.applyEnhanced(name, args, options, callback);
};

// Only server-side method executions are enhanced
Meteor.methodsEnhanced = Meteor.methods;

// Cache method result. Result data can have any arbitrary value.
export const cacheMethodResult = ({ name, args, data, durationMs }) => {
  if (!PubSubLiteConfig._methodCallCacheEnabled) return;

  check(name, String);
  check(args, Match.Optional([Match.Any]));
  check(data, Match.Any);

  if (data?.cacheMethodResultInMinimongo) {
    console.error(
      `
       Invalid data: Result data of '${name}' unexpectedly contains the 'cacheMethodResultInMinimongo' 
       key. When 'cacheMethodResultInMinimongo' is defined, caching and merging with Minimongo will
       be handled automatically. PubSubLite.cacheMethodResult shouldn't be called manually in this case.
      `
    );
    throw new Meteor.Error('Invalid data');
  }

  const hashedMethodCallArgs = objectHash({ name, args });
  const activeMethodCallCache = getActiveMethodCallCache(
    hashedMethodCallArgs,
    durationMs,
    true
  );

  // If the existing method call cache is still active, it means the
  // PubSubLite.cacheMethodResult() helper was called inside a simulated
  // callback. In this case there's no new data and we don't need to do
  // anything, except update the cache duration if a new value is provided.
  if (activeMethodCallCache) {
    if (durationMs !== activeMethodCallCache.durationMs)
      updateMethodCallCacheDurationMs(hashedMethodCallArgs, durationMs);
    return;
  }

  addMethodCallCache({
    hashedMethodCallArgs,
    data,
    durationMs,
  });
};

// Similar to cacheMethodResult(), but also synced with Minimongo and thus requires
// data to be a single document, an array of documents, or a dictionary of collection
// names and their documents.
export const cacheMethodResultInMinimongo = ({
  name,
  args,
  data,
  collectionName,
  durationMs,
}) => {
  if (!PubSubLiteConfig._methodCallCacheEnabled) return;

  check(name, String);
  check(args, Match.Optional([Match.Any]));
  check(
    data,
    Match.OneOf(
      // A single document
      Match.ObjectIncluding({ _id: String }),
      // An array of documents
      [Match.ObjectIncluding({ _id: String })],
      // A dictionary of collection names and their documents (further validation below)
      Object
    )
  );

  if (data.cacheMethodResultInMinimongo) {
    console.error(
      `
       Invalid data: Result data of '${name}' unexpectedly contains the 'cacheMethodResultInMinimongo' 
       key. When 'cacheMethodResultInMinimongo' is defined, caching and merging with Minimongo will
       be handled automatically. PubSubLite.cacheMethodResultInMinimongo shouldn't be called manually 
       in this case.
      `
    );
    throw new Meteor.Error('Invalid data');
  }

  // Further validate the dictionary format
  const isDictionary = !_.isArray(data) && _.isObject(data) && !data._id;
  if (isDictionary && !isDataDictionaryMergeableToMinimongo(data)) {
    console.error(
      `
       Invalid data format. Data must be an object whose keys are collection names
       and values are arrays of documents. 
       
       If the result data of '${name}' isn't suitable for merging into Minimongo,
       use PubSubLite.cacheMethodResult instead.
      `
    );
    throw new Meteor.Error('Invalid data format');
  }

  // When data is a single doc or an array of docs, collectionName must be defined
  if (
    (_.isArray(data) || (_.isObject(data) && !isDictionary)) &&
    (!_.isString(collectionName) ||
      !Meteor.connection._mongo_livedata_collections[collectionName])
  ) {
    console.error(
      `When result data is a document or an array of documents, cacheMethodResultInMinimongo needs a valid collectionName to perform Minimongo merging.`
    );
    throw new Meteor.Error('Missing a valid collection name.');
  }

  const hashedMethodCallArgs = objectHash({ name, args });
  const activeMethodCallCache = getActiveMethodCallCache(
    hashedMethodCallArgs,
    durationMs,
    true
  );

  if (activeMethodCallCache) {
    if (durationMs !== activeMethodCallCache.durationMs)
      updateMethodCallCacheDurationMs(hashedMethodCallArgs, durationMs);
    return;
  }

  mergeDataIntoMinimongo(
    // eslint-disable-next-line no-nested-ternary
    _.isArray(data)
      ? { [collectionName]: data }
      : data._id
      ? { [collectionName]: [data] }
      : data
  );
  addMethodCallCache({
    hashedMethodCallArgs,
    data,
    collectionName,
    mergedWithMinimongo: true,
    durationMs,
  });
};
