import { assert } from "chai";
import {
  findSubCache,
  getCachedSubHandle,
  isSubCacheDeprecated,
  addSubCache,
  removeSubCache,
  rewire$subsCache,
  restore as restoreSubsCacheModules,
} from "../subs-cache";
import {
  rewire as rewirePubSubLiteConfig,
  restore as restorePubSubLiteConfig,
} from "../../config";

describe("subsCache", function () {
  afterEach(function () {
    restoreSubsCacheModules();
    restorePubSubLiteConfig();
  });

  describe("addSubCache", function () {
    it("should successfully add new sub cache", function () {
      const testSubHandle = {};
      const testDurationMs = 1000;
      const testSubsCache = {};

      rewire$subsCache(testSubsCache);
      addSubCache({
        hashedSubArgs: "expected-hash",
        handle: testSubHandle,
        durationMs: testDurationMs,
      });

      assert.equal(testSubsCache["expected-hash"].handle, testSubHandle);
      assert.equal(testSubsCache["expected-hash"].durationMs, testDurationMs);
    });
  });

  describe("removeSubCache", function () {
    it("should successfully remove sub cache", function () {
      const testSubsCache = { "expected-hash": {} };
      rewire$subsCache(testSubsCache);
      removeSubCache("expected-hash");
      assert.isUndefined(testSubsCache["expected-hash"]);
    });
  });

  describe("findSubCache", function () {
    it("should throw error for invalid input", function () {
      assert.throws(findSubCache, "Match error: Expected string");
    });

    it("should return null for a non-existing identifier hash string", function () {
      const subCache = findSubCache("dummy-hash");
      assert.isNull(subCache);
    });

    it("should return the expected cache object", function () {
      rewire$subsCache({ "expected-hash": {} });
      const subCache = findSubCache("expected-hash");
      assert.isObject(subCache);
    });
  });

  describe("getCachedSubHandle", function () {
    it("should throw error for invalid input", function () {
      assert.throws(getCachedSubHandle, "Match error: Expected string");
    });

    it("should return null for a non-existing identifier hash string", function () {
      const subHandle = getCachedSubHandle("dummy-hash");
      assert.isNull(subHandle);
    });

    it("should return the expected sub handle", function () {
      const testHandle = {};
      rewire$subsCache({ "expected-hash": { handle: testHandle } });
      const subHandle = getCachedSubHandle("expected-hash");
      assert.equal(subHandle, testHandle);
    });
  });

  describe("isSubCacheDeprecated", function () {
    it("should throw error for invalid input", function () {
      assert.throws(isSubCacheDeprecated, "Match error: Expected string");
    });

    it("should throw error for a non-existing identifier hash string", function () {
      assert.throws(
        () => isSubCacheDeprecated("dummy-hash"),
        "Subscription cache not found"
      );
    });

    it("should always return true when subs cache is disabled", function () {
      rewirePubSubLiteConfig({ _subsCacheEnabled: false });
      const isDeprecated = isSubCacheDeprecated("dummy-hash");
      assert.isTrue(isDeprecated);
    });

    it("should return false when sub cache is still active", function () {
      rewire$subsCache({
        "expected-hash": { refreshedAt: new Date() },
      });
      const isDeprecated = isSubCacheDeprecated("expected-hash");
      assert.isFalse(isDeprecated);
    });

    it("should return true when sub cache is no longer active", function () {
      const sixMinsAgo = new Date();
      sixMinsAgo.setTime(sixMinsAgo.getTime() - 6 * 60 * 1000);

      rewire$subsCache({
        "expected-hash": { refreshedAt: sixMinsAgo },
      });
      const isDeprecated = isSubCacheDeprecated("expected-hash");
      assert.isTrue(isDeprecated);
    });

    it("should recognize the provided newDurationMs", function () {
      const sixMinsOffsetMs = 6 * 60 * 1000;
      const sixMinsAgo = new Date();
      sixMinsAgo.setTime(sixMinsAgo.getTime() - sixMinsOffsetMs);

      rewire$subsCache({
        "expected-hash": { refreshedAt: sixMinsAgo },
      });
      const isDeprecated = isSubCacheDeprecated(
        "expected-hash",
        sixMinsOffsetMs
      );
      assert.isFalse(isDeprecated);
    });
  });
});
