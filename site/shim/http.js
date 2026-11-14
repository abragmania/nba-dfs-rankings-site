// node:http for the app's own makeServer on the public site: it hands back the request handler, which the stand-in calls with its
// own request and answer objects (static-api.js). Nothing listens anywhere.
export default { createServer: (handler) => ({ handler }) };
