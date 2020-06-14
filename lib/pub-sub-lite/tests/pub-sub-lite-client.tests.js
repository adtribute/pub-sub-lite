import { assert } from "chai";

describe("Meteor.subscribeLite", function () {
  it("should be defined", function () {
    assert.isFunction(Meteor.subscribeLite);
  });

  it("should throw error when the provided name is invalid", function () {
    assert.throws(() => Meteor.subscribeLite(null), "invalid publication name");
  });

  it("should return a simulated sub handle", function () {
    const subHandle = Meteor.subscribeLite("test");
    assert.isString(subHandle.subscriptionId);
  });
});
