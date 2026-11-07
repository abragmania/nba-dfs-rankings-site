// node:worker_threads for the app's own build runner (server/lineup/build-run.js) on the public site: its Worker, its progress
// messages, its Stop and its ten-minute ceiling all run unchanged, on a browser module worker (../opt-worker.js) in place of the
// thread. The worker's source text and url from build-run.js are not used: opt-worker.js does what that text does.
export class Worker {
  constructor(_source, { workerData }) {
    this.handlers = {};
    this.worker = new globalThis.Worker(new URL("../opt-worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = (e) => this.handlers.message?.(e.data);
    this.worker.onerror = (e) => { e.preventDefault?.(); this.handlers.error?.(new Error(e.message || "The browser could not run the optimizer in the background.")); };
    this.worker.onmessageerror = () => this.handlers.error?.(new Error("The optimizer sent a message the page could not read."));
    this.worker.postMessage(workerData.args);
  }
  on(event, fn) { this.handlers[event] = fn; }
  terminate() {
    this.worker.terminate();
    return Promise.resolve(1);
  }
}
