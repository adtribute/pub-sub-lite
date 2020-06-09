/* eslint-disable no-param-reassign */
/* eslint-disable no-underscore-dangle */

import _ from 'lodash';

const mongoUpdateOperators = [
  '$currentDate',
  '$inc',
  '$min',
  '$max',
  '$mul',
  '$rename',
  '$set',
  '$setOnInsert',
  '$unset',
  '$addToSet',
  '$pop',
  '$pull',
  '$push',
  '$pushAll',
  '$bit',
];
const modifierIsUpdateDocument = modifier =>
  modifier &&
  Object.keys(modifier).every(key => mongoUpdateOperators.includes(key));
const modifierIsReplacementDocument = modifier =>
  modifier &&
  Object.keys(modifier).every(key => !mongoUpdateOperators.includes(key));

export const extractSubscribeArguments = args => {
  let options = {};

  if (args.length) {
    const lastArg = args[args.length - 1];

    if (_.isFunction(lastArg)) {
      options.onReady = args.pop();
    } else if (
      _.isObject(lastArg) &&
      ([lastArg.onReady, lastArg.onStop].some(_.isFunction) ||
        // Support defining individual cache duration per sub
        _.isNumber(lastArg.cacheDurationMs))
    ) {
      options = args.pop();
    }
  }

  return [args, _.isEmpty(options) ? null : options];
};

// Used to merge documents added by the low-level publish API into the final fetch
// result set
export const mergeDocIntoFetchResult = (doc, fetchResult) => {
  const existingDocs = fetchResult[doc.collectionName];
  const newDoc = { _id: doc._id, ...doc.attrs };

  if (existingDocs) {
    const duplicatedDoc = existingDocs.find(o => o._id === newDoc._id);

    // We do not implement deep merge logic here to avoid performance issues
    if (duplicatedDoc) {
      const mergedDoc = { ...duplicatedDoc, ...newDoc };

      fetchResult[doc.collectionName] = [
        ...existingDocs.filter(o => o._id !== newDoc._id),
        mergedDoc,
      ];
    } else {
      fetchResult[doc.collectionName] = [...existingDocs, newDoc];
    }
  } else {
    fetchResult[doc.collectionName] = [newDoc];
  }

  return fetchResult;
};

export const overrideLowLevelPublishAPI = (
  methodInvocation,
  customAddedDocuments
) => {
  // Handle documents added with the this.added() custom low-level publish API
  methodInvocation.added = (collectionName, _id, attrs) =>
    customAddedDocuments.push({ collectionName, _id, attrs });

  // Prevent errors when these functions are called inside the original publish handler
  ['changed', 'removed', 'ready', 'onStop', 'error', 'stop'].forEach(
    functionName => {
      methodInvocation[functionName] = _.noop;
    }
  );
};

export const insertUpdateOperationIdToModifier = (
  modifier,
  updateOperationId
) => {
  if (_.isArray(modifier)) {
    return [
      { $addFields: { __PubSubLite__updateOperationId: updateOperationId } },
      ...modifier,
    ];
  }

  if (_.isObject(modifier)) {
    if (modifierIsUpdateDocument(modifier))
      return {
        ...modifier,
        $set: {
          ...modifier.$set,
          __PubSubLite__updateOperationId: updateOperationId,
        },
      };
    if (modifierIsReplacementDocument(modifier))
      return {
        ...modifier,
        __PubSubLite__updateOperationId: updateOperationId,
      };

    // A mixed modifier is invalid, so we'll just return it for Mongo to throw error
    return modifier;
  }

  return modifier;
};

export const omitUpdateOperationId = modifierOrObject => {
  if (
    _.isArray(modifierOrObject) &&
    modifierOrObject[0]?.$addFields?.__PubSubLite__updateOperationId
  ) {
    const [, ...withoutUpdateOperationId] = modifierOrObject;
    return withoutUpdateOperationId;
  }

  if (_.isObject(modifierOrObject)) {
    if (modifierOrObject.$set?.__PubSubLite__updateOperationId)
      return {
        ...modifierOrObject,
        $set: _.omit(modifierOrObject.$set, '__PubSubLite__updateOperationId'),
      };
    if (modifierOrObject.__PubSubLite__updateOperationId)
      return _.omit(modifierOrObject, '__PubSubLite__updateOperationId');
  }

  return modifierOrObject;
};

export const getUpsertedDoc = (upsertResult, modifier) => {
  const { insertedId } = upsertResult;

  if (!insertedId || !_.isObject(modifier) || _.isEmpty(modifier)) return null;

  if (modifierIsUpdateDocument(modifier)) {
    // XXX TODO We currently support only $set and $setOnInsert
    const upsertedDoc = { ...modifier.$set, ...modifier.$setOnInsert };
    return _.isEmpty(upsertedDoc) ? null : { ...upsertedDoc, _id: insertedId };
  }

  if (modifierIsReplacementDocument(modifier))
    return { ...modifier, _id: insertedId };

  return null;
};

export const mergeDataIntoMinimongo = data => {
  if (!_.isObject(data)) return;

  const dataEntries = Object.entries(data);

  // Prevent the UI from flashing when updating
  dataEntries.forEach(([collectionName]) => {
    Meteor.connection._mongo_livedata_collections[
      collectionName
    ]?.pauseObservers();
  });

  // Populate the fetched data into Minimongo
  dataEntries.forEach(([collectionName, docs]) => {
    const store = Meteor.connection._stores[collectionName];
    const localCollection =
      Meteor.connection._mongo_livedata_collections[collectionName];

    if (!store || !localCollection || _.isEmpty(docs)) return;

    docs.forEach(doc => {
      const existingDoc = localCollection._docs.get(doc._id);
      if (existingDoc)
        localCollection.update(doc._id, _.merge(existingDoc, doc));
      else localCollection.insert(doc);
    });

    // Prevent this data from being reset on reconnect
    if (!store.__PubSubLite__mergedWithNonreactiveData) {
      store.beginUpdate = function (batchSize) {
        if (batchSize > 1) localCollection.pauseObservers();
      };
      store.__PubSubLite__mergedWithNonreactiveData = true;
    }
  });

  // Resume UI reactivity
  dataEntries.forEach(([collectionName]) => {
    Meteor.connection._mongo_livedata_collections[
      collectionName
    ]?.resumeObservers();
  });
};
