import { assert } from "chai";
import {
  addMethodCallCache,
  removeMethodCallCache,
  getActiveMethodCallCache,
  updateMethodCallCacheDurationMs,
  rewire$methodCallsCache,
  restore as restoreMethodCallsCacheModule,
} from "../method-calls-cache";
import {
  rewire as rewirePubSubLiteConfig,
  restore as restorePubSubLiteConfig,
} from "../../config";

describe("methodCallsCache", function () {
  afterEach(function () {
    restoreMethodCallsCacheModule();
    restorePubSubLiteConfig();
  });

  describe("addMethodCallCache", function () {
    it("should successfully add new method call cache", function () {
      const testMethodCallsCache = {};
      const testData = {};
      const testDurationMs = 1000;

      rewire$methodCallsCache(testMethodCallsCache);
      addMethodCallCache({
        hashedMethodCallArgs: "expected-hash",
        data: testData,
        durationMs: testDurationMs,
      });

      assert.equal(testMethodCallsCache["expected-hash"].data, testData);
      assert.equal(
        testMethodCallsCache["expected-hash"].durationMs,
        testDurationMs
      );
    });
  });

  describe("removeMethodCallCache", function () {
    it("should successfully remove method call cache", function () {
      const testMethodCallsCache = { "expected-hash": {} };
      rewire$methodCallsCache(testMethodCallsCache);
      removeMethodCallCache("expected-hash");
      assert.isUndefined(testMethodCallsCache["expected-hash"]);
    });
  });

  describe("getActiveMethodCallCache", function () {
    it("should return null for a non-existing identifier hash string", function () {
      const methodCallCache = getActiveMethodCallCache("dummy-hash");
      assert.isNull(methodCallCache);
    });

    it("should return null when method calls caching is disabled", function () {
      rewirePubSubLiteConfig({ _methodCallCacheEnabled: false });
      const methodCallCache = getActiveMethodCallCache("dummy-hash");
      assert.isNull(methodCallCache);
    });

    it("should return an active method call cache", function () {
      rewire$methodCallsCache({
        "expected-hash": { lastCalledAt: new Date() },
      });
      const methodCallCache = getActiveMethodCallCache("expected-hash");
      assert.isObject(methodCallCache);
    });

    it("should return null when method call cache is no longer active", function () {
      const sixMinsAgo = new Date();
      sixMinsAgo.setTime(sixMinsAgo.getTime() - 6 * 60 * 1000);

      rewire$methodCallsCache({
        "expected-hash": { lastCalledAt: sixMinsAgo },
      });

      const methodCallCache = getActiveMethodCallCache("expected-hash");
      assert.isNull(methodCallCache);
    });

    it("should recognize the provided newDurationMs", function () {
      const sixMinsOffsetMs = 6 * 60 * 1000;
      const sixMinsAgo = new Date();
      sixMinsAgo.setTime(sixMinsAgo.getTime() - sixMinsOffsetMs);

      rewire$methodCallsCache({
        "expected-hash": { lastCalledAt: sixMinsAgo },
      });
      const methodCallCache = getActiveMethodCallCache(
        "expected-hash",
        sixMinsOffsetMs
      );
      assert.isObject(methodCallCache);
    });
  });

  describe("updateMethodCallCacheDurationMs", function () {
    it("should successfully update durationMs of an existing method call cache", function () {
      const testMethodCallsCache = { "expected-hash": { durationMs: 1000 } };
      rewire$methodCallsCache(testMethodCallsCache);
      updateMethodCallCacheDurationMs("expected-hash", 2000);
      assert.equal(testMethodCallsCache["expected-hash"].durationMs, 2000);
    });
  });
});
