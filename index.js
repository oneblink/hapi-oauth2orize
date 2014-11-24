'use strict';

var oauth2orize = require('oauth2orize');
var Hoek = require('hoek');
var Url = require('url');

var internals = {
      defaults: {
        credentialsUserProperty: 'user'
      }
    },
    server,
    settings,
    Hapi;

exports.register = function (plugin, options, next) {

  internals.setHapi(plugin.hapi);

  settings = Hoek.applyToDefaults(internals.defaults, options);

  server = oauth2orize.createServer();

  // Need session support for transaction in authorization code grant
  plugin.dependency('yar');

  // Catch raw Token/AuthorizationErrors and turn them into legit OAuthified Boom errors
  plugin.ext('onPreResponse', function (request, reply) {

    var response = request.response;

    var newResponse;

    // Catch raw Token/AuthorizationErrors and process them
    if (response instanceof oauth2orize.TokenError ||
        response instanceof oauth2orize.AuthorizationError) {

      // These little bits of code are stolen from oauth2orize
      // to translate raw Token/AuthorizationErrors to OAuth2 style errors
      newResponse = {};
      newResponse.error = response.code || 'server_error';
      if (response.message) {
        newResponse.error_description = response.message;
      }
      if (response.uri) {
        newResponse.error_uri = response.uri;
      }

      // These little bits of code Boomify raw OAuth2 style errors
      newResponse = Hapi.boom.create(response.status, null, newResponse);
      internals.transformBoomError(newResponse);

    }

    if (newResponse) {
      reply(newResponse);
    } else {
      reply();
    }
  });

  plugin.expose('server'    , server);
  plugin.expose('settings'    , settings);
  plugin.expose('grant'       , internals.grant);
  plugin.expose('grants'      , oauth2orize.grant);
  plugin.expose('exchange'    , internals.exchange);
  plugin.expose('exchanges'   , oauth2orize.exchange);
  plugin.expose('authorize'   , internals.authorize);
  plugin.expose('decision'    , internals.decision);
  plugin.expose('token'       , internals.token);
  plugin.expose('errorHandler', internals.errorHandler);
  plugin.expose('errors', {
    AuthorizationError  : oauth2orize.AuthorizationError,
    TokenError          : oauth2orize.TokenError
  });
  plugin.expose('serializeClient'   , internals.serializeClient);
  plugin.expose('deserializeClient' , internals.deserializeClient);

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

internals.errorHandler = function (options) {
  return server.errorHandler(options);
};

internals.authorize = function (request, reply, callback, options, validate, immediate) {
  var express = internals.convertToExpress(request, reply);

  server.authorize(options, validate, immediate)(express.req, express.res, function (err) {

    if (err) {
      internals.errorHandler({ mode: 'indirect' })(err, express.req, express.res,

          // if indirect gets nixed, handle it directly
          function (err, express) {
            return function () {
              internals.errorHandler({ mode: 'direct' })(err, express.req, express.res, console.log);
            }
          }(err, express)
      );
    }

    callback(express.req, express.res);
  });

};

internals.decision = function (request, reply, options, parse) {
  var result,
      express = internals.convertToExpress(request, reply),
      handler = function (err) {
        if (err) {
          internals.errorHandler()(err, express.req, express.res, console.log);
        }
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

internals.token = function (request, reply, options) {
  var express = internals.convertToExpress(request, reply);
  server.token(options)(express.req, express.res, function (err) {
    if (err) {
      internals.errorHandler()(err, express.req, express.res, console.log)
    }
  });
};

// Takes in a Boom error and a oauth2orize error, and makes a custom Boom error to spec.
internals.transformBoomError = function (boomE, authE) {

  if (!boomE.isBoom) {
    return boomE;
  }

  var overrides = authE || boomE.data || {};

  Hoek.merge(boomE.output.payload, overrides);

  var origBoomMessage = boomE.output.payload.message;

  if (!boomE.output.payload.error_description && boomE.output.payload.message) {
    boomE.output.payload.error_description = boomE.output.payload.message;
  }

  // Hide server errors however Boom does it
  if (boomE.output.statusCode == 500 ||
      boomE.output.payload.error == "server_error") {

    boomE.output.payload.error_description = origBoomMessage;
  }

  delete boomE.output.payload.message;
  delete boomE.output.payload.statusCode;

  return boomE;
};

internals.convertToExpress = function (request, reply) {
  request.session.lazy(true);

  var server = {
    req: {
      session: request.session,
      query: request.query,
      body: request.payload,
      user: Hoek.reach(request.auth.credentials, settings.credentialsUserProperty || '',
          { default: request.auth.credentials })
    },
    res: {
      redirect: function (uri) {

        // map errors in URL to be similar to our custom Boom errors.
        var uriObj = Url.parse(uri, true);

        if (uriObj.query.error) {

          // Hide detailed server error messages
          if (uriObj.query.error == "server_error") {
            uriObj.query.error_description = "An internal server error occurred";
          }

          uri = Url.format(uriObj);

        }

        reply.redirect(uri);

      },
      setHeader: function (header, value) {
        server.headers.push([header, value]);
      },
      end: function (content) {

        // Transform errors to be handled as Boomers
        if (typeof content == "string") {

          var jsonContent;
          try {
            jsonContent = JSON.parse(content);
          } catch (e) {/* If we got a json error, ignore it.  The oauth2orize's response just wasn't json.*/
          }

          // If we have a json response and it's an error, let's Boomify/normalize it!
          if (jsonContent) {

            if (jsonContent.error && this.statusCode) {

              content = Hapi.boom.create(this.statusCode, null, jsonContent);

              // Transform Boom error using jsonContent data attached to it
              internals.transformBoomError(content);

              // Now that we have a Boom object, we can let Hapi handle headers and status codes
              server.headers = [];
              this.statusCode = null;

            } else {
              // Respond non-error content as a json object if it is json.
              content = jsonContent;
            }

          }

        }

        var response = reply(content);

        // Non-boom error fallback
        server.headers.forEach(function (element) {
          response.header(element[0], element[1]);
        });

        if (this.statusCode) {
          response.code(this.statusCode);
        }

      }
    },
    headers: []
  };

  return server;
};

exports.register.attributes = require('./package.json');