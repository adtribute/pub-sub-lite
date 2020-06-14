Package.describe({
  name: "maestroqadev:pub-sub-lite",
  version: "1.0.0",
  summary: "Lighter (Method-based) pub/sub for Meteor",
  git: "https://github.com/adtribute/pub-sub-lite",
  documentation: "README.md",
});

Package.onUse(function (api) {
  api.use(["ecmascript@0.14.3", "check@1.3.1"]);
  api.mainModule("client.js", "client");
  api.mainModule("server.js", "server");
});

Npm.depends({
  lodash: "4.17.15",
  "object-hash": "2.0.3",
});
