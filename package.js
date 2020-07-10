Package.describe({
  name: "maestroqadev:pub-sub-lite",
  version: "1.0.1",
  summary: "Lighter (Method-based) pub/sub for Meteor",
  git: "https://github.com/adtribute/pub-sub-lite",
  documentation: "README.md",
});

Package.onUse(function (api) {
  api.use(["ecmascript@0.14.3", "check@1.3.1"]);
  api.mainModule("client.js", "client");
  api.mainModule("server.js", "server");

  Npm.depends({
    lodash: "4.17.15",
    "object-hash": "2.0.3",
  });
});

Package.onTest(function (api) {
  api.use(["ecmascript", "check", "mongo", "meteortesting:mocha"]);
  api.use(["jquery", "blaze-html-templates"], "client");
  api.use("maestroqadev:pub-sub-lite");

  Npm.depends({
    lodash: "4.17.15",
    "object-hash": "2.0.3",
    chai: "4.2.0",
    "babel-plugin-rewire-exports": "2.2.0",
  });

  api.addFiles(
    [
      "./lib/pub-sub-lite/tests/pub-sub-lite-client.tests.js",
      "./lib/blaze/tests/blaze-template-subscribe-lite.tests.js",
      "./lib/caching/tests/subs-cache.tests.js",
      "./lib/caching/tests/method-calls-cache.tests.js",
      "./lib/enhanced-methods/tests/enhanced-methods-data-handlers-client.tests.js",
    ],
    "client"
  );
  api.addFiles(
    [
      "./lib/pub-sub-lite/tests/pub-sub-lite-server.tests.js",
      "./lib/enhanced-methods/tests/enhanced-methods-data-handlers-server.tests.js",
    ],
    "server"
  );
});
