// node:path for the app's own code on the public site: forward slashes only, as the stand-in's file names are.
function normal(parts) {
  const out = [];
  for (const seg of parts.join("/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out;
}
const join = (...parts) => `${parts[0]?.startsWith("/") ? "/" : ""}${normal(parts).join("/")}`;
const resolve = (...parts) => `/${normal(parts).join("/")}`;
const dirname = (p) => { const at = p.lastIndexOf("/"); return at <= 0 ? "/" : p.slice(0, at); };
const extname = (p) => { const m = /\.[^./]*$/.exec(p); return m ? m[0] : ""; };

export default { join, resolve, dirname, extname, sep: "/" };
