/* globals Package, Blaze */
/* eslint-disable no-param-reassign */
/* eslint-disable no-underscore-dangle */

Meteor.startup(async () => {
  if (Package.blaze) {
    const {
      default: { Blaze },
    } = await import('meteor/blaze');

    // Mostly duplicated logic from the original view.subscribe, except that
    // Meteor.subscribeLite is called instead.
    Blaze.View.prototype.subscribeLite = function (args, options) {
      const self = this;
      options = options || {};

      self._errorIfShouldntCallSubscribe();

      let subHandle;
      if (options.connection) {
        subHandle = options.connection.subscribeLite.bind(options.connection)(
          ...args
        );
      } else {
        subHandle = Meteor.subscribeLite(...args);
      }

      self.onViewDestroyed(function () {
        subHandle.stop();
      });

      return subHandle;
    };
  }
});
