// server/lib/log.js for the public site: the data folder is the stand-in's file names, and lines go to the console only.
export const ROOT = "/";
export const dataDir = () => "/data";
export const logDir = () => "/data/cache/logs";
export function log(level, msg, extra) {
  (level === "error" ? console.error : console.log)(`${level.toUpperCase()} ${msg}`, extra ?? "");
}
export const info = (m, e) => log("info", m, e);
export const warn = (m, e) => log("warn", m, e);
export const error = (m, e) => log("error", m, e);
