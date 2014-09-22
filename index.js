'use strict';
// Load modules

var oauth2orize = require('oauth2orize');
var Hoek = require('hoek');
var Url = require('url');
var server = oauth2orize.createServer();
var Hapi = null;

// Declare internals

var internals = {
  defaults: {}
};

exports.register = function (plugin, options, next) {
  internals.setHapi(plugin.hapi);

  var settings = Hoek.applyToDefaults(internals.defaults, options);

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

internals.errorHandler = server.errorHandler;

internals.authorize = function (request, reply, callback, options, validate, immediate) {
  var express = internals.convertToExpress(request, reply);
  
  server.authorize(options, validate, immediate)(express.req, express.res, function (err) {
    
    if (err) {
      internals.errorHandler({mode: 'indirect'})(err, express.req, express.res, console.log);
    }
    
    callback(express.req, express.res);
  });
  
};

internals.decision = function (request, reply, options, parse) {
  var result,
    express = internals.convertToExpress(request, reply),
    handler = function (err) {
      console.log(err);
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

internals.convertToExpress = function (request, reply) {
  request.session.lazy(true);
  var server = {
    req: {
      session: request.session,
      query: request.query,
      body: request.payload,
      user: request.auth.credentials ? request.auth.credentials.user : null
    },
    res: {
      redirect: function (uri) {
        
        // map errors in URL to be similar to Boom errors.
        uriObj = Url.parse(uri, true);
        
        if (uriObj.query.error) {
          
          // Hide detailed server error messages
          if (uriObj.query.error == "server_error") {
            uriObj.query.message = "An internal server error occurred";
          }
          
          // Use `message` property name like Boom
          if (uriObj.query.error_description) {
            uriObj.query.message = uriObj.query.error_description;
            delete uriObj.query.error_description;
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
          
          try {
            
            var jsonContent = JSON.parse(content);
            
            if (jsonContent.error && this.statusCode) {
              
              content = Hapi.boom.create(this.statusCode, jsonContent.error_description);
              
              // Now that we have a Boom object, we can let hapi handle headers and status codes
              server.headers = [];
              this.statusCode = null;
              
            }
            
            
          } catch(e) {}
          
        }
        
        var response = reply(content);
        
        // Non-boom error fallback
        server.headers.forEach(function (element) {
          response.header(element[0], element[1]);
        });
        
        if (this.statusCode) {
          response.code(this.statusCode);
        }
        
      },
    },
    headers: []
  };
  return server;
};

exports.register.attributes = require('./package.json');
