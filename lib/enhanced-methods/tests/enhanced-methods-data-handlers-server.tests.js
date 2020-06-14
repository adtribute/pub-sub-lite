import { assert } from "chai";

describe("Meteor.methodsEnhanced", function () {
  it("should be defined", function () {
    assert.isFunction(Meteor.methodsEnhanced);
  });
});
