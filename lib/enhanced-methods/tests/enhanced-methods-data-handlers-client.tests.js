import { assert } from "chai";

describe("Meteor.callEnhanced", function () {
  it("should be defined", function () {
    assert.isFunction(Meteor.callEnhanced);
  });
});

describe("Meteor.applyEnhanced", function () {
  it("should be defined", function () {
    assert.isFunction(Meteor.applyEnhanced);
  });
});
