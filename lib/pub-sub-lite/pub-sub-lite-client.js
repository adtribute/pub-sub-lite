/* eslint-disable no-underscore-dangle */

import { Meteor } from 'meteor/meteor';
import { Tracker } from 'meteor/tracker';
import { Random } from 'meteor/random';
import { MongoID } from 'meteor/mongo-id';
import _ from 'lodash';
import { extractSubscribeArguments, mergeDataIntoMinimongo } from '../utils';
import objectHash from 'object-hash';
import {
  getCachedSubHandle,
  isSubCacheDeprecated,
  addSubCache,
  removeSubCache,
} from '../caching/subs-cache';
import PubSubLiteConfig from '../config';

Meteor.subscribeLite = function (name, ...args) {
  if (!_.isString(name))
    throw new Meteor.Error(
      'Meteor.subscribeLite called with an invalid publication name.'
    );

  const subsCacheEnabled = PubSubLiteConfig._subsCacheEnabled;
  const [subscribeArgs, subscribeOptions] = extractSubscribeArguments(args);
  const hashedSubArgs = subsCacheEnabled
    ? objectHash({ name, args: subscribeArgs })
    : null;
  const cachedSubHandle = hashedSubArgs && getCachedSubHandle(hashedSubArgs);
  const isCachedSubHandleActive =
    cachedSubHandle &&
    !isSubCacheDeprecated(hashedSubArgs, subscribeOptions?.cacheDurationMs);

  if (cachedSubHandle) {
    // If the sub was cached and is still active, just reuse it
    if (isCachedSubHandleActive) return cachedSubHandle;
    // If cache is no longer active, invalidate the sub handle to prepare for
    // a new data fetch
    cachedSubHandle._isReady = false;
    cachedSubHandle._readyDep.changed();
  }

  let subscriptionHandle;
  if (cachedSubHandle) {
    subscriptionHandle = cachedSubHandle;
    // Allow caller to provide a new onStop
    if (_.isFunction(subscribeOptions?.onStop))
      subscriptionHandle.stop = subscribeOptions.onStop;
  } else {
    // Simulate the original Meteor.subscribe handle
    subscriptionHandle = {
      _isReady: false,
      _readyDep: new Tracker.Dependency(),
      subscriptionId: Random.id(),
      stop() {
        subscribeOptions?.onStop?.();
      },
      ready() {
        this._readyDep.depend();
        return this._isReady;
      },
    };
  }

  Meteor.apply(name, subscribeArgs, {}, (error, data) => {
    if (error) {
      // Original behaviour when a subscription fails
      subscribeOptions?.onStop?.(error);
      // Clear the current subscription cache
      removeSubCache(hashedSubArgs);
    } else {
      // Cache the sub, or update the existing cache
      if (subsCacheEnabled)
        addSubCache({
          hashedSubArgs,
          handle: subscriptionHandle,
          durationMs: subscribeOptions?.cacheDurationMs,
        });

      mergeDataIntoMinimongo(data);

      // Signal reactive recomputations
      // Note: In case we found an active cachedSubHandle, it might already be in
      // ready state and UI reactivity might already be initialized. To avoid UI
      // flashing when updating, inside mergeDataIntoMinimongo() we always manually
      // turn off reactivity before carrying out updates.
      subscriptionHandle._isReady = true;
      subscriptionHandle._readyDep.changed();

      subscribeOptions?.onReady?.();
    }
  });

  return subscriptionHandle;
};

// Prevent potential conflicts caused by manual DDP messages from the server-side.
// These conflicts might be caused because we no longer track client's data on the
// server-side with SessionCollectionViews. Such conflicts are harmless in the context
// of the package, so we want to automatically resolve them rather than letting errors
// be thrown.
// More specifically:
//   - 'added' message received for existing doc: Merge
//   - 'changed' message received for non-existing doc: Ignore
//   - 'removed' message received for non-existing doc: Ignore
const _processOneDataMessageOriginal = Meteor.connection._processOneDataMessage;
Meteor.connection._processOneDataMessage = function (msg, updates) {
  const { msg: messageType, collection: collectionName, id: docId } = msg;
  const shouldBeBypassed =
    [
      'meteor_accounts_loginServiceConfiguration',
      'meteor_autoupdate_clientVersions',
    ].includes(collectionName) ||
    !['added', 'changed', 'removed'].includes(messageType) ||
    (collectionName === 'users' && docId?.charAt(0) === '-');

  if (shouldBeBypassed)
    return _processOneDataMessageOriginal.bind(this)(msg, updates);

  const parsedDocId = docId && MongoID.idParse(docId);
  const existingDoc =
    parsedDocId &&
    Meteor.connection._mongo_livedata_collections[collectionName]?._docs?.get(
      parsedDocId
    );
  const serverDoc = Meteor.connection._getServerDoc(collectionName, docId);
  const ddpMessageShouldBeIgnored =
    !existingDoc &&
    (messageType === 'changed' ||
      // For removed docs, don't skip if the docs have been removed by a stub,
      // otherwise the removal will eventually be cancelled out on the client-side
      (messageType === 'removed' && !serverDoc));

  if (messageType === 'added' && existingDoc)
    return _processOneDataMessageOriginal.bind(this)(
      { ...msg, msg: 'changed' },
      updates
    );
  if (ddpMessageShouldBeIgnored) return null;

  return _processOneDataMessageOriginal.bind(this)(msg, updates);
};

// For testing
Meteor.subscribeOriginal = Meteor.subscribe;
