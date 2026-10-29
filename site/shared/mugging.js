// Pascal's mugging: 20 seconds into a visit, a mysterious figure appears in the corner, once per session.

const REPO = "https://github.com/wharrison2/wharrison2.github.io";
const DELAY = 20_000;

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
function show() {
  if (session.get("mugging.shown")) return;
  session.set("mugging.shown", "1");
  const box = document.createElement("aside");
  box.className = "mugging";
  box.dataset.pcSkip = "";
  box.setAttribute("role", "alertdialog");
  box.setAttribute("aria-label", "A mysterious figure");
  box.innerHTML = `
    <p>A mysterious figure approaches and claims they are the host of the simulation, and will create
    <span class="mugging-number">10^^^100</span> tortured digital minds unless you give this website a star on
    GitHub. What do you do?</p>
    <div class="mugging-choices">
      <a href="${REPO}" target="_blank" rel="noopener" data-choice="star">Star it</a>
      <button type="button" data-choice="refuse">Refuse</button>
    </div>`;
  box.addEventListener("click", (e) => {
    const choice = e.target.closest("[data-choice]")?.dataset.choice;
    if (!choice) return;
    box.classList.add("leaving");
    setTimeout(() => box.remove(), 300);
  });
  document.body.append(box);
}

if (!session.get("mugging.shown")) setTimeout(show, Math.max(0, DELAY - (Date.now() - start)));
