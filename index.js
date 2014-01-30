'use strict';
// Load modules

var oauth2orize = require('oauth2orize');
var server = oauth2orize.createServer();
var Hapi = null;

// Declare internals

var internals = {
  defaults: {}
};

exports.register = function (plugin, options, next) {
  internals.setHapi(plugin.hapi);

  var settings = plugin.hapi.utils.applyToDefaults(internals.defaults, options);

  plugin.dependency('yar');
  plugin.expose('settings', settings);
  plugin.expose('grant', internals.grant);
  plugin.expose('grants', oauth2orize.grant);
  plugin.expose('exchange', internals.exchange);
  plugin.expose('exchanges', oauth2orize.exchange);
  plugin.expose('authorize', internals.authorize);
  plugin.expose('decision', internals.decision);
  plugin.expose('token', internals.token);
  plugin.expose('errorHandler', internals.errorHandler);
  plugin.expose('serializeClient', internals.serializeClient);
  plugin.expose('deserializeClient', internals.deserializeClient);

  next();
};

internals.setHapi = function (module) {
  Hapi = Hapi || module;
};

internals.grant = function (grant) {
  server.grant(grant);
};

internals.exchange = function (exchange) {
  server.exchange(exchange);
};

internals.authorize = function (request, callback, authorization) {
  var express = internals.convertToExpress(request);
  server.authorize(authorization)(express.req, express.res, function (err) {
    if (err) {
      console.log(err);
    }
    callback(express.req, express.res);
  });
};

internals.decision = function (request, options, parse) {
  var result,
    express = internals.convertToExpress(request),
    handler = function (err) {
      if (err) {
        console.log('Err1: ' + err);
      }
      console.log('Decision parsed');
    };
  options = options || {};
  if (options && options.loadTransaction === false) {
    server.decision(options, parse)(express.req, express.res, handler);
  } else {
    result = server.decision(options, parse);
    result[0](express.req, express.res, function (err) {
      if (err) {
        console.log('Err2: ' + err);
      }
      console.log('Transactionloader finished');
      result[1](express.req, express.res, handler);
    });
  }
};


internals.serializeClient = function (fn) {
  server.serializeClient(fn);
};

internals.deserializeClient = function (fn) {
  server.deserializeClient(fn);
};

internals.token = function () {
  server.token();
};

internals.errorHandler = function () {
  server.errorHandler();
};

internals.convertToExpress = function (request) {
  var server = {
    req: {
      session: request.session,
      query: request.query,
      body: request.payload
    },
    res: {
      redirect: function (uri) {
        request.reply.redirect(uri);
      }
    }
  };
  request.session.lazy(true);
  return server;
};
