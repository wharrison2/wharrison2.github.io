// Professional or fun, picked on the first visit and remembered. Fun mode switches on the gimmicks.
// Each page sets <html data-mode> from storage in an inline script first, so the styles don't flash.

const KEY = "site.mode";
const root = document.documentElement;

function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

function save(mode) {
  try { localStorage.setItem(KEY, mode); } catch { /* private window: keep it for this page only */ }
  root.dataset.mode = mode;
}

function startGimmicks() {
  if (root.dataset.paperclips !== "off") import("./paperclips.js");
  import("./mugging.js");
}

function labelToggles() {
  document.querySelectorAll("[data-mode-toggle]").forEach((button) => {
    const other = root.dataset.mode === "fun" ? "professional" : "fun";
    button.textContent = `Switch to ${other} mode`;
  });
}

function ask() {
  const picker = document.createElement("div");
  picker.className = "mode-picker";
  picker.dataset.pcSkip = "";
  picker.innerHTML = `
    <div class="mode-picker-box" role="dialog" aria-modal="true" aria-labelledby="mode-picker-title">
      <h2 id="mode-picker-title">Professional or fun?</h2>
      <div class="mode-picker-choices">
        <button type="button" data-choice="professional">Professional</button>
        <button type="button" data-choice="fun">Fun</button>
      </div>
      <p>You can switch at the bottom of any page.</p>
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
  picker.querySelector("button").focus();
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

const mode = stored() ?? (asked === "fun" || asked === "professional" ? asked : null);
if (mode === "fun" || mode === "professional") {
  root.dataset.mode = mode;
  if (mode === "fun") startGimmicks();
} else {
  root.dataset.mode = "";
  ask();
}
labelToggles();
