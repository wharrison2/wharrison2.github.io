// Pascal's mugging: 20 seconds into a visit, a mysterious figure appears in the corner.
// Refusing only raises the stakes (one more arrow each time), up to three visits per session.

const REPO = "https://github.com/wharrison2/wharrison2.github.io";
const DELAY = 20_000;
const MAX_VISITS = 3;

const session = {
  get(key) { try { return sessionStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { sessionStorage.setItem(key, value); } catch { /* fine, just forgets */ } },
};

// The clock runs across page loads, so clicking around doesn't reset it.
let start = parseInt(session.get("mugging.start"), 10);
if (!start) {
  start = Date.now();
  session.set("mugging.start", String(start));
}
let visits = parseInt(session.get("mugging.visits"), 10) || 0;

function show() {
  if (visits >= MAX_VISITS || session.get("mugging.done")) return;
  const arrows = "^".repeat(3 + visits);
  const box = document.createElement("aside");
  box.className = "mugging";
  box.dataset.pcSkip = "";
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-label", "A mysterious figure");
  box.innerHTML = `
    <p>A mysterious figure approaches and claims they are the host of the simulation, and will create
    <span class="mugging-number">10${arrows}100</span> tortured digital minds unless you give this website a star on
    GitHub. What do you do?</p>
    <div class="mugging-choices">
      <a href="${REPO}" target="_blank" rel="noopener" data-choice="star">Star it</a>
      <button type="button" data-choice="refuse">Refuse</button>
    </div>`;
  box.addEventListener("click", (e) => {
    const choice = e.target.closest("[data-choice]")?.dataset.choice;
    if (!choice) return;
    visits += 1;
    session.set("mugging.visits", String(visits));
    if (choice === "star") session.set("mugging.done", "1");
    box.classList.add("leaving");
    setTimeout(() => box.remove(), 300);
    if (choice === "refuse") setTimeout(show, DELAY);
  });
  document.body.append(box);
}

// Only the first visit waits on the session clock; later ones are scheduled by "Refuse".
if (visits === 0) setTimeout(show, Math.max(0, DELAY - (Date.now() - start)));
else setTimeout(show, DELAY);
