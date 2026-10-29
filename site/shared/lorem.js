// Placeholder text, so layouts can be judged before the real copy exists.
// Put data-lorem on an element: "w6" fills it with 6 words, "s2" with 2 sentences, "p3" with 3 paragraphs.
// Add "t" for Title Case ("w4t"). The text is seeded by the element's position, so reloads don't reshuffle it.

const WORDS = (
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et " +
  "dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea " +
  "commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur " +
  "excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum " +
  "praesent vitae nunc mauris viverra integer morbi tristique senectus netus fames turpis egestas " +
  "pellentesque habitant aenean mattis faucibus ornare suspendisse potenti porta lectus quam felis arcu " +
  "cursus risus sagittis lacinia vehicula gravida placerat semper"
).split(" ");

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const capitalize = (w) => w[0].toUpperCase() + w.slice(1);

export function words(n, rng = Math.random) {
  return Array.from({ length: n }, () => WORDS[Math.floor(rng() * WORDS.length)]);
}

export function sentence(rng = Math.random) {
  const list = words(between(rng, 7, 16), rng);
  // An occasional comma somewhere in the middle, as in real sentences.
  if (list.length > 9 && rng() < 0.6) list[between(rng, 3, list.length - 4)] += ",";
  return capitalize(list.join(" ")) + ".";
}

export function paragraph(rng = Math.random) {
  return Array.from({ length: between(rng, 3, 6) }, () => sentence(rng)).join(" ");
}

export function fill(root = document) {
  root.querySelectorAll("[data-lorem]").forEach((el, i) => {
    const spec = el.dataset.lorem;
    const match = /^([wsp])(\d+)(t?)$/.exec(spec);
    if (!match) return;
    const [, kind, count, title] = match;
    const n = parseInt(count, 10);
    const rng = mulberry32((el.dataset.loremSeed ? parseInt(el.dataset.loremSeed, 10) : i * 7919) + n);
    if (kind === "p") {
      el.replaceChildren(...Array.from({ length: n }, () => {
        const p = document.createElement("p");
        p.textContent = paragraph(rng);
        return p;
      }));
      return;
    }
    let text = kind === "w"
      ? words(n, rng).join(" ")
      : Array.from({ length: n }, () => sentence(rng)).join(" ");
    if (title) text = text.split(" ").map(capitalize).join(" ");
    else if (kind === "w") text = capitalize(text);
    el.textContent = text;
  });
}

fill();
