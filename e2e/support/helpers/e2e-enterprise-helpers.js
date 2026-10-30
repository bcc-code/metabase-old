export const mockSessionPropertiesTokenFeatures = (features) => {
  cy.intercept({ method: "GET", url: "/api/session/properties" }, (request) => {
    request.on("response", (response) => {
      if (typeof response.body === "object") {
        response.body = {
          ...response.body,
          "token-features": {
            ...response.body["token-features"],
            ...features,
          },
        };
      }
    });
  });
};

// Gets an object that reflects a *partial* premium feature error - it must
// be a partial, otherwise we would need to have a stack trace in this error
// object.
export const getPartialPremiumFeatureError = (name) => ({
  cause: `${name} is not available on this instance.`,
  data: {
    "status-code": 402,
    status: "error-premium-feature-not-available",
  },
  message: `${name} is not available on this instance.`,
  status: "error-premium-feature-not-available",
});
