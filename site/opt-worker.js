// One optimizer build in a browser module worker, started by shim/worker-threads.js: the same search as the app's worker thread
// (server/lineup/build-run.js WORKER_SRC), the same messages back.
import { optimize } from "../server/lineup/optimize.js";

self.onmessage = (event) => {
  try {
    self.postMessage({ ok: true, result: optimize({ ...event.data, onProgress: (progress) => self.postMessage({ progress }) }) });
  } catch (e) {
    self.postMessage({ ok: false, message: String(e?.message ?? e) });
  }
};
