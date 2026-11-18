// Normalisation d'une phrase dictée : minuscules, sans accents, nombres en lettres → chiffres.

export function sansAccents(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const UNITES = ["zero", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze",
  "treize", "quatorze", "quinze", "seize"];

/** Nombres en lettres jusqu'à 31 (jours du mois), du plus long au plus court pour remplacer sans ambiguïté. */
function tableNombres() {
  const t = [];
  UNITES.forEach((m, i) => t.push([m, i]));
  t.push(["une", 1], ["premier", 1], ["premiere", 1], ["1er", 1]);
  // ordinaux (« les deuxièmes D », « la troisième TQ ») — bug du 17/11/2026
  ["deuxieme", "troisieme", "quatrieme", "cinquieme", "sixieme"].forEach((m, i) => { t.push([m, i + 2], [m + "s", i + 2]); });
  t.push(["seconde", 2], ["secondes", 2]);
  ["sept", "huit", "neuf"].forEach((m, i) => t.push([`dix ${m}`, 17 + i]));
  t.push(["vingt", 20], ["vingt et un", 21], ["trente", 30], ["trente et un", 31]);
  UNITES.slice(2, 10).forEach((m, i) => t.push([`vingt ${m}`, 22 + i]));
  return t.sort((a, b) => b[0].length - a[0].length);
}
const NOMBRES = tableNombres();

export function normaliser(phrase) {
  let s = sansAccents(String(phrase || "").toLowerCase())
    .replace(/[’`´]/g, "'")
    .replace(/(\d)\s*(?:er|e|eme|ieme)\b/g, "$1")   // 1er, 3e, 3eme → 1, 3
    .replace(/-/g, " ")
    .replace(/[,;!?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(\d) sept\b/g, "$1 septembre"); // « le 5 sept » : le mois, pas le nombre 7
  for (const [mot, n] of NOMBRES) {
    s = s.replace(new RegExp(`(^|[\\s'])${mot}(?=$|\\s)`, "g"), `$1${n}`);
  }
  // « un » et « une » ne sont des nombres que devant une unité de temps ou un mois : on les remet ailleurs.
  s = s.replace(/(^|\s)1(?=\s(?!semaine|jour|mois|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|\/|du\b))/g, "$1un");
  return s.replace(/\s+/g, " ").trim();
}

/** Similarité de Dice sur les bigrammes (correspondance approximative des chapitres). */
export function similarite(a, b) {
  const big = (s) => {
    const t = sansAccents(s.toLowerCase()).replace(/[^a-z0-9]/g, "");
    const m = new Map();
    for (let i = 0; i < t.length - 1; i++) m.set(t.slice(i, i + 2), (m.get(t.slice(i, i + 2)) || 0) + 1);
    return m;
  };
  const x = big(a), y = big(b);
  let inter = 0, nx = 0, ny = 0;
  for (const [k, v] of x) { nx += v; inter += Math.min(v, y.get(k) || 0); }
  for (const v of y.values()) ny += v;
  return nx + ny ? (2 * inter) / (nx + ny) : 0;
}
