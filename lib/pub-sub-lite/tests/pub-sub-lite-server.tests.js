import { assert } from "chai";

describe("Meteor.publishLite", function () {
  afterEach(function () {
    delete Meteor.server.method_handlers["test-publication"];
  });

  it("should be defined", function () {
    assert.isFunction(Meteor.publishLite);
  });

  it("should throw error when the provided name is invalid", function () {
    assert.throws(() => Meteor.publishLite(false), "Invalid arguments");
  });

  it("should throw error for null publications", function () {
    assert.throws(
      () => Meteor.publishLite(null),
      "You should use Meteor.publish() for null publications"
    );
  });

  it("should define a new Meteor Method instead of a publication", function () {
    Meteor.publishLite("test-publication", () => {});
    assert.isFunction(Meteor.server.method_handlers["test-publication"]);
    assert.isUndefined(Meteor.server.publish_handlers["test-publication"]);
  });
});

describe("Meteor.publishCompositeLite", function () {
  afterEach(function () {
    delete Meteor.server.method_handlers["test-publication"];
  });

  it("should be defined", function () {
    assert.isFunction(Meteor.publishCompositeLite);
  });

  it("should throw error when the provided name is invalid", function () {
    assert.throws(() => Meteor.publishCompositeLite(false), "invalid name");
  });

  it("should throw error for null publications", function () {
    assert.throws(() => Meteor.publishCompositeLite(null), "invalid name");
  });

  it("should throw error if the provided options is invalid", function () {
    assert.throws(
      () => Meteor.publishCompositeLite("test-publication", null),
      "invalid 'options' argument"
    );
  });

  it("should throw error if the provided options object literal does not contain a find() method", function () {
    assert.throws(
      () => Meteor.publishCompositeLite("test-publication", {}),
      "must contain a find() method"
    );
  });

  it("should define a new Meteor Method instead of a publication", function () {
    Meteor.publishCompositeLite("test-publication", () => {});
    assert.isFunction(Meteor.server.method_handlers["test-publication"]);
    assert.isUndefined(Meteor.server.publish_handlers["test-publication"]);
  });
});
