/*
 * Copyright (c) 2018, Okta, Inc. and/or its affiliates. All rights reserved.
 * The Okta software accompanied by this notice is provided pursuant to the Apache License, Version 2.0 (the "License.")
 *
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0.
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *
 * See the License for the specific language governing permissions and limitations under the License.
 */

/**
 * A simple web server that initializes the OIDC Middleware library with the
 * given options, and attaches route handlers for the example profile page
 * and logout functionality.
 */

const express = require("express");
const session = require("express-session");
const mustacheExpress = require("mustache-express");
const path = require("path");
const { ExpressOIDC } = require("@okta/oidc-middleware");

const templateDir = path.join(__dirname, "..", "common", "views");
const frontendDir = path.join(__dirname, "..", "common", "assets");

module.exports = function SampleWebServer(
  sampleConfig,
  extraOidcOptions,
  homePageTemplateName
) {
  const oidc = new ExpressOIDC(
    Object.assign(
      {
        issuer: sampleConfig.oidc.issuer,
        client_id: sampleConfig.oidc.clientId,
        client_secret: sampleConfig.oidc.clientSecret,
        appBaseUrl: sampleConfig.oidc.appBaseUrl,
        scope: sampleConfig.oidc.scope,
        testing: sampleConfig.oidc.testing,
      },
      extraOidcOptions || {}
    )
  );

  const app = express();

  app.use(
    session({
      secret: "this-should-be-very-random",
      resave: true,
      saveUninitialized: false,
    })
  );

  // Provide the configuration to the view layer because we show it on the homepage
  const displayConfig = Object.assign({}, sampleConfig.oidc, {
    clientSecret:
      "****" +
      sampleConfig.oidc.clientSecret.substr(
        sampleConfig.oidc.clientSecret.length - 4,
        4
      ),
  });

  app.locals.oidcConfig = displayConfig;

  // This server uses mustache templates located in views/ and css assets in assets/
  app.use("/assets", express.static(frontendDir));
  app.engine("mustache", mustacheExpress());
  app.set("view engine", "mustache");
  app.set("views", templateDir);

  app.use(oidc.router);

  app.get("/", (req, res) => {
    const template = homePageTemplateName || "home";
    const userinfo = req.userContext && req.userContext.userinfo;

    res.render(template, {
      isLoggedIn: !!userinfo,
      userinfo: userinfo,
    });
  });

  app.get("/profile", oidc.ensureAuthenticated(), (req, res) => {
    // Convert the userinfo object into an attribute array, for rendering with mustache
    const userinfo = req.userContext && req.userContext.userinfo;
    const attributes = Object.entries(userinfo);
    res.render("profile", {
      isLoggedIn: !!userinfo,
      userinfo: userinfo,
      attributes,
    });
  });

  app.get("/impersonate", (req, res) => {
    const tokenSet = req.userContext.tokens;
    const accessToken = tokenSet.access_token;
    const refreshToken = tokenSet.refresh_token;
    //console.log("Access token : " + accessToken);
    //console.log("Refresh token : " + refreshToken);

    // Send /delegate/init request to AWS API Gateway, then refresh tokens and render home page
    var request = require("request");
    var options = {
      method: "POST",
      url: "https://fo4ajcesi5.execute-api.eu-west-3.amazonaws.com/Deployed/delegate/init",
      headers: {
        Authorization: "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        delegation_target: "test.renaultimpersonation@yopmail.com",
      }),
    };

    request(options, function (error, response) {
      if (error) throw new Error(error);
      console.log("/delegate/init response : " + response.body);
      refreshTokens(refreshToken, req, res);
    });

    function refreshTokens(refreshToken, req, res) {
      //Use refresh token to get new token (target token)

      var client_id = sampleConfig.oidc.clientId;
      var client_secret = sampleConfig.oidc.clientSecret;
      var base64encoded = Buffer.from(client_id + ":" + client_secret).toString(
        "base64"
      );

      var options = {
        method: "POST",
        url: "https://lyvoc-oie-demo.oktapreview.com/oauth2/aus6zo3575li4046r1d7/v1/token",
        headers: {
          Accept: "application/json",
          Authorization: "Basic " + base64encoded,
          "Content-Type": "application/x-www-form-urlencoded",
          Cookie: "JSESSIONID=9A3E6F9B399710C7AF9FFB3E8D02A8AF",
        },
        form: {
          grant_type: "refresh_token",
          redirect_uri: "https://oidcdebugger.com/debug",
          scope: sampleConfig.oidc.scope,
          refresh_token: refreshToken,
        },
      };
      request(options, function (error, response) {
        if (error) throw new Error(error);
        console.log("Refresh response received");
        var jsonResponse = JSON.parse(response.body);
        var newAccessToken = jsonResponse.access_token;
        var newIdToken = jsonResponse.id_token;
        //console.log("New access token : " + newAccessToken);
        //console.log("New id token : " + newIdToken);

        //Decode access token to get user info
        var jwt = require("jsonwebtoken");
        var decoded = jwt.decode(newAccessToken, { complete: true });
        //console.log("Decoded access token : " + JSON.stringify(decoded));
        var targetUserInfos = decoded.payload.user_context;
        //console.log("Target User infos : " + targetUserInfos);

        //Update access token in session
        req.userContext.tokens.access_token = newAccessToken;
        //req.userContext.tokens.id_token = newIdToken;
        renderImpersonatePage(req, res, targetUserInfos);
      });
    }

    function renderHomePage(req, res) {
      //Render home page with new information
      const template = homePageTemplateName || "home";
      const userinfo = req.userContext && req.userContext.userinfo;

      res.render(template, {
        isLoggedIn: !!userinfo,
        userinfo: userinfo,
      });
    }

    function renderImpersonatePage(req, res, targetUserInfos) {
      //Render impersonate page
      const userinfo = req.userContext && req.userContext.userinfo;
      const attributes = Object.entries(userinfo);
      const targetAttributes = Object.entries(targetUserInfos);

      res.render("impersonate", {
        isLoggedIn: !!userinfo,
        userinfo: userinfo,
        attributes,
        targetAttributes,
      });
    }
  });

  oidc.on("ready", () => {
    // eslint-disable-next-line no-console
    app.listen(sampleConfig.port, () =>
      console.log(`App started on port ${sampleConfig.port}`)
    );
  });

  oidc.on("error", (err) => {
    // An error occurred with OIDC
    // eslint-disable-next-line no-console
    console.error("OIDC ERROR: ", err);

    // Throwing an error will terminate the server process
    // throw err;
  });
};
