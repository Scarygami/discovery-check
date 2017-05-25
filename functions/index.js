const admin = require('firebase-admin');
const functions = require('firebase-functions');
const request = require('request-promise');
const stringify = require('json-stable-stringify');

const secret = 'your-secret-key';

admin.initializeApp(functions.config().firebase);

/**
 * Create a firebase friendly key
 */
function cleanKey(name) {
  return name.replace(/[\.\$\#\[\]\/\"]/g, '_');
}

/**
 * Fetches the Discovery API document for an API and updates data
 * in the Firebase database if there have been changes
 */
function handleApi(discoveryApi) {
  var cleanApi;
  var cleanVersion;
  var cleanRevision;
  var doc;
  var db = admin.database();

  // Fetch discovery documentation
  return request({
    uri: discoveryApi.discoveryRestUrl,
    json: true
  }).then((response) => {
    doc = response;
    cleanApi = cleanKey(doc.name);
    cleanVersion = cleanKey(doc.version);
    cleanRevision = cleanKey(doc.revision || doc.etag);

    // Fetch current status from Firebase to compare against
    return db.ref('apis').child(cleanApi).child('versions').child(cleanVersion).once('value');
  }).then((snapshot) => {
    var fbVersion = snapshot.val();

    if (fbVersion && fbVersion.latest === cleanRevision) {
      return 'No changes: ' + cleanApi + ' ' + cleanVersion;
    }
    var newVersion = !fbVersion;

    var now = (new Date()).toISOString();

    var api = {
      name: doc.name,
      title: doc.title,
      description: doc.description
    };

    // Update the base API description
    return db.ref('apis').child(cleanApi).update(api).then(function () {
      var version = {
        name: doc.name,
        version: doc.version,
        title: doc.title,
        description: doc.description,
        latest: cleanRevision,
        updated: now
      };
      if (newVersion) {
        version.discovered = now;
      }

      if (doc.documentationLink) {
        version.documentation = doc.documentationLink;
      }

      // Update the version info
      return db.ref('apis').child(cleanApi)
                           .child('versions')
                           .child(cleanVersion)
                           .update(version);
    }).then(() => {
      var revision = {};
      revision[cleanRevision] = now;

      // Update the revision info
      return db.ref('apis').child(cleanApi)
                           .child('versions')
                           .child(cleanVersion)
                           .child('revisions')
                           .update(revision);
    }).then(() => {
      // Store the discovery doc for diffs
      return db.ref('apiDocs').child(cleanApi)
                              .child(cleanVersion)
                              .child(cleanRevision)
                              .set(stringify(doc));
    }).then(() => {
      return 'Updated: ' + cleanApi + ' ' + cleanVersion;
    });
  }).catch((error) => {
    throw new Error(
      'Error updating ' + cleanApi + ' ' + cleanVersion + ' - ' + error.message
    );
  });
}

exports.updateDocs = functions.https.onRequest((req, res) => {
  if (!req.query || req.query.secret !== secret) {
    res.status(200).send('Hello world!');
    return;
  }

  // Get list of all available APIs
  request({
    uri: 'https://www.googleapis.com/discovery/v1/apis',
    json: true
  }).then((response) => {
    // Check all the APIs and update the DB as necessary
    Promise.all(
      response.items.map(handleApi)
    ).then((apiData) => {
      res.status(200).send(JSON.stringify(apiData));
    }).catch((error) => {
      var msg = 'Error handling APIs: ' + error.message;
      res.status(500).send(msg);
    });
  }).catch((error) => {
    var msg = 'Error fetching discovery list: ' + error.message;
    res.status(500).send(msg);
  });
});
