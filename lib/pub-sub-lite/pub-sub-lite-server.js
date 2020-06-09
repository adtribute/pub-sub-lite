/* eslint-disable consistent-return */
/* eslint-disable no-underscore-dangle */

import _ from 'lodash';
import { mergeDocIntoFetchResult, overrideLowLevelPublishAPI } from '../utils';

Meteor.publishLite = function (name, handler) {
  if (name === null)
    throw new Meteor.Error(
      'You should use Meteor.publish() for null publications.'
    );
  if (!_.isString(name) || !_.isFunction(handler))
    throw new Meteor.Error(
      `Invalid arguments provided for the '${name}' publication.`
    );
  if (_.has(Meteor.server.method_handlers, name))
    throw new Meteor.Error(
      `PubSubLite cannot create a method named '${name}' because it has already been defined.`
    );

  Meteor.methods({
    [name](...args) {
      const customAddedDocuments = [];

      overrideLowLevelPublishAPI(this, customAddedDocuments);

      const handlerReturn = handler.apply(this, args);
      const isSingleCursor = handlerReturn && handlerReturn._publishCursor;
      const isArrayOfCursors =
        _.isArray(handlerReturn) &&
        handlerReturn.every(cursor => cursor._publishCursor);
      const fetchResult = {};

      // Validate the cursor(s)
      if (handlerReturn && !isSingleCursor && !isArrayOfCursors)
        throw new Meteor.Error(
          `Handler for '${name}' returns invalid cursor(s).`
        );
      if (isArrayOfCursors) {
        const collectionNamesInCursors = handlerReturn.map(
          cursor => cursor._cursorDescription.collectionName
        );
        const hasDuplicatedCollections =
          new Set(collectionNamesInCursors).size !==
          collectionNamesInCursors.length;
        // This rule is enforced in the original publish() function
        if (hasDuplicatedCollections)
          throw new Meteor.Error(
            `Handler for '${name}' returns an array containing cursors of the same collection.`
          );
      }

      // Fetch the cursor(s)
      if (isSingleCursor) {
        Object.assign(fetchResult, {
          [handlerReturn._cursorDescription
            .collectionName]: handlerReturn.fetch(),
        });
      } else if (isArrayOfCursors) {
        handlerReturn.forEach(cursor => {
          Object.assign(fetchResult, {
            [cursor._cursorDescription.collectionName]: cursor.fetch(),
          });
        });
      } else {
        // no-op: The original publish handler didn't return any cursor. This may
        // happen when, for example, a certain authentication check fails and the
        // handler exits early with this.ready() called to signal an empty publication.
        // In this case we simply return fetchResult as an empty object.
      }

      customAddedDocuments.forEach(doc =>
        mergeDocIntoFetchResult(doc, fetchResult)
      );

      return fetchResult;
    },
  });
};

Meteor.publishCompositeLite = function (name, topLevelOptions) {
  if (!_.isString(name))
    throw new Meteor.Error(
      'publishCompositeLite was called with an invalid name.'
    );
  if (_.has(Meteor.server.method_handlers, name))
    throw new Meteor.Error(
      `PubSubLite cannot create a method named '${name}' because it has already been defined.`
    );
  if (!_.isObject(topLevelOptions) && !_.isFunction(topLevelOptions))
    throw new Meteor.Error(
      `publishCompositeLite was called with an invalid 'options' argument.`
    );
  if (
    !_.isFunction(topLevelOptions) &&
    _.isObject(topLevelOptions) &&
    !_.isFunction(topLevelOptions.find)
  )
    throw new Meteor.Error(
      `publishCompositeLite's options must contain a find() method.`
    );

  Meteor.methods({
    [name](...args) {
      const customAddedDocuments = [];

      overrideLowLevelPublishAPI(this, customAddedDocuments);

      const fetchResult = {};
      const resolvedTopLevelOptions = _.isFunction(topLevelOptions)
        ? topLevelOptions.apply(this, args)
        : topLevelOptions;
      const recursiveFetch = (aggregatedUpperLevelDocs, options) => {
        if (_.isEmpty(options)) return;

        const cursor = options?.find?.apply(this, aggregatedUpperLevelDocs);
        const docs = cursor?.fetch?.();

        docs?.forEach(doc => {
          mergeDocIntoFetchResult(
            {
              collectionName: cursor._cursorDescription.collectionName,
              attrs: doc,
            },
            fetchResult
          );

          options?.children?.forEach?.(childOptions => {
            recursiveFetch([doc, ...aggregatedUpperLevelDocs], childOptions);
          });
        });
      };

      recursiveFetch([], resolvedTopLevelOptions);

      customAddedDocuments.forEach(doc =>
        mergeDocIntoFetchResult(doc, fetchResult)
      );

      return fetchResult;
    },
  });
};

// For testing
Meteor.publishOriginal = Meteor.publish;
