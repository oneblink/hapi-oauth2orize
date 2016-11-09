var Oauth2orize = require('oauth2orize');
var Boom = require('boom');
var Hoek = require('hoek');
var Url = require('url');

var internals = {
    defaults: {
        credentialsUserProperty: 'user'
    },
    OauthServer: null,
    settings: null
};

/*eslint camelcase: [1, {properties: "never"}]*/
exports.register = function (server, options, next) {

    // Need session support for transaction in authorization code grant
    server.dependency('yar');

    internals.settings = Hoek.applyToDefaults(internals.defaults, options);

    internals.OauthServer = Oauth2orize.createServer();

    server.expose('server'      , internals.OauthServer);
    server.expose('settings'    , internals.settings);
    server.expose('grant'       , internals.grant);
    server.expose('grants'      , Oauth2orize.grant);
    server.expose('exchange'    , internals.exchange);
    server.expose('exchanges'   , Oauth2orize.exchange);
    server.expose('authorize'   , internals.authorize);
    server.expose('decision'    , internals.decision);
    server.expose('token'       , internals.token);
    server.expose('errorHandler', internals.errorHandler);
    server.expose('oauthToBoom' , internals.oauthToBoom);
    server.expose('errors', {
        AuthorizationError: Oauth2orize.AuthorizationError,
        TokenError: Oauth2orize.TokenError
    });
    server.expose('serializeClient'   , internals.serializeClient);
    server.expose('deserializeClient' , internals.deserializeClient);

    // Catch raw Token/AuthorizationErrors and turn them into legit OAuthified Boom errors
    server.ext('onPreResponse', function (request, reply) {

        var response = request.response;

        var newResponse;

        // Catch raw Token/AuthorizationErrors and process them
        if (response instanceof Oauth2orize.TokenError ||
            response instanceof Oauth2orize.AuthorizationError) {

            newResponse = internals.oauthToBoom(response);
        }

        if (newResponse) {
            reply(newResponse);
        } else {
            reply.continue();
        }
    });

    next();
};

internals.grant = function (type, phase, fn) {

    internals.OauthServer.grant(type, phase, fn);
};

internals.exchange = function (type, exchange) {

    internals.OauthServer.exchange(type, exchange);
};

internals.errorHandler = function (options) {

    return internals.OauthServer.errorHandler(options);
};

internals.authorize = function (request, reply, callback, options, validate, immediate) {

    var express = internals.convertToExpress(request, reply);

    internals.OauthServer.authorize(options, validate, immediate)(express.req, express.res, function (err) {

        if (err) {
            internals.errorHandler({ mode: 'indirect' })(err, express.req, express.res,
            function () {

                internals.errorHandler({ mode: 'direct' })(err, express.req, express.res, console.log);
            });
        }

        callback(express.req, express.res);
    });

};

internals.decision = function (request, reply, options, parse) {

    var result;
    var express = internals.convertToExpress(request, reply);
    var handler = function (err) {

        if (err) {
            internals.errorHandler()(err, express.req, express.res, console.log);
        }
    };

    options = options || {};

    if (options && options.loadTransaction === false) {
        internals.OauthServer.decision(options, parse)(express.req, express.res, handler);
    } else {
        result = internals.OauthServer.decision(options, parse);
        result[0](express.req, express.res, function (err) {

            if (err) {
                console.log('Err2: ' + err);
            }
            result[1](express.req, express.res, handler);
        });
    }
};

internals.serializeClient = function (fn) {

    internals.OauthServer.serializeClient(fn);
};

internals.deserializeClient = function (fn) {

    internals.OauthServer.deserializeClient(fn);
};

internals.token = function (request, reply, options) {

    var express = internals.convertToExpress(request, reply);
    internals.OauthServer.token(options)(express.req, express.res, function (err) {

        if (err) {
            internals.errorHandler()(err, express.req, express.res, console.log);
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
    if (boomE.output.statusCode === 500 ||
        boomE.output.payload.error === 'server_error') {

        boomE.output.payload.error_description = origBoomMessage;
    }

    delete boomE.output.payload.message;
    delete boomE.output.payload.statusCode;

    return boomE;
};

internals.oauthToBoom = function (oauthError) {

    // These little bits of code are stolen from oauth2orize
    // to translate raw Token/AuthorizationErrors to OAuth2 style errors

    var newResponse = {};
    newResponse.error = oauthError.code || 'server_error';
    if (oauthError.message) {
        newResponse.error_description = oauthError.message;
    }
    if (oauthError.uri) {
        newResponse.error_uri = oauthError.uri;
    }

    // These little bits of code Boomify raw OAuth2 style errors
    newResponse = Boom.create(oauthError.status, null, newResponse);
    internals.transformBoomError(newResponse);

    return newResponse;
};

internals.convertToExpress = function (request, reply) {

    request.yar.lazy(true);

    var ExpressServer = {
        req: {
            session: request.yar,
            query: request.query,
            body: request.payload,
            user: Hoek.reach(request.auth.credentials, internals.settings.credentialsUserProperty || '',
                { default: request.auth.credentials })
        },
        res: {
            redirect: function (uri) {

                // map errors in URL to be similar to our custom Boom errors.
                var uriObj = Url.parse(uri, true);

                if (uriObj.query.error) {

                    // Hide detailed server error messages
                    if (uriObj.query.error === 'server_error') {
                        uriObj.query.error_description = 'An internal server error occurred';
                    }

                    uri = Url.format(uriObj);
                }

                reply.redirect(uri);
            },
            setHeader: function (header, value) {

                ExpressServer.headers.push([header, value]);
            },
            end: function (content) {

                // Transform errors to be handled as Boomers
                if (typeof content === 'string') {

                    var jsonContent;
                    try {
                        jsonContent = JSON.parse(content);
                    } catch (e) {
                        /* If we got a json error, ignore it.
                         * The oauth2orize's response just wasn't json.
                         */
                    }

                    // If we have a json response and it's an error, let's Boomify/normalize it!
                    if (jsonContent) {

                        if (jsonContent.error && this.statusCode) {

                            content = Boom.create(this.statusCode, null, jsonContent);

                            // Transform Boom error using jsonContent data attached to it
                            internals.transformBoomError(content);

                            // Now that we have a Boom object, we can let Hapi handle headers and status codes
                            ExpressServer.headers = [];
                            this.statusCode = null;

                        } else {
                            // Respond non-error content as a json object if it is json.
                            content = jsonContent;
                        }

                    }

                }

                var response = reply(content);

                // Non-boom error fallback
                ExpressServer.headers.forEach(function (element) {

                    response.header(element[0], element[1]);
                });

                if (this.statusCode) {
                    response.code(this.statusCode);
                }

            }
        },
        headers: []
    };

    return ExpressServer;
};

exports.register.attributes = {
    pkg: require('./package.json')
};
