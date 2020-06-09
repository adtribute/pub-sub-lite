# Intro

Meteor publications are very resource-intensive by nature. For every subscribed
client, Meteor create an [observer][observer-link] for tracking and sending 
real-time updates. Moreover, Meteor also maintains a copy of *each* client's data 
on the server-side (using [SessionCollectionView][session-collection-view-link]), 
which is used to decide which portion of data should be reactively sent to clients.
These features may put a huge load on server, especially at scale.

For this reason, publications should only be used when reactivity is essential
for a given use case. When reactivity is not essential, it is better to retrieve
data via a non-reactive fetch, such as a Meteor Method call.

However, using Method calls for fetching data has certain disadvantages:

- Switching an existing codebase from using pub/sub to using Methods usually
requires a lot of refactoring, especially on the client-side.

- Data retrieved from Methods is not merged into Minimongo, which means other
parts of the front-end cannot make use of this data.

- Each Method call will trigger a separate request from the front-end, resulting
in a separate invocation on the back-end. This means if a particular Method is
called repeatedly with the same arguments, we will end up wasting resources
processing and sending the same data multiple times.

- Without pub/sub, the changes made to documents during a mutation Method are
not sent to client. It will be impossible for the client to always reflect
these changes accurately, because there can be server-only logic that cannot
be simulated with optimistic updates on the client-side. We can refactor the
Method to manually return the changed documents and merge them to Minimongo, 
but that require a lot of custom code.

The *pub-sub-lite* package aims to solve these problems by providing:

- Easy-to-use helpers (`Meteor.publishLite` and `Meteor.subscribeLite`) that
can be used in place of `Meteor.publish` and `Meteor.subscribe`. No other change
is necessary. The original pub/sub will be converted to a Method call and the
result data will be merged to Minimongo automatically. `Meteor.subscribeLite`
also returns a handle that simulates the original subscription handle, which
means existing front-end code can be kept intact!

- Enhanced Methods (`Meteor.methodsEnhanced`, `Meteor.callEnhanced` and
`Meteor.applyEnhanced`):
  - Automatically merge result data into Minimongo.
  - Automatically sent document changes made during the Method invocation
  to the client-side caller.

- Caching layer:
  - Automatically deduplicate repeated calls of `Meteor.subscribeLite` and 
  `Meteor.callEnhanced/applyEnhanced`. Cache duration can be set globally
  or individually.
  - The result data of `Meteor.callEnhanced/applyEnhanced` is also cached
  and will be returned immediately when there is a cache hit. This eliminates 
  duplicated calls to the server while the original Method callback
  (`(error, result) => {...}`) still works normally.

# Use cases

*pub-sub-lite* will be useful when:
- You have used pub/sub predominantly in your codebase and now want to switch certain
parts to using Methods, without doing a lot of refactoring.
- You want to leverage the benefits of enhanced Methods (caching, Minimongo merging,
mutation updates emitting).

# How to use the package

## Installation

`meteor add npvn:pub-sub-lite`

## Converting existing pub/sub to Method

Because `Meteor.publishLite` and `Meteor.subscribeLite` have the same signature
and simulate the behaviours of the original `Meteor.publish` and `Meteor.subscribe`,
you usually do not need to refactor any existing code.

```js
Meteor.publishLite('booksAndAuthors', function(/* arguments */) {
  /* Your original publish handler can be kept intact */

  // `this.userId` is still defined if the caller is logged in
  const userId = this.userId;

  // `this.added` can still be used. The added document will be included in the
  // final result data.
  this.added('books', 'CvwRfPxAoXQFi4txC', attrs);

  // Other low-level publish API, including 'this.changed', 'this.removed', 'this.ready', 
  // 'this.onStop', 'this.error', and 'this.stop' will be disregarded, as they no longer
  // fit into the context of a Method-based data fetch.
  this.changed('books', 'CvwRfPxAoXQFi4txC', attrs); // no-op

  // As usual we can return a cursor or array of cursors. Any doc added with
  // `this.added` will also be include in the final result data set.
  return [Books.find(), Authors.find()];
});
```

```js
/* Your original subscription and front-end logic can be kept intact */

const subHandle = Meteor.subscribeLite('booksAndAuthors', argument1, argument2, {
  onStop(error) {
    // If provided, run when subHandle.stop() is called, or when an error occurs
    // during the Method invocation
  },
  onReady() {
    // If provided, run when the Method's result data has been received. 
    // Note: As with the original Meteor.subscribe signature, if the last
    // argument is a function, it will be interpreted as onReady.
  },
});

Tracker.autorun(function() {
  // subHandle.ready() will initially return false, and will return true once the
  // Method's result data has been received, re-triggering all reactive computations
  if (!subHandle.ready()) {
    console.log('Loading data...');
    return;
  }

  // Once ready, data can be accessed in Minimongo just like with a normal pub/sub 
  const books = Books.find().fetch();
  const authors = Authors.find().fetch();
});
```

## Enhanced Methods

If `Meteor.publishLite` and `Meteor.subscribeLite` are meant for quickly converting
legacy pub/sub code, enhanced Methods will power up your Meteor Methods.

### Minimongo data merging

`Meteor.methodsEnhanced` produces Methods that support automatic Minimongo merging: 
If your Method handler function returns a cursor or array of cursors, it will
be automatically restructured into a data format that can be merged into Minimongo
on the client-side.

```js
Meteor.methodsEnhanced({
  getBooksAndAuthors() {
    return [Books.find(), Authors.find()];
  }
});
```
```js
// On the client, use Meteor.callEnhanced / Meteor.applyEnhanced. Once arrived
// the data will be merged into Minimongo automatically, and can be accessed
// in the Books and Authors collections.
Meteor.callEnhanced('getBooksAndAuthors');

// You can also read the result data with a Method callback
Meteor.callEnhanced('getBooksAndAuthors', function(error, result) {
  if (result) console.log(result);
  /*
    Result data was restructured by Meteor.methodsEnhanced, and will be an object
    having this shape:
    {
      cacheMethodResultInMinimongo: true,
      books: [bookDocument1, bookDocument2],
      authors: [authorDocument1],
    }
  */
});
```

The data shape above is a *dictionary of collection names and their documents,
together with a `cacheMethodResultInMinimongo` boolean key* indicating that
this result data can be merged into Minimongo. In fact, instead of using
`Meteor.methodsEnhanced` on the server-side, you can use the original 
`Meteor.methods` and manually return the same dictionary shape. `Meteor.callEnhanced`
and `Meteor.applyEnhanced` will still be able to automatically merge the data
in that case.

### Emitting mutation update messages

Methods defined by `Meteor.methodsEnhanced` can also emit mutation update messages
to the Method caller on the client-side. These DDP messages will update Minimongo
automatically.

```js
Meteor.methodsEnhanced({
  setBestSellingAuthor(authorId) {
    if (Meteor.isServer) {
      // Server-only logic to calculate number of books sold
      const numberOfBooksSold = ...;
    }

    // The changes to this author document will be automatically reflected in
    // client-side Minimongo, without any pub/sub!
    Authors.update(authorId, { $set: { isBestSelling: true, numberOfBooksSold } });
  }
});
```

In the example code above, even though `isBestSelling` can be simulated on the
client-side with optimistic update, there is no way to determine `numberOfBooksSold`
because its calculation logic is server-only. Without pub/sub, we would have to
manually return `numberOfBooksSold` from our Method, and manually update this value
in Minimongo. Enhanced Methods automate this whole process.

Beside updated documents, enhanced Methods can also emit messages for inserted
and removed documents.

## Caching and Minimongo data merging

### Caching for `Meteor.subscribeLite`

By default, all `Meteor.subscribeLite` calls are cached for 5 minutes. This means
duplicated calls having *identical "publication name" and arguments* will not be
repeated. If there are subsequent calls having the same name but different arguments,
they will still be carried out normally.

The default cache duration can be set with `PubSubLite.setDefaultSubsCacheDurationMs`:

```js
import { PubSubLite } from 'meteor/npvn:pub-sub-lite';

// Setting default cache duration to one minute
PubSubLite.setDefaultSubsCacheDurationMs(1000 * 60);
```

Cache duration can also be set individually for each `Meteor.subscribeLite` and
will take priority over the default setting:

```js
Meteor.subscribeLite(name, argument1, argument2, {
  onStop() {...},
  onReady() {...},
  cacheDurationMs: 1000 * 60,
});
```

If you want to turn off caching, call `PubSubLite.disableSubsCache()` to disable
globally or set `cacheDurationMs` as `0` to disable for individual `Meteor.subscribeLite`.

### Caching for `Meteor.callEnhanced/applyEnhanced`

By default, all `Meteor.callEnhanced/applyEnhanced` calls are cached for 5 minutes.
Similar to the caching behaviour of `Meteor.subscribeLite`, Method calls having
identical Method name and arguments are deduplicated.

Methods caching duration can also be customized:

```js
import { PubSubLite } from 'meteor/npvn:pub-sub-lite';

// Set default Methods cache duration
PubSubLite.setDefaultMethodCallCacheDurationMs(1000 * 60);

// Disable Methods caching globally
PubSubLite.disableMethodCallCache();

// Set individual cache duration for Meteor.callEnhanced by adding an object having
// the cacheDurationMs key as the final argument, or the last argument before
// callback. Note that this object will be omitted and will not be counted
// as a Method argument.
Meteor.callEnhanced(
  name, argument1, argument2, { cacheDurationMs: 1000 * 60 }, callback
);

// Set individual cache duration for Meteor.applyEnhanced using the options object
Meteor.applyEnhanced(
  name, [argument1, argument2], {
    // cacheDurationMs can be defined alongside other apply options
    wait: true,
    throwStubExceptions: true,
    cacheDurationMs: 0, // turning off caching for this Method call
  }, callback
);
```

A powerful feature of enhanced Methods is that result data is also cached. This
means when a duplicated Method is called and there is a cache hit, the Method
will return immediately with the result data cached earlier.

```js
// A cache is registered the first time Method is called, including its result data
Meteor.callEnhanced(name, argument1, argument2, function(error, result) {...});

// When called again with identical arguments, the Method returns immediately
// (no request is sent to server)
Meteor.callEnhanced(name, argument1, argument2, function(error, result) {
  // `result` will be the result data retrieved during the first call
});
```

Furthermore, if the cached result data was merged to Minimongo as
[illustrated above](#minimongo-data-merging), it will be synced with Minimongo
before being returned:

```js
// Books and authors cached and merged into Minimongo
Meteor.callEnhanced('getBooksAndAuthors', function(error, result) {
  console.log(result);
  /*
    {
      cacheMethodResultInMinimongo: true,
      books: [...],
      authors: [{
        _id: 'NzrGsj9ooJnQwbDfZ',
        name: 'John',
        isBestSelling: false,
      }],
    }
  */
});

// Perform a mutation that set John's isBestSelling to true and update that value
// in Minimongo
Meteor.callEnhanced('setBestSellingAuthor', 'NzrGsj9ooJnQwbDfZ');

// Later when the first Method is called again, the previously saved data is synced
// with Minimongo before being returned
Meteor.callEnhanced('getBooksAndAuthors', function(error, result) {
  console.log(result);
  /*
    {
      cacheMethodResultInMinimongo: true,
      books: [...],
      authors: [{
        _id: 'NzrGsj9ooJnQwbDfZ',
        name: 'John',

        // We have the updated value, even though this second Method call was a
        // cache hit and never reached the server!
        isBestSelling: true,
      }],
    }
  */  
});
```

## Additional helpers

If your Method returns cursor(s) or data in the dictionary shape containing the
`cacheMethodResultInMinimongo` key, caching and result data merging with Minimongo
will be automatically carried out for you. In other cases, the package provides
helpers for handling custom data:

### `PubSubLite.cacheMethodResult`

This helper can cache Method data in any arbitrary values, and will not perform
Minimongo merging:

```js
Meteor.callEnhanced(name, argument1, argument2, function(error, result) {
  if (result) {
    PubSubLite.cacheMethodResult({
      name,
      args: [argument1, argument2],
      data: result,
      durationMs: 1000 * 60,
    });
  }
});
```

### `PubSubLite.cacheMethodResultInMinimongo`

This helper can cache and perform Minimongo merging for result data in the following format:
- A single document
- An array of documents
- Dictionary of collection names and their documents (in this case, it is better to attach the 
`cacheMethodResultInMinimongo` key to the dictionary and let everything handled automatically)

```js
Meteor.callEnhanced(name, argument1, argument2, function(error, result) {
  if (result) {
    PubSubLite.cacheMethodResultInMinimongo({
      name,
      args: [argument1, argument2],
      data: result,
      // When data is a document or array of documents, a collectionName must be provided
      collectionName: 'books',
      durationMs: 1000 * 60,
    });
  }
});
```

### `PubSubLite.mergeDataIntoMinimongo`

This helper makes it convenient to merge data from arbitrary sources (e.g. data
fetched via Apollo) into Minimongo. The data need to be structured as a dictionary
of collection names and their documents:

```js
const data = {
  books: [bookDocument1, bookDocument2],
  authors: [],
};
PubSubLite.mergeDataIntoMinimongo(data);
```

## Miscellaneous

### `publishComposite`

If you have existing [composite publications][publish-composite-link], simply replace
`publishComposite` with `Meteor.publishCompositeLite` to have the publication (and any child
publications) converted into a Method.

```js
Meteor.publishCompositeLite('authorsAndTheirBooks', {
    find() {
        return Authors.find();
    },
    children: [
        {
            find(author) {
                return Books.find({ authorId: author._id })
            }
        }
    ]
});
```
```js
Meteor.subscribeLite('authorsAndTheirBooks', function() {
  const authors = Authors.find().fetch();
  const books = Books.find().fetch();
});
```

### `ValidatedMethod`

To use *pub-sub-lite* with `ValidatedMethod`, replace `mdg:validated-method`
with `npvn:validated-method`. More information can be found [here][validated-method-link].

### Requirements for MongoDB Change Streams

The package uses MongoDB Change Streams to detect changes in update operations.
Because each stream may open a separate MongoDB connection, the package tries to
minimize the number of streams to at most `1` per collection. This means the
maximum number of streams opened at once is theoretically equal to the number of
collections.

The Node.js MongoDB driver sets the value to `5`. This value was set for legacy
reasons only, and is too small for the connections potentially opened by
*pub-sub-lite*. So the package sets this value to `100` by default (an arbitrary
number inspired by the default value in the Python MongoDB driver).

To customize this value, edit `mongoConnectionPoolSize` in the
`CUSTOM_HARD_CODED_CONFIG` object in [config.js](./lib/config.js).

Notes: 
- For the `mongoConnectionPoolSize` setting to work, *pub-sub-lite* must be 
above any other packages using Mongo connections in `.meteor/packages`, such
as `accounts-base` and its related packages (e.g. `accounts-password`).
- Change Streams require MongoDB 3.6.0 or newer and the db must be run as a
replica set.
- You will see warnings in the server console if these requirements are not met.

## Todos
- [ ] Tests
- [ ] Server-side data caching

[observer-link]: https://galaxy-guide.meteor.com/apm-improve-cpu-and-network-usage.html#How-Observers-are-Handled-in-Meteor

[session-collection-view-link]: https://github.com/meteor/meteor/blob/devel/packages/ddp-server/livedata_server.js#L106-L117

[publish-composite-link]: https://atmospherejs.com/reywood/publish-composite

[validated-method-link]: https://github.com/adtribute/validated-method