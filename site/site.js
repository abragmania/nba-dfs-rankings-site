// The public site's page script, loaded before board.js: sends the page's /api calls to the browser stand-in, adds the time this copy
// was published to the header's stamps, and says so when this browser will not keep a visitor's changes.
import { installApi } from "./static-api.js";
import { onKeepFailure } from "./shim/fs.js";

installApi();
document.documentElement.classList.add("is-site");

const eastern = (iso) => {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" }).format(d);
};

// The header is redrawn whole on many events, so the stamp is put back whenever it has gone.
function showPublished(text) {
  const top = document.getElementById("top");
  if (!top) return;
  const ensure = () => {
    const stamps = top.querySelector(".stamps");
    if (!stamps || stamps.querySelector(".site-pub")) return;
    const el = document.createElement("span");
    el.className = "site-pub";
    el.textContent = "Published ";
    const b = document.createElement("b");
    b.textContent = `${text} ET`;
    el.append(b);
    stamps.append(el);
  };
  ensure();
  new MutationObserver(ensure).observe(top, { childList: true });
}

async function readMeta() {
  try {
    const r = await fetch(new URL("../baked/meta.json", import.meta.url), { cache: "no-cache" });
    const text = eastern((await r.json())?.publishedAt);
    if (text) showPublished(text);
  } catch (e) {
    console.warn("The published time could not be read:", e.message); // the page works without it
  }
}

onKeepFailure(() => {
  if (document.querySelector(".site-keep")) return;
  const el = document.createElement("div");
  el.className = "site-keep";
  el.textContent = "This browser is not keeping your changes: they last until this page is closed.";
  document.body.append(el);
});

readMeta();
