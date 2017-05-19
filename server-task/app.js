'use strict';

var express = require('express');
var request = require('request-promise');
var promise = require('bluebird');
var stringify = require('json-stable-stringify');

// Setup up App Engine logging
var winston = require('winston');
require('winston-gae');

var logger = new winston.Logger({
  levels: winston.config.GoogleAppEngine.levels,
  transports: [
    new winston.transports.GoogleAppEngine({
      level: 'emergency'
    })
  ]
});

// Initialize connection to Firebase DB
var firebase = require('firebase-admin');
var serviceAccount = require('./firebase-serviceaccount.json');

firebase.initializeApp({
  credential: firebase.credential.cert(serviceAccount),
  databaseURL: 'https://your-firebase.firebaseio.com',
  databaseAuthVariableOverride: {
    uid: 'serviceaccount'
  }
});

function handleApi(discoveryApi) {
  var cleanApi;
  var cleanVersion;
  var cleanRevision;
  var doc;
  var db = firebase.database();

  function cleanKey(name) {
    return name.replace(/[\.\$\#\[\]\/\"]/g, '_');
  }

  // Fetch discovery documentation
  return request({
    uri: discoveryApi.discoveryRestUrl,
    json: true
  }).then(function (response) {
    doc = response;
    cleanApi = cleanKey(doc.name);
    cleanVersion = cleanKey(doc.version);
    cleanRevision = cleanKey(doc.revision || doc.etag);

    // Fetch current status from Firebase to compare against
    return db.ref('apis').child(cleanApi).child('versions').child(cleanVersion).once('value');

  }).then(function (snapshot) {
    var fbVersion = snapshot.val();

    if (fbVersion && fbVersion.latest === cleanRevision) {
      return 'No changes: ' + cleanApi + ' ' + cleanVersion;
    }

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

      if (doc.documentationLink) {
        version.documentation = doc.documentationLink;
      }

      // Update the version info
      return db.ref('apis').child(cleanApi)
                           .child('versions')
                           .child(cleanVersion)
                           .update(version);
    }).then(function () {
      var revision = {};
      revision[cleanRevision] = now;

      // Update the revision info
      return db.ref('apis').child(cleanApi)
                           .child('versions')
                           .child(cleanVersion)
                           .child('revisions')
                           .update(revision);
    }).then(function () {
      // Store the discovery doc for diffs
      return db.ref('apiDocs').child(cleanApi)
                              .child(cleanVersion)
                              .child(cleanRevision)
                              .set(stringify(doc));
    }).then(function () {
      return 'Updated: ' + cleanApi + ' ' + cleanVersion;
    });
  }).catch(function (error) {
    throw new Error(
      'Error updating ' + cleanApi + ' ' + cleanVersion + ' - ' + error.message
    );
  });
}

var app = express();

app.get('/update_firebase', function (req, res) {
  // Get list of all available APIs
  request({
    uri: 'https://www.googleapis.com/discovery/v1/apis',
    json: true
  }).then(function (response) {
    // Check all the APIs and update the DB as necessary
    promise.all(
      response.items.map(handleApi)
    ).then(function (apiData) {
      res.status(200).send(JSON.stringify(apiData));
    }).catch(function (error) {
      var msg = 'Error handling APIs: ' + error.message;
      logger.error(msg);
      res.status(500).send(msg);
    });
  }).catch(function (error) {
    var msg = 'Error fetching discovery list: ' + error.message;
    logger.error(msg);
    res.status(500).send(msg);
  });
});

// Start the server
var server = app.listen(process.env.PORT || '8080', function () {
  console.log('App listening on port %s', server.address().port);
  console.log('Press Ctrl+C to quit.');
});
