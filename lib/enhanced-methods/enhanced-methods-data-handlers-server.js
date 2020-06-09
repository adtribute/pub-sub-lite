/* eslint-disable no-underscore-dangle */
/* eslint-disable prefer-rest-params */

/*
  Detect cursor(s) returned by Meteor Method handlers and structure the data so that
  client can merge it into Minimongo automatically.
*/

import { Meteor } from 'meteor/meteor';
import _ from 'lodash';

Meteor.methodsEnhanced = function (methods) {
  Object.entries(methods).forEach(([name, func]) => {
    if (!_.isFunction(func))
      throw new Error("Method '" + name + "' must be a function");
    if (Meteor.server.method_handlers[name])
      throw new Error("A method named '" + name + "' is already defined");

    const enhancedHandler = function () {
      // Add a special marker to the method invocation context so that any mutations
      // happen during the invocation will be automatically reported to the caller.
      this.__PubSubLite__mutationUpdatesEnabled = true;

      const result = func.bind(this)(...arguments);
      const isSingleCursor = !!result?._publishCursor;
      const isArrayOfCursors =
        _.isArray(result) && result.every(cursor => cursor._publishCursor);

      // If the method handler returns cursor or array of cursors, we automatically
      // fetch and structure the data for auto Minimongo merging on the client-side
      if (isSingleCursor) {
        return {
          cacheMethodResultInMinimongo: true,
          [result._cursorDescription.collectionName]: result.fetch(),
        };
      }
      if (isArrayOfCursors) {
        const aggregatedResult = {
          cacheMethodResultInMinimongo: true,
        };
        result.forEach(cursor => {
          const { collectionName } = cursor._cursorDescription;
          aggregatedResult[collectionName] = [
            ...(aggregatedResult[collectionName] || []),
            ...cursor.fetch(),
          ];
        });
        return aggregatedResult;
      }

      return result;
    };

    Meteor.server.method_handlers[name] = enhancedHandler;
  });
};

// Meteor.applyEnhanced doesn't do anything special when called on the server-side
Meteor.applyEnhanced = Meteor.apply;
