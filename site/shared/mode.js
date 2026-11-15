// Professional or fun, asked at the start of every visit (the last answer is remembered and comes up highlighted).
// Fun mode switches on the gimmicks.
// Each page sets <html data-mode> from storage in an inline script first, so the styles don't flash.

import S from "../strings/shared.js";

const KEY = "site.mode";
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const root = document.documentElement;

function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

// Once answered, the question isn't asked again until the next visit (a new tab or browser session).
function askedThisVisit() {
  try { return sessionStorage.getItem("mode.asked") === "1"; } catch { return false; }
}
function markAsked() {
  try { sessionStorage.setItem("mode.asked", "1"); } catch { /* fine: it just asks again on the next page */ }
}

function save(mode) {
  markAsked();
  try { localStorage.setItem(KEY, mode); } catch { /* private window: keep it for this page only */ }
  root.dataset.mode = mode;
}

function startGimmicks() {
  // The home page becomes a terminal you explore the site from.
  if (document.querySelector(".page .intro")) import("./siteterm.js");
  if (root.dataset.paperclips !== "off") import("./paperclips.js");
  import("./mugging.js");
}

function labelToggles() {
  document.querySelectorAll("[data-mode-toggle]").forEach((button) => {
    button.textContent = root.dataset.mode === "fun" ? S.footer.to_professional : S.footer.to_fun;
  });
}

function ask() {
  const picker = document.createElement("div");
  picker.className = "mode-picker";
  picker.dataset.pcSkip = "";
  picker.innerHTML = `
    <div class="mode-picker-box" role="dialog" aria-modal="true" aria-labelledby="mode-picker-title">
      <h2 id="mode-picker-title">${esc(S.mode.question)}</h2>
      <div class="mode-picker-choices">
        <button type="button" data-choice="professional">${esc(S.mode.professional)}</button>
        <button type="button" data-choice="fun">${esc(S.mode.fun)}</button>
      </div>
      <p>${esc(S.mode.note)}</p>
    </div>`;
  picker.addEventListener("click", (e) => {
    const choice = e.target.closest("[data-choice]")?.dataset.choice;
    if (!choice) return;
    save(choice);
    labelToggles();
    picker.classList.add("leaving");
    setTimeout(() => picker.remove(), 300);
    if (choice === "fun") startGimmicks();
  });
  document.body.append(picker);
  (picker.querySelector(`[data-choice="${stored()}"]`) ?? picker.querySelector("button")).focus();
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-mode-toggle]")) return;
  const next = root.dataset.mode === "fun" ? "professional" : "fun";
  save(next);
  // Turning the gimmicks off mid-swarm is messy; a reload is the clean way out.
  if (next === "professional") location.reload();
  else { labelToggles(); startGimmicks(); }
});

// ?mode=fun or ?mode=professional skips the question (handy for links and screenshots).
const asked = new URLSearchParams(location.search).get("mode");
if (asked === "fun" || asked === "professional") save(asked);

const mode = stored();
const known = mode === "fun" || mode === "professional";
if (known && askedThisVisit()) {
  root.dataset.mode = mode;
  if (mode === "fun") startGimmicks();
} else {
  // The page keeps the last look underneath while it asks; nothing fun starts until they answer.
  root.dataset.mode = known ? mode : "";
  ask();
}
labelToggles();
