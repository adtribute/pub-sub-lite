/* globals Package, Blaze */
/* eslint-disable no-underscore-dangle */

import { Match } from 'meteor/check';

Meteor.startup(() => {
  if (Package.blaze) {
    // Mostly duplicated logic from the original templateInstance.subscribe,
    // except that view.subscribeLite is called instead.
    Blaze.TemplateInstance.prototype.subscribeLite = function (...args) {
      const self = this;
      const subHandles = self._subscriptionHandles;

      // Duplicate logic from Meteor.subscribe
      let options = {};
      if (args.length) {
        const lastParam = _.last(args);

        // Match pattern to check if the last arg is an options argument
        const lastParamOptionsPattern = {
          onReady: Match.Optional(Function),
          // XXX COMPAT WITH 1.0.3.1 onError used to exist, but now we use
          // onStop with an error callback instead.
          onError: Match.Optional(Function),
          onStop: Match.Optional(Function),
          connection: Match.Optional(Match.Any),
        };

        if (_.isFunction(lastParam)) {
          options.onReady = args.pop();
        } else if (
          lastParam &&
          !_.isEmpty(lastParam) &&
          Match.test(lastParam, lastParamOptionsPattern)
        ) {
          options = args.pop();
        }
      }

      let subHandle;
      const oldStopped = options.onStop;
      options.onStop = function (error) {
        // When the subscription is stopped, remove it from the set of tracked
        // subscriptions to avoid this list growing without bound
        delete subHandles[subHandle.subscriptionId];

        // Removing a subscription can only change the result of subscriptionsReady
        // if we are not ready (that subscription could be the one blocking us being
        // ready).
        if (!self._allSubsReady) {
          self._allSubsReadyDep.changed();
        }

        if (oldStopped) {
          oldStopped(error);
        }
      };

      const { connection } = options;
      const callbacks = _.pick(options, ['onReady', 'onError', 'onStop']);

      // The callbacks are passed as the last item in the arguments array passed to
      // View#subscribe
      args.push(callbacks);

      // View#subscribe takes the connection as one of the options in the last
      // argument
      subHandle = self.view.subscribeLite.call(self.view, args, {
        connection,
      });

      if (!_.has(subHandles, subHandle.subscriptionId)) {
        subHandles[subHandle.subscriptionId] = subHandle;

        // Adding a new subscription will always cause us to transition from ready
        // to not ready, but if we are already not ready then this can't make us
        // ready.
        if (self._allSubsReady) {
          self._allSubsReadyDep.changed();
        }
      }

      return subHandle;
    };

    // For testing
    Package.blaze.Blaze.TemplateInstance.prototype.subscribeOriginal =
      Package.blaze?.Blaze.TemplateInstance.prototype.subscribe;
  }
});
