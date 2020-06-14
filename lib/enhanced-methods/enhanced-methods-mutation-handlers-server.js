/* eslint-disable no-param-reassign */
/* eslint-disable prefer-rest-params */
/* eslint-disable consistent-return */
/* eslint-disable no-underscore-dangle */

/*
  Send DDP notifications to client when insert(), update() or remove() is called
  inside a Meteor method invocation. This allows client (the method caller) to
  be aware of mutation results and have Minimongo automatically updated without
  having to rely on pub/sub.
*/

import { Mongo, MongoInternals } from 'meteor/mongo';
import { MongoID } from 'meteor/mongo-id';
import { Random } from 'meteor/random';
import { DDP } from 'meteor/ddp-client';
import _ from 'lodash';
import {
  insertUpdateOperationIdToModifier,
  omitUpdateOperationId,
  getUpsertedDoc,
} from '../utils';
import PubSubLiteConfig from '../config';

const originalInsert = Mongo.Collection.prototype.insert;
const originalUpdate = Mongo.Collection.prototype.update;
const originalRemove = Mongo.Collection.prototype.remove;
const originalFind = Mongo.Collection.prototype.find;
const originalFindOne = Mongo.Collection.prototype.findOne;
// An arbitrary time duration reflecting potential delay in Change Streams
// (used to make sure that we don't close any stream too soon)
const CHANGE_STREAM_POTENTIAL_DELAY_DURATION_MS = 5000;
const idStringify = id => {
  // Change Streams may return documentKey._id as an ObjectID
  const resolvedId = _.isObject(id) ? id.toString() : id;
  return MongoID.idStringify(resolvedId);
};
const getClientSession = () => {
  const clientSessionId = DDP._CurrentMethodInvocation.get()?.connection?.id;
  return clientSessionId && Meteor.server.sessions.get(clientSessionId);
};
const shouldSendMutationUpdates = () =>
  DDP._CurrentMethodInvocation.get()?.__PubSubLite__mutationUpdatesEnabled;
const documentExistsInCollectionView = ({ session, collectionName, docId }) =>
  session?.getCollectionView(collectionName)?.documents?.get(docId);
const popCallbackFromArgs = args => {
  if (
    args.length &&
    (_.isUndefined(args[args.length - 1]) ||
      _.isFunction(args[args.length - 1]))
  ) {
    return args.pop();
  }
};
const getActiveChangeStream = (collection, operationId) => {
  const activeChangeStream = collection._changeStreams?.find(
    stream => !stream._isClosing && !stream._isClosed
  );

  if (!activeChangeStream) {
    const newChangeStream = collection
      .rawCollection()
      .watch([{ $match: { operationType: { $in: ['update', 'replace'] } } }]);

    newChangeStream._usedByOperationIds = [operationId];
    collection._changeStreams = [
      ...(collection._changeStreams || []),
      newChangeStream,
    ];

    return newChangeStream;
  }

  activeChangeStream._usedByOperationIds.push(operationId);
  return activeChangeStream;
};
const closeChangeStream = (collection, stream) => {
  if (
    !stream._isClosing &&
    !stream._isClosed &&
    _.isEmpty(stream._usedByOperationIds)
  ) {
    stream._isClosing = true;

    stream.close().then(() => {
      stream._isClosed = true;

      if (collection._changeStreams) {
        const streamIndex = collection._changeStreams.indexOf(stream);
        if (streamIndex > -1) collection._changeStreams.splice(streamIndex, 1);
      }
    });
  }
};
const cleanupChangeStreamAfterUpdate = (
  collection,
  operationId,
  finishedChangeStream
) => {
  Meteor.setTimeout(() => {
    const operationIdIndex = finishedChangeStream._usedByOperationIds.indexOf(
      operationId
    );

    if (operationIdIndex > -1)
      finishedChangeStream._usedByOperationIds.splice(operationIdIndex, 1);

    closeChangeStream(collection, finishedChangeStream);
  }, CHANGE_STREAM_POTENTIAL_DELAY_DURATION_MS);
};
const checkMongoDB = async () => {
  try {
    const rawDatabase = MongoInternals.defaultRemoteCollectionDriver().mongo.db;
    const admin = rawDatabase.admin();
    const serverStatus = await admin.serverStatus();
    const versionDigits = serverStatus.version.split('.');

    // Must be MongoDB 3.6.0 or later
    if (
      Number(versionDigits[0]) < 3 ||
      (Number(versionDigits[0]) === 3 && Number(versionDigits[1]) < 6)
    ) {
      console.error(`
        pub-sub-lite requires MongoDB Change Streams introduced in MongoDB 3.6.0.
        Your current version is ${serverStatus.version}. Please update MongoDB.
      `);
      return;
    }

    // Must be run as a replica set
    const isReplicaSet = await admin.replSetGetStatus().catch(() =>
      console.error(`
        pub-sub-lite requires MongoDB Change Streams, which is not available because you are
        not currently running MongoDB as a replica set.
        
        If you encounter this error message locally, follow the guide below and rerun your MongoDB:
        (Note: This will reset your local db)
        https://medium.com/@OndrejKvasnovsky/mongodb-replica-set-on-local-macos-f5fc383b3fd6

        For more information:
        https://docs.mongodb.com/manual/tutorial/convert-standalone-to-replica-set
      `)
    );

    // Make sure poolSize was setup correctly
    if (isReplicaSet) {
      const dummyChangeStream = rawDatabase.watch();
      const currentPoolSize =
        dummyChangeStream.topology.s.poolSize ||
        dummyChangeStream.topology.s.options?.poolSize;

      if (currentPoolSize !== PubSubLiteConfig._mongoConnectionPoolSize)
        console.error(`
          pub-sub-lite could not set MongoDB connection 'poolSize' setting. Please make sure in 
          .meteor/packages pub-sub-lite is above any other packages that use Mongo connections, 
          such as 'accounts-base' and its related packages (e.g. 'accounts-password').
        `);

      dummyChangeStream.close();
    }
  } catch (error) {
    console.error(`
      pub-sub-lite encountered an unexpected error. Please make sure you are running
      MongoDB version 3.6.0 or later and have configured a replica set.
    `);
    console.error('Error details:');
    console.error(error);
  }
};
const excludeUpdateOperationIdInQueryOptions = options =>
  // eslint-disable-next-line no-nested-ternary
  options
    ? _.isObject(options)
      ? {
          ...options,
          fields:
            // If the original options.fields already contains at least one including
            // field, we won't need to manually exclude __PubSubLite__updateOperationId
            options.fields &&
            Object.entries(options.fields).some(([, value]) => !!value)
              ? options.fields
              : { ...options.fields, __PubSubLite__updateOperationId: 0 },
        }
      : // An invalid options argument, will eventually raise an error
        options
    : { fields: { __PubSubLite__updateOperationId: 0 } };

// Setup MongoDB connections poolSize and make sure all MongoDB requirements are satisfied
Mongo.setConnectionOptions({
  poolSize: PubSubLiteConfig._mongoConnectionPoolSize,
});
Meteor.startup(() => checkMongoDB());

Mongo.Collection.prototype.insert = function (doc, callback) {
  const clientSession = getClientSession();
  const sendAddedMessage = docId => {
    clientSession.send({
      msg: 'added',
      collection: this._name,
      id: idStringify(docId),
      fields: doc,
    });
  };

  if (!clientSession || !shouldSendMutationUpdates())
    return originalInsert.bind(this)(...arguments);

  if (callback) {
    originalInsert.bind(this)(doc, (error, newDocId) => {
      if (!error) sendAddedMessage(newDocId);
      callback(error, newDocId);
    });
  } else {
    const newDocId = originalInsert.bind(this)(doc);
    sendAddedMessage(newDocId);
    return newDocId;
  }
};

Mongo.Collection.prototype.remove = function (selector, callback) {
  const clientSession = getClientSession();

  if (!clientSession || !shouldSendMutationUpdates())
    return originalRemove.bind(this)(...arguments);

  const resolvedSelector = Mongo.Collection._rewriteSelector(selector);
  const docIdsToBeRemoved = this.find(resolvedSelector, {
    fields: { _id: 1 },
  }).map(doc => doc._id);
  const sendRemovedMessage = () => {
    docIdsToBeRemoved.forEach(id => {
      clientSession.send({
        msg: 'removed',
        collection: this._name,
        id: idStringify(id),
      });
    });
  };

  if (callback) {
    originalRemove.bind(this)(selector, (error, numRemoved) => {
      if (!error) sendRemovedMessage();
      callback(error, numRemoved);
    });
  } else {
    const numRemoved = originalRemove.bind(this)(selector);
    sendRemovedMessage();
    return numRemoved;
  }
};

Mongo.Collection.prototype.update = function (
  selector,
  modifier,
  ...optionsAndCallback
) {
  const operationId = Random.id();
  const clientSession = getClientSession();
  const sendAddedMessage = (newDocId, fields) =>
    clientSession.send({
      msg: 'added',
      collection: this._name,
      id: idStringify(newDocId),
      fields,
    });
  const sendAddedMessageForUpsertedDoc = upsertResult => {
    const upsertedDoc = getUpsertedDoc(upsertResult, modifier);
    if (upsertedDoc) sendAddedMessage(upsertedDoc._id, upsertedDoc);
  };
  const sendChangedMessage = (docId, fields, clearedFields) => {
    clientSession.send({
      msg: 'changed',
      collection: this._name,
      id: idStringify(docId),
      fields,
      cleared: clearedFields,
    });
  };
  const sendRemovedMessage = docId =>
    clientSession.send({
      msg: 'removed',
      collection: this._name,
      id: idStringify(docId),
    });

  if (!clientSession || !shouldSendMutationUpdates())
    return originalUpdate.bind(this)(...arguments);

  // The outcome of a MongoDB update operation is not always predictable by only
  // analyzing selector and modifier without having the data set. Factors such as
  // the positional operator $ and update hooks may alter the data in unexpected
  // ways.
  // To accurately detect changes, we use MongoDB's Change Streams to keep track
  // of changes to be carried out by the upcoming update operation. Since each
  // Change Stream can potentially open a new db connection, we try to keep at
  // most one active stream for each collection. This means each stream may serve
  // multiple operations.
  // To make sure the captured changes are actually triggered by the upcoming
  // update operation, we attach an __PubSubLite__updateOperationId to each
  // matching docs.
  const changeStream = getActiveChangeStream(this, operationId);
  const modifierWithUpdateOperationId = insertUpdateOperationIdToModifier(
    modifier,
    operationId
  );
  const callback = popCallbackFromArgs(optionsAndCallback);
  const options = { ...optionsAndCallback[0] };
  let returnObjectOptionManuallyAdded = false;

  // When update() is called with the { upsert: true } option provided, we
  // force it to return a result object in order to retrieve the insertedId
  // (at the end of the execution we'll still return only the number of affected
  // docs to maintain API consistency). Note that if update() is called via
  // upsert() then options._returnObject is set internally and a result object
  // is expected.
  if (options.upsert && !options._returnObject) {
    options._returnObject = true;
    returnObjectOptionManuallyAdded = true;
  }

  changeStream.on('change', changeRecord => {
    const { operationType, documentKey } = changeRecord;

    if (operationType === 'update') {
      const { updatedFields, removedFields } = changeRecord.updateDescription;
      const { __PubSubLite__updateOperationId } = updatedFields;
      const resolvedUpdatedFields = omitUpdateOperationId(updatedFields);

      if (
        __PubSubLite__updateOperationId === operationId &&
        !(_.isEmpty(resolvedUpdatedFields) && _.isEmpty(removedFields)) &&
        // In case this document exists in a CollectionView, changes related to it
        // will be sent to client by Meteor internally
        !documentExistsInCollectionView({
          session: clientSession,
          collectionName: this._name,
          docId: documentKey._id,
        })
      ) {
        sendChangedMessage(
          documentKey._id,
          resolvedUpdatedFields,
          removedFields
        );
      }
    }

    if (operationType === 'replace') {
      const replaceDocument = changeRecord.fullDocument;
      const { __PubSubLite__updateOperationId } = replaceDocument;
      const resolvedReplaceDocument = omitUpdateOperationId(replaceDocument);

      if (
        __PubSubLite__updateOperationId === operationId &&
        !_.isEmpty(resolvedReplaceDocument) &&
        // In case this document exists in a CollectionView, changes related to it
        // will be sent to client by Meteor internally
        !documentExistsInCollectionView({
          session: clientSession,
          collectionName: this._name,
          docId: documentKey._id,
        })
      ) {
        sendRemovedMessage(documentKey._id);
        sendAddedMessage(documentKey._id, resolvedReplaceDocument);
      }
    }
  });

  try {
    if (callback) {
      originalUpdate.bind(this)(
        selector,
        modifierWithUpdateOperationId,
        options,
        (error, result) => {
          cleanupChangeStreamAfterUpdate(this, operationId, changeStream);
          callback(
            error,
            returnObjectOptionManuallyAdded ? result?.numberAffected : result
          );
          sendAddedMessageForUpsertedDoc(result);
        }
      );
    } else {
      const result = originalUpdate.bind(this)(
        selector,
        modifierWithUpdateOperationId,
        options
      );
      cleanupChangeStreamAfterUpdate(this, operationId, changeStream);
      sendAddedMessageForUpsertedDoc(result);
      return returnObjectOptionManuallyAdded ? result.numberAffected : result;
    }
  } finally {
    if (!this._changeStreamsCleanupInterval)
      this._changeStreamsCleanupInterval = Meteor.setInterval(() => {
        if (this._changeStreams?.length) {
          this._changeStreams.forEach(stream =>
            closeChangeStream(this, stream)
          );
        } else {
          Meteor.clearInterval(this._changeStreamsCleanupInterval);
          delete this._changeStreamsCleanupInterval;
        }
      }, CHANGE_STREAM_POTENTIAL_DELAY_DURATION_MS);
  }
};

// Make sure the added __PubSubLite__updateOperationId property doesn't appear
// in queried docs.
// (Alternatively we can clear the property after each update() operation, but
// it will cost an extra db request)
Mongo.Collection.prototype.find = function (selector, options) {
  // Preserve default MongoDB selector behaviour: If selector is not provided,
  // it's equivalent to a match-all selector
  const resolvedSelector = arguments.length === 0 ? {} : selector;
  const resolvedOptions = excludeUpdateOperationIdInQueryOptions(options);
  return originalFind.bind(this)(resolvedSelector, resolvedOptions);
};
Mongo.Collection.prototype.findOne = function (selector, options) {
  const resolvedSelector = arguments.length === 0 ? {} : selector;
  const resolvedOptions = excludeUpdateOperationIdInQueryOptions(options);
  return originalFindOne.bind(this)(resolvedSelector, resolvedOptions);
};
