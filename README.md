hapi-oauth2orize
===

Note, this documentation is out of date.  This project is currently being brought into the present.  The most useful things to look at are currently the documentation/examples for [OAuth2orize](https://github.com/jaredhanson/oauth2orize) and [the OAuth2orize methods that are exposed by the plugin](https://github.com/devinivy/hapi-oauth2orize/blob/e468a9ab1c55bef43b63a411f82bb3bef21b8b7e/index.js#L28).

---
A bridge between [hapi8](https://github.com/hapijs/hapi) and [OAuth2orize](https://github.com/jaredhanson/oauth2orize)

OAuth2orize? It's an OAuth provider implemented as a middleware for express. Given that you are (presumably) using Hapi, you will need a bridge to make it work in Hapi land. Thus, Immigration.

Usage
---

`npm install immigration --save`

After this, the usage is similar to to using vanilla [OAuth2orize](https://github.com/jaredhanson/oauth2orize), but with a couple of tweaks to ensure compatiblity with Hapi (2.x series).

    // Require the plugin in Hapi
    server.require(['immigration'], function (err) {
      console.log(err);
    });
    
    var oauth = server.plugins['immigration'];
    
Disclaimer
---
The code below is extracted from a working, but incomplete project. It has not been secured, or even fully finished. However, along with the [OAuth2orize](https://github.com/jaredhanson/oauth2orize) docs, you should be able to create a working implementation of your own.
    
Implicit Grant Flow
---
    oauth.grant(oauth.grants.token(function (client, user, ares, done) {
      server.helpers.insert('token', {
        client: client._id,
        principal: user._id,
        scope: ares.scope,
        created: Date.now(),
        expires_in: 3600
      }, function (token) {
        done(null, token._id, {expires_in: token.expires_in});
      });
    }));

Authorization Code Exchange Flow
---
	  oauth.grant(oauth.grants.code(function (client, redirectURI, user, ares, done) {
	    server.helpers.insert('code', {
	      client: client._id,
	      principal: user._id,
	      scope: ares.scope,
	      redirectURI: redirectURI
	    }, function (code) {
	      done(null, code._id);
	    });
	  }));
	
	  oauth.exchange(oauth.exchanges.code(function (client, code, redirectURI, done) {
	    server.helpers.find('code', code, function (code) {
	      if (!code || client.id !== code.client || redirectURI !== code.redirectURI) {
	        return done(null, false);
	      }
	      server.helpers.insert('refreshToken', {
	        client: code.client,
	        principal: code.principal,
	        scope: code.scope
	      }, function (refreshToken) {
	        server.helpers.insert('token', {
	          client: code.client,
	          principal: code.principal,
	          scope: code.scope,
	          created: Date.now(),
	          expires_in: 3600
	        }, function (token) {
	          server.helpers.remove('code', code._id, function () {
	            done(null, token._id, refreshToken._id, {expires_in: token.expires_in});
	          });
	        });
	      });
	    });
	  }));
	
	  oauth.exchange(oauth.exchanges.refreshToken(function (client, refreshToken, scope, done) {
	    server.helpers.find('refreshToken', refreshToken, function (refreshToken) {
	      if (refreshToken.client !== client._id) {
	        return done(null, false, { message: 'This refresh token is for a different client'});
	      }
	      scope = scope || refreshToken.scope;
	      server.helpers.insert('token', {
	        client: client._id,
	        principal: refreshToken.principal,
	        scope: scope,
	        created: Date.now(),
	        expires_in: 3600
	      }, function (token) {
	        done(null, token._id, null, {expires_in: token.expires_in});
	      });
	    });
	  }));
	
	  // Client Serializers
	  oauth.serializeClient(function (client, done) {
	    done(null, client._id);
	  });
	
	  oauth.deserializeClient(function (id, done) {
	    server.helpers.find('client', id, function (client) {
	      done(null, client[0]);
	    });
	  });
	};

OAuth Endpoints
---
    server.route([{
        method: 'GET',
        path: '/oauth/authorize',
        handler: authorize
    },{
        method: 'POST',
        path: '/oauth/authorize/decision',
        handler: decision
    },{
        method: 'POST',
        path: '/oauth/token',
        handler: token
    }]);
    
    function authorize(request, reply) {
      oauth.authorize(request, reply, function (req, res) {
        reply.view('oauth', {transactionID: req.oauth2.transactionID});
      }, function (clientID, redirect, done) {
        server.helpers.find('client', clientID, function (docs) {
          done(null, docs[0], docs[0].redirect_uri);
        });
      });
    };

    function decision(request, reply) {
        oauth.decision(request, reply);
    };

    function token(request, reply) {
      oauth.authorize(function (clientID, redirect, done) {
        done(null, clientID, redirect);
      });
    };
