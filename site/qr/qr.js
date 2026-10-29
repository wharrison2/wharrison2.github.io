// QR code maker. The encoding comes from qrcode-generator (loaded as a global from a CDN);
// drawing, shapes and exports are here. The SVG is the single source: the PNG is that SVG rasterized.

const $ = (id) => document.getElementById(id);
const qrcode = window.qrcode;
qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

let current = null; // { svg, n } for the code on screen

function matrix(text, ecl) {
  const qr = qrcode(0, ecl); // 0: smallest version that fits
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return { n, dark: (r, c) => qr.isDark(r, c) };
}

// The three big corner squares. Scanners find the code by these, so they keep a solid shape in every style.
function inFinder(r, c, n) {
  return (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
}

// Centers of the smaller alignment squares for each version (QR spec, Annex E). Scanners lean on these
// too, so like the finders they're drawn whole instead of as dots.
const ALIGNMENT = [
  [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
  [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
  [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94], [6, 26, 50, 74, 98],
  [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114], [6, 34, 62, 90, 118],
  [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150],
  [6, 24, 50, 76, 102, 128, 154], [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
  [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
];

function alignmentCenters(n) {
  const list = ALIGNMENT[(n - 17) / 4];
  const centers = [];
  for (const r of list) for (const c of list) if (!inFinder(r, c, n)) centers.push([r, c]);
  return centers;
}

function roundedRect(x, y, w, h, rad) {
  return `M${x + rad} ${y}h${w - 2 * rad}a${rad} ${rad} 0 0 1 ${rad} ${rad}v${h - 2 * rad}a${rad} ${rad} 0 0 1 ${-rad} ${rad}` +
    `h${-(w - 2 * rad)}a${rad} ${rad} 0 0 1 ${-rad} ${-rad}v${-(h - 2 * rad)}a${rad} ${rad} 0 0 1 ${rad} ${-rad}z`;
}

function toSvg({ n, dark }, { shape, margin, fg, bg }) {
  const size = n + margin * 2;
  let d = "";
  const whole = new Set(); // alignment-pattern modules, drawn as shapes below
  const centers = shape === "square" ? [] : alignmentCenters(n);
  for (const [r, c] of centers) {
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) whole.add((r + dr) * n + c + dc);
  }
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!dark(r, c) || whole.has(r * n + c)) continue;
      const x = c + margin, y = r + margin;
      if (shape === "square" || inFinder(r, c, n)) {
        if (shape === "square") d += `M${x} ${y}h1v1h-1z`;
      } else if (shape === "rounded") {
        d += roundedRect(x + 0.05, y + 0.05, 0.9, 0.9, 0.32);
      } else {
        d += `M${x + 0.5} ${y + 0.05}a0.45 0.45 0 1 1 0 0.9a0.45 0.45 0 1 1 0 -0.9z`;
      }
    }
  }
  if (shape !== "square") {
    // Finders as an outlined rounded square around a rounded dot.
    for (const [r, c] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
      const x = c + margin, y = r + margin;
      d += roundedRect(x, y, 7, 7, 2) + roundedRect(x + 1, y + 1, 5, 5, 1.4) + roundedRect(x + 2, y + 2, 3, 3, 0.9);
    }
    for (const [r, c] of centers) {
      const x = c - 2 + margin, y = r - 2 + margin;
      d += roundedRect(x, y, 5, 5, 1.2) + roundedRect(x + 1, y + 1, 3, 3, 0.7) + roundedRect(x + 2, y + 2, 1, 1, 0.5);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="${shape === "square" ? "crispEdges" : "geometricPrecision"}">` +
    `<rect width="${size}" height="${size}" fill="${bg}"/><path fill="${fg}" fill-rule="evenodd" d="${d}"/></svg>`;
}

// WCAG contrast ratio, to warn about color pairs scanners struggle with.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function render() {
  const text = $("text").value;
  const options = {
    shape: $("shape").value,
    margin: Math.min(10, Math.max(0, parseInt($("margin").value, 10) || 0)),
    fg: $("fg").value,
    bg: $("bg").value,
  };
  const code = $("code");
  const buttons = ["png", "svg", "copy"].map($);
  if (!text) {
    current = null;
    code.className = "code error";
    code.textContent = "Type something to encode.";
    $("info").textContent = "";
    buttons.forEach((b) => { b.disabled = true; });
    return;
  }
  let m;
  try {
    m = matrix(text, $("ecl").value);
  } catch {
    current = null;
    code.className = "code error";
    code.textContent = "That's too long to fit in a QR code at this error correction. Try a lower level or shorter text.";
    $("info").textContent = "";
    buttons.forEach((b) => { b.disabled = true; });
    return;
  }
  const svg = toSvg(m, options);
  current = { svg, n: m.n };
  code.className = "code";
  code.innerHTML = svg;
  const bytes = new TextEncoder().encode(text).length;
  $("info").textContent = `Version ${(m.n - 17) / 4} · ${m.n}×${m.n} modules · ${bytes} byte${bytes === 1 ? "" : "s"}`;
  buttons.forEach((b) => { b.disabled = false; });

  const lf = luminance(options.fg), lb = luminance(options.bg);
  const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
  const warnings = [];
  if (ratio < 4) warnings.push("The colors are close in brightness; some scanners won't read this.");
  if (lf > lb) warnings.push("Light code on a dark background: many scanners only read dark-on-light.");
  if (options.margin < 2) warnings.push("A margin under 2 modules can make the code hard to pick out.");
  $("warning").hidden = !warnings.length;
  $("warning").textContent = warnings.join(" ");
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function png() {
  const size = parseInt($("size").value, 10);
  const img = new Image();
  const url = URL.createObjectURL(new Blob([current.svg], { type: "image/svg+xml" }));
  try {
    img.src = url;
    await img.decode();
    const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size });
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, size, size);
    return await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

$("form").addEventListener("input", render);
$("svg").addEventListener("click", () => download(new Blob([current.svg], { type: "image/svg+xml" }), "qr-code.svg"));
$("png").addEventListener("click", async () => download(await png(), "qr-code.png"));
$("copy").addEventListener("click", async () => {
  const button = $("copy");
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png() })]);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Couldn't copy";
  }
  setTimeout(() => { button.textContent = "Copy"; }, 1600);
});

render();
