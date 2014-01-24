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
  plugin.api('settings', settings);
  //plugin.api('oauth2orize', oauth2orize);
  plugin.api('grant', internals.grant);
  plugin.api('grants', oauth2orize.grant);
  plugin.api('exchange', internals.exchange);
  plugin.api('exchanges', oauth2orize.exchange);
  plugin.api('authorize', internals.authorize);
  plugin.api('decision', internals.decision);
  plugin.api('token', internals.token);
  plugin.api('errorHandler', internals.errorHandler);
  plugin.api('serializeClient', internals.serializeClient);
  plugin.api('deserializeClient', internals.deserializeClient);

  //plugin.ext('onPreAuth', [
    //internals.fixSessions()
  //], {
    //after: 'yar'
  //})


  //server.serializeClient(function (client, done) {
    //done(null, client.id);
  //});

  //server.deserializeClient(function (id, done) {
    //done(null, id);
  //});

  next();
};

internals.setHapi = function (module) {
  Hapi = Hapi || module;
};

// Fix Sessions
//internals.fixSessions = function () {
  //return function (request, next) {
  //}
//};


// Sanitize the oauth2orize functions
internals.grant = function (grant) {
  server.grant(grant);
};

internals.exchange = function (exchange) {
  server.exchange(exchange);
};

internals.authorize = function (request, callback, authorization) {
  //console.log(request);
  var express = internals.convertToExpress(request);
  //console.log(express);
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
