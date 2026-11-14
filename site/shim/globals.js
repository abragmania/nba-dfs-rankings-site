// The two Node globals the app's own server.js reads, for the page (the build loads this before server.js). process.argv is
// empty, so server.js's start-the-app block never runs; Buffer.concat is the one Buffer call its body reader makes.
globalThis.process ??= { argv: [], env: {} };
globalThis.Buffer ??= {
  concat(chunks) {
    const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    return { toString: () => new TextDecoder().decode(all) };
  },
};
