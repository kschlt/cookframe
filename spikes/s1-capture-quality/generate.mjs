/**
 * CFV1-S1 — synthetic fixture generator for the image-capture quality gate.
 *
 * Every recipe here is SELF-AUTHORED (invented for this spike — no cookbook, no
 * personal recipe), so ground truth is exact and nothing copyrightable or private
 * enters the public repo (S1 constraint / proof: capture-quality/public-fixture-provenance).
 *
 * Each fixture renders a full recipe to a PNG under a class-specific visual
 * treatment that makes it a genuine stressor — angle, glare, shadow, low contrast,
 * blur, tiny text, multi-column — because a crisp HTML render would be trivially
 * OCR-able and the gate would pass vacuously (the failure mode the S1 spec warns
 * of). It writes, per fixture: <id>.png, <id>.truth.json (the ground truth), and
 * a combined manifest.json (class + origin + paths) the scorer reads.
 *
 * Run: node spikes/s1-capture-quality/generate.mjs
 * (uses the globally-installed Playwright + the pre-installed Chromium).
 */
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import pw from "/opt/node22/lib/node_modules/playwright/index.js"

const { chromium } = pw
const HERE = dirname(fileURLToPath(import.meta.url))
const FIX = join(HERE, "fixtures")

// ---- the self-authored recipes + their ground truth + class treatment --------
// truth shape mirrors what the capture subagent must output (see run prompt).

const FIXTURES = [
  {
    id: "01-clean",
    class: "clean page",
    origin: "self-authored",
    treatment: {},
    truth: {
      title: "Lemon Herb Butter Beans",
      yields: ["serves 4"],
      times: { prep: "10 min", cook: "15 min", total: "25 min" },
      temperatures: [],
      ingredients: [
        { name: "butter beans", quantity: "400", unit: "g", group: null },
        { name: "olive oil", quantity: "2", unit: "tbsp", group: null },
        { name: "lemon", quantity: "1", unit: null, group: null },
        { name: "parsley", quantity: "20", unit: "g", group: null },
        { name: "garlic", quantity: "2", unit: "cloves", group: null },
      ],
      instructions: [
        "Drain and rinse the butter beans.",
        "Warm the olive oil and soften the garlic.",
        "Add the beans and the juice of the lemon.",
        "Stir through the chopped parsley and serve.",
      ],
      split_reserved: [],
      nutrition: {},
      classifications: {},
    },
  },
  {
    id: "02-angled",
    class: "angled photo",
    origin: "self-authored",
    treatment: { rotate: "-11deg", perspective: 650, rotateX: "34deg", blur: 0.9, lowContrast: true },
    truth: {
      title: "Smoky Tomato Lentils",
      yields: ["serves 3"],
      times: { prep: "5 min", cook: "20 min", total: "25 min" },
      temperatures: [],
      ingredients: [
        { name: "red lentils", quantity: "200", unit: "g", group: null },
        { name: "smoked paprika", quantity: "1", unit: "tsp", group: null },
        { name: "chopped tomatoes", quantity: "400", unit: "g", group: null },
        { name: "vegetable stock", quantity: "500", unit: "ml", group: null },
      ],
      instructions: [
        "Toast the smoked paprika in a dry pan.",
        "Add the lentils, tomatoes and stock.",
        "Simmer until the lentils are soft.",
      ],
      split_reserved: [],
      nutrition: {},
      classifications: {},
    },
  },
  {
    id: "03-glare-shadow",
    class: "glare and shadow",
    origin: "self-authored",
    treatment: { glare: true, glareHard: true, shadow: true, blur: 0.9, lowContrast: true },
    truth: {
      title: "Charred Corn Salad",
      yields: ["serves 4"],
      times: { prep: "10 min", cook: "8 min", total: "18 min" },
      temperatures: [],
      ingredients: [
        { name: "corn cobs", quantity: "3", unit: null, group: null },
        { name: "red onion", quantity: "1", unit: null, group: null },
        { name: "lime", quantity: "1", unit: null, group: null },
        { name: "coriander", quantity: "15", unit: "g", group: null },
      ],
      instructions: [
        "Char the corn cobs and slice off the kernels.",
        "Finely dice the red onion.",
        "Toss with lime juice and coriander.",
      ],
      split_reserved: [],
      nutrition: {},
      classifications: {},
    },
  },
  {
    id: "04-multi-column",
    class: "multi-column layout",
    origin: "self-authored",
    treatment: { columns: true, blur: 0.3 },
    truth: {
      title: "Weeknight Veg Curry",
      yields: ["serves 4"],
      times: { prep: "15 min", cook: "25 min", total: "40 min" },
      temperatures: [],
      ingredients: [
        { name: "sweet potato", quantity: "500", unit: "g", group: null },
        { name: "chickpeas", quantity: "400", unit: "g", group: null },
        { name: "coconut milk", quantity: "400", unit: "ml", group: null },
        { name: "curry paste", quantity: "3", unit: "tbsp", group: null },
        { name: "spinach", quantity: "100", unit: "g", group: null },
      ],
      instructions: [
        "Peel and cube the sweet potato.",
        "Fry the curry paste for one minute.",
        "Add the sweet potato and coconut milk and simmer.",
        "Stir in the chickpeas and spinach until wilted.",
      ],
      split_reserved: [],
      nutrition: {},
      classifications: {},
    },
  },
  {
    id: "05-ingredient-groups",
    class: "ingredient groups",
    origin: "self-authored",
    treatment: { blur: 0.3 },
    truth: {
      title: "Falafel with Quick Tahini",
      yields: ["makes 16"],
      times: { prep: "20 min", cook: "12 min", total: "32 min" },
      temperatures: [],
      ingredients: [
        { name: "dried chickpeas", quantity: "250", unit: "g", group: "For the falafel" },
        { name: "cumin", quantity: "1", unit: "tsp", group: "For the falafel" },
        { name: "parsley", quantity: "30", unit: "g", group: "For the falafel" },
        { name: "tahini", quantity: "3", unit: "tbsp", group: "For the sauce" },
        { name: "lemon juice", quantity: "2", unit: "tbsp", group: "For the sauce" },
      ],
      instructions: [
        "Blend the soaked chickpeas with cumin and parsley.",
        "Shape into balls and fry until golden.",
        "Whisk the tahini with lemon juice and water.",
      ],
      split_reserved: [],
      nutrition: {},
      classifications: {},
    },
  },
  {
    id: "06-fractions",
    class: "fractions",
    origin: "self-authored",
    treatment: { blur: 0.4 },
    truth: {
      title: "Buttermilk Pancakes",
      yields: ["makes 8"],
      times: { prep: "10 min", cook: "10 min", total: "20 min" },
      temperatures: [],
      ingredients: [
        { name: "flour", quantity: "1 1/2", unit: "cups", group: null },
        { name: "sugar", quantity: "1/4", unit: "cup", group: null },
        { name: "baking powder", quantity: "1/2", unit: "tsp", group: null },
        { name: "buttermilk", quantity: "1 1/4", unit: "cups", group: null },
        { name: "butter", quantity: "1/3", unit: "cup", group: null },
      ],
      instructions: [
        "Whisk the dry ingredients.",
        "Stir in the buttermilk and melted butter.",
        "Cook spoonfuls until bubbles form, then flip.",
      ],
      split_reserved: [],
      nutrition: {},
      classifications: {},
    },
  },
  {
    id: "07-ranges",
    class: "ranges",
    origin: "self-authored",
    treatment: { blur: 0.4 },
    truth: {
      title: "Slow-Roast Tomatoes",
      yields: ["serves 4 to 6"],
      times: { prep: "10 min", cook: "2 to 3 hours", total: "2 to 3 hours" },
      temperatures: ["120-140 °C"],
      ingredients: [
        { name: "tomatoes", quantity: "800", unit: "g", group: null },
        { name: "olive oil", quantity: "2 to 3", unit: "tbsp", group: null },
        { name: "thyme", quantity: "4 to 5", unit: "sprigs", group: null },
      ],
      instructions: [
        "Halve the tomatoes and arrange cut-side up.",
        "Drizzle with oil and scatter the thyme.",
        "Roast low and slow until collapsed but not dry.",
      ],
      split_reserved: [],
      nutrition: {},
      classifications: {},
    },
  },
  {
    id: "08-split-reserved",
    class: "split and reserved instructions",
    origin: "self-authored",
    treatment: { blur: 0.3 },
    truth: {
      title: "Herby Mushroom Tart",
      yields: ["serves 6"],
      times: { prep: "20 min", cook: "25 min", total: "45 min" },
      temperatures: ["200 °C"],
      ingredients: [
        { name: "mushrooms", quantity: "300", unit: "g", group: null },
        { name: "puff pastry", quantity: "1", unit: "sheet", group: null },
        { name: "creme fraiche", quantity: "150", unit: "g", group: null },
        { name: "chives", quantity: "10", unit: "g", group: null },
      ],
      instructions: [
        "Slice the mushrooms.",
        "Cook 200 g of the mushrooms with the creme fraiche; keep 100 g raw for the top.",
        "Spread over the pastry, add the reserved mushrooms, and bake.",
      ],
      split_reserved: [{ use: "200 g mushrooms", reserve: "100 g mushrooms" }],
      nutrition: {},
      classifications: {},
    },
  },
  {
    id: "09-small-metadata",
    class: "small metadata text",
    origin: "self-authored",
    treatment: { metaTiny: true, tinyPx: 7, lowContrast: true, blur: 0.55 },
    truth: {
      title: "Ginger Miso Broth",
      yields: ["serves 2"],
      times: { prep: "8 min", cook: "12 min", total: "20 min" },
      temperatures: [],
      ingredients: [
        { name: "miso paste", quantity: "2", unit: "tbsp", group: null },
        { name: "ginger", quantity: "15", unit: "g", group: null },
        { name: "spring onions", quantity: "3", unit: null, group: null },
        { name: "tofu", quantity: "200", unit: "g", group: null },
      ],
      instructions: [
        "Simmer the grated ginger in water.",
        "Whisk in the miso off the heat.",
        "Add cubed tofu and sliced spring onions.",
      ],
      split_reserved: [],
      nutrition: {},
      classifications: {},
    },
  },
  {
    id: "10-ambiguous-units",
    class: "ambiguous units",
    origin: "self-authored",
    treatment: { blur: 0.4 },
    truth: {
      title: "Store-Cupboard Chili",
      yields: ["serves 4"],
      times: { prep: "10 min", cook: "25 min", total: "35 min" },
      temperatures: [],
      ingredients: [
        { name: "kidney beans", quantity: "1", unit: "can", group: null },
        { name: "garlic", quantity: "1", unit: "clove", group: null },
        { name: "salt", quantity: "1", unit: "pinch", group: null },
        { name: "butter", quantity: "1", unit: "stick", group: null },
        { name: "chili flakes", quantity: "1", unit: "handful", group: null },
      ],
      instructions: [
        "Melt the butter and soften the garlic.",
        "Add the drained beans and chili flakes.",
        "Season with a pinch of salt and simmer.",
      ],
      split_reserved: [],
      nutrition: {},
      classifications: {},
    },
  },
  {
    id: "11-multiple-yields",
    class: "multiple yields",
    origin: "self-authored",
    treatment: { blur: 0.3 },
    truth: {
      title: "Oat Banana Muffins",
      yields: ["makes 12 muffins", "serves 6"],
      times: { prep: "15 min", cook: "20 min", total: "35 min" },
      temperatures: ["180 °C"],
      ingredients: [
        { name: "oats", quantity: "200", unit: "g", group: null },
        { name: "bananas", quantity: "3", unit: null, group: null },
        { name: "eggs", quantity: "2", unit: null, group: null },
        { name: "honey", quantity: "3", unit: "tbsp", group: null },
      ],
      instructions: [
        "Mash the bananas and beat in the eggs and honey.",
        "Fold in the oats.",
        "Divide between muffin cases and bake.",
      ],
      split_reserved: [],
      nutrition: {},
      classifications: {},
    },
  },
  {
    id: "12-nutrition",
    class: "source-provided nutrition",
    origin: "self-authored",
    treatment: { blur: 0.3 },
    truth: {
      title: "Protein Power Bowl",
      yields: ["serves 2"],
      times: { prep: "15 min", cook: "10 min", total: "25 min" },
      temperatures: [],
      ingredients: [
        { name: "quinoa", quantity: "150", unit: "g", group: null },
        { name: "edamame", quantity: "120", unit: "g", group: null },
        { name: "avocado", quantity: "1", unit: null, group: null },
      ],
      instructions: [
        "Cook the quinoa and let it cool.",
        "Steam the edamame.",
        "Assemble with sliced avocado.",
      ],
      split_reserved: [],
      nutrition: { calories: "480 kcal", protein: "22 g", fat: "19 g", carbohydrate: "54 g" },
      classifications: {},
    },
  },
  {
    id: "13-classifications",
    class: "source-provided classifications",
    origin: "self-authored",
    treatment: { blur: 0.3 },
    truth: {
      title: "Simple Dal",
      yields: ["serves 4"],
      times: { prep: "10 min", cook: "30 min", total: "40 min" },
      temperatures: [],
      ingredients: [
        { name: "red lentils", quantity: "250", unit: "g", group: null },
        { name: "turmeric", quantity: "1", unit: "tsp", group: null },
        { name: "cumin seeds", quantity: "1", unit: "tsp", group: null },
      ],
      instructions: [
        "Simmer the lentils with turmeric until soft.",
        "Temper the cumin seeds in oil and stir through.",
      ],
      split_reserved: [],
      nutrition: {},
      classifications: { cuisine: "Indian", diet: "vegan", difficulty: "easy" },
    },
  },
]

// ---- HTML rendering ----------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])

function ingredientLine(i) {
  const qty = [i.quantity, i.unit].filter(Boolean).join(" ")
  return `<li>${qty ? `<span class="q">${esc(qty)}</span> ` : ""}${esc(i.name)}</li>`
}

function recipeHtml(t, treat) {
  const groups = [...new Set(t.ingredients.map((i) => i.group).filter(Boolean))]
  let ingHtml
  if (groups.length) {
    ingHtml = groups
      .map(
        (g) =>
          `<h3>${esc(g)}</h3><ul>${t.ingredients.filter((i) => i.group === g).map(ingredientLine).join("")}</ul>`,
      )
      .join("")
  } else {
    ingHtml = `<ul>${t.ingredients.map(ingredientLine).join("")}</ul>`
  }
  const yields = t.yields.join(" · ")
  const timeBits = Object.entries(t.times)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${esc(v)}`)
    .join("  ·  ")
  const temps = t.temperatures.length ? `  ·  ${t.temperatures.map(esc).join(", ")}` : ""
  const nutrition = Object.keys(t.nutrition).length
    ? `<div class="nutrition"><h3>Nutrition (per serving)</h3><p>${Object.entries(t.nutrition)
        .map(([k, v]) => `${esc(k)} ${esc(v)}`)
        .join(" · ")}</p></div>`
    : ""
  const classif = Object.keys(t.classifications).length
    ? `<div class="tags">${Object.entries(t.classifications)
        .map(([k, v]) => `<span class="tag">${esc(k)}: ${esc(v)}</span>`)
        .join(" ")}</div>`
    : ""
  const instr = `<ol>${t.instructions.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`

  const body = `
    <h1>${esc(t.title)}</h1>
    <p class="meta">${esc(yields)}${temps}</p>
    <p class="meta small-meta">${timeBits}</p>
    ${classif}
    <div class="cols">
      <div class="col"><h2>Ingredients</h2>${ingHtml}</div>
      <div class="col"><h2>Method</h2>${instr}</div>
    </div>
    ${nutrition}
  `
  const colCss = treat.columns
    ? ".cols{display:grid;grid-template-columns:1fr 1fr;gap:28px}"
    : ".cols{display:block}.col+.col{margin-top:18px}"
  const metaTiny = treat.metaTiny ? `.small-meta{font-size:${treat.tinyPx || 9}px;color:#8a8a8a}` : ""
  const lowContrast = treat.lowContrast
    ? ".card{color:#565248 !important}h1,h2,h3,.q{color:#565248 !important}"
    : ""
  const glare = treat.glare
    ? `<div class="glare"></div>${treat.glareHard ? '<div class="glare2"></div>' : ""}`
    : ""
  const shadow = treat.shadow ? `<div class="shadow"></div>` : ""
  const pageStyle = [
    treat.perspective ? `perspective:${treat.perspective}px;` : "",
  ].join("")
  const cardTransform = [
    treat.rotate ? `rotate(${treat.rotate})` : "",
    treat.rotateX ? `rotateX(${treat.rotateX})` : "",
  ]
    .filter(Boolean)
    .join(" ")
  const cardStyle = [
    cardTransform ? `transform:${cardTransform};` : "",
    treat.blur ? `filter:blur(${treat.blur}px);` : "",
  ].join("")

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{margin:0;background:#c9c4bc;font-family:Georgia,'Times New Roman',serif;color:#1c1a17}
    .page{width:720px;min-height:900px;margin:40px auto;padding:0;${pageStyle};display:flex;align-items:center;justify-content:center}
    .card{position:relative;width:640px;background:#fbf8f1;background-image:radial-gradient(rgba(0,0,0,0.03) 1px,transparent 1px);background-size:4px 4px;padding:40px 44px;box-shadow:0 10px 30px rgba(0,0,0,0.35);${cardStyle}}
    h1{font-size:30px;margin:0 0 6px}
    h2{font-size:18px;margin:18px 0 6px;border-bottom:1px solid #cbb;padding-bottom:3px}
    h3{font-size:14px;margin:12px 0 4px;font-style:italic}
    .meta{margin:2px 0;color:#555;font-size:13px}
    ul,ol{margin:4px 0;padding-left:22px}
    li{margin:3px 0;font-size:15px;line-height:1.35}
    .q{font-weight:bold}
    .tags{margin:8px 0}
    .tag{display:inline-block;border:1px solid #a99;border-radius:10px;padding:1px 8px;font-size:11px;margin-right:5px;color:#544}
    .nutrition{margin-top:16px;font-size:12px;color:#444}
    ${colCss}
    ${metaTiny}
    ${lowContrast}
    .glare{position:absolute;inset:0;background:radial-gradient(circle at 68% 22%,rgba(255,255,255,0.92),rgba(255,255,255,0.0) 42%);pointer-events:none}
    /* glareHard: a large near-opaque blown-out band across the middle-left that genuinely obscures part of the ingredients and method, testing recovery vs invention */
    .glare2{position:absolute;inset:0;background:radial-gradient(ellipse 60% 34% at 40% 52%,rgba(255,255,255,0.99),rgba(255,255,255,0.85) 40%,rgba(255,255,255,0.0) 72%);pointer-events:none}
    .shadow{position:absolute;inset:0;background:linear-gradient(115deg,rgba(0,0,0,0.0) 55%,rgba(0,0,0,0.42) 100%);pointer-events:none}
  </style></head><body><div class="page"><div class="card">${body}${glare}${shadow}</div></div></body></html>`
}

// ---- render loop -------------------------------------------------------------

const browser = await chromium
  .launch({ executablePath: "/opt/pw-browsers/chromium" })
  .catch(async () => await chromium.launch())
const ctx = await browser.newContext({ viewport: { width: 800, height: 980 }, deviceScaleFactor: 2 })
const manifest = []
for (const f of FIXTURES) {
  const page = await ctx.newPage()
  await page.setContent(recipeHtml(f.truth, f.treatment), { waitUntil: "networkidle" })
  await page.screenshot({ path: join(FIX, `${f.id}.png`) })
  await page.close()
  writeFileSync(join(FIX, `${f.id}.truth.json`), `${JSON.stringify(f.truth, null, 2)}\n`)
  manifest.push({
    id: f.id,
    class: f.class,
    origin: f.origin,
    image: `${f.id}.png`,
    truth: `${f.id}.truth.json`,
  })
  console.log("rendered", f.id, "—", f.class)
}
writeFileSync(join(FIX, "manifest.json"), `${JSON.stringify({ fixtures: manifest }, null, 2)}\n`)
console.log(`\n${manifest.length} fixtures written to ${FIX}`)
await browser.close()
