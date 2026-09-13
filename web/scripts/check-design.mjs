/**
 * The design template's ground rules as a check, run by `npm run lint` after oxlint.
 *
 * The design system shipped its adherence rules as ESLint `no-restricted-syntax` selectors, which oxlint
 * doesn't implement, so they live here, together with the parts of the design's ground rules a script can
 * see. docs/conventions/design.md explains each rule.
 *
 * It reads string literals rather than an AST, so a regex literal or JSX text can occasionally trip it;
 * every report names the line.
 */
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_DIR = join(WEB_DIR, "src");
// The stylesheets define the vocabulary instead of following it.
const VENDORED_DIR = join(SOURCE_DIR, "styles");

// The only custom properties a component sets (design.md#runtime-values).
const RUNTIME_PROPERTIES = new Set(["--v", "--l", "--p", "--stem"]);
// The class families the stylesheets own; any other class is a Tailwind layout utility.
const OWNED_CLASS = /^(?:ch-[\w-]+|is-[\w-]+|btn(?:-[\w-]+)?|dialog(?:-[\w-]+)?|field|input|lighten)$/;
const HEX_COLOR = /#[0-9a-fA-F]{3,8}\b/;
// Shadows darken with plain black, as Nocturne's own shadow tokens do; any other colour function is a new colour.
const SHADOW_BLACK = /rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*[\d.]+\s*\)/g;
const COLOR_FUNCTION = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;
const FONT_SHORTHAND = /^\d{3} [\d.]+px\/[\d.]+ /;
const FONT_TOKEN = /var\(--font-(?:body|heading)\)/;

const vendored = readdirSync(VENDORED_DIR)
  .filter((name) => name.endsWith(".css"))
  .map((name) => readFileSync(join(VENDORED_DIR, name), "utf8"))
  .join("\n");
const TOKENS = new Set([...vendored.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1]));
const CLASSES = new Set([...vendored.matchAll(/\.([a-zA-Z_][\w-]*)/g)].map((match) => match[1]));
const SPACING_AS_PX = new RegExp(
  `(?<![\\d.])(?:${[...vendored.matchAll(/--space-\d+\s*:\s*([\d.]+)px/g)].map((match) => match[1].replace(".", "\\.")).join("|")})px`
);

const violations = [];

function report(file, line, message) {
  violations.push(`${relative(WEB_DIR, file).split(sep).join("/")}:${line}  ${message}`);
}

/** String literals and template-literal text, each with the line it starts on, plus the source with comments blanked. */
function scan(source) {
  const strings = [];
  let code = "";
  // The brace depth at which each open template substitution started.
  const substitutions = [];
  let depth = 0;
  let line = 1;
  let i = 0;

  function readTemplateText() {
    const start = line;
    let text = "";
    while (i < source.length) {
      const char = source[i];
      if (char === "\\") {
        text += source.slice(i, i + 2);
        code += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (char === "`") {
        code += char;
        i++;
        break;
      }
      if (char === "$" && source[i + 1] === "{") {
        substitutions.push(depth);
        code += "${";
        i += 2;
        break;
      }
      if (char === "\n") line++;
      text += char;
      code += char;
      i++;
    }
    strings.push({ text, line: start });
  }

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        code += " ";
        i++;
      }
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (; i < stop; i++) {
        if (source[i] === "\n") line++;
        code += source[i] === "\n" ? "\n" : " ";
      }
    } else if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== char && source[j] !== "\n") j += source[j] === "\\" ? 2 : 1;
      // An apostrophe in JSX text never closes; stopping at the line end keeps it from swallowing the file.
      const closed = source[j] === char;
      strings.push({ text: source.slice(i + 1, j), line });
      code += source.slice(i, closed ? j + 1 : j);
      i = closed ? j + 1 : j;
    } else if (char === "`") {
      code += char;
      i++;
      readTemplateText();
    } else if (char === "}" && substitutions.at(-1) === depth) {
      substitutions.pop();
      code += char;
      i++;
      readTemplateText();
    } else {
      if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === "\n") line++;
      code += char;
      i++;
    }
  }
  return { strings, code };
}

/** The rules every value obeys, wherever it's written. */
function checkValue(file, line, text) {
  if (HEX_COLOR.test(text)) report(file, line, `hex colour in "${text}" — use a token through var()`);
  if (COLOR_FUNCTION.test(text.replace(SHADOW_BLACK, ""))) {
    report(file, line, `colour function in "${text}" — the palette is the stem hues, the status hues and the Nocturne ramps`);
  }
  if (SPACING_AS_PX.test(text)) report(file, line, `spacing token written as px in "${text}" — use var(--space-N)`);
  for (const [, name] of text.matchAll(/\((--[\w-]+)/g)) {
    if (TOKENS.has(name) || RUNTIME_PROPERTIES.has(name)) continue;
    // A name ending in "-" is the head of one built at runtime, like `var(--ch-${key})`, which nothing can vouch for.
    const problem = name.endsWith("-")
      ? `${name}… is built at runtime — write each token out`
      : `${name} isn't defined by nocturne.css or chord-theme.css`;
    report(file, line, problem);
  }
}

function checkScript(file, source) {
  const { strings, code } = scan(source);
  for (const { text, line } of strings) {
    checkValue(file, line, text);
    if (FONT_SHORTHAND.test(text) && !FONT_TOKEN.test(text)) report(file, line, `font shorthand "${text}" doesn't use var(--font-body)`);
    if (/^--[\w-]+$/.test(text) && !RUNTIME_PROPERTIES.has(text)) {
      report(file, line, `inline custom property ${text} — components set only --v, --l, --p and --stem`);
    }
    for (const token of text.split(/\s+/)) {
      if (OWNED_CLASS.test(token) && !CLASSES.has(token)) report(file, line, `class .${token} isn't defined by nocturne.css or chord-theme.css`);
    }
  }
  for (const match of code.matchAll(/fontFamily\s*[:=]\s*\{?\s*(["'`])(.*?)\1/g)) {
    if (!FONT_TOKEN.test(match[2])) {
      report(file, code.slice(0, match.index).split("\n").length, `fontFamily "${match[2]}" — Inter only, through var(--font-body)`);
    }
  }
}

function checkStylesheet(file, source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  code.split("\n").forEach((text, index) => {
    const line = index + 1;
    checkValue(file, line, text);
    const family = /font-family\s*:\s*([^;}]+)/.exec(text);
    if (family && !FONT_TOKEN.test(family[1])) report(file, line, `font-family "${family[1].trim()}" — Inter only, through var(--font-body)`);
  });
  // A selector is everything before a "{" back to the previous rule or declaration, so one-line rules count too.
  for (const match of code.matchAll(/([^{};]*)\{/g)) {
    if (!/\.[a-zA-Z_][\w-]*/.test(match[1])) continue;
    const start = match.index + match[1].search(/\S/);
    report(file, code.slice(0, start).split("\n").length, "app CSS defines a class — compose the template's classes instead");
  }
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return path === VENDORED_DIR ? [] : sourceFiles(path);
    return [".ts", ".tsx", ".js", ".css"].includes(extname(entry.name)) ? [path] : [];
  });
}

for (const file of sourceFiles(SOURCE_DIR)) {
  const source = readFileSync(file, "utf8");
  if (file.endsWith(".css")) checkStylesheet(file, source);
  else checkScript(file, source);
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  console.error(`\n${violations.length} design rule violation${violations.length === 1 ? "" : "s"} — see docs/conventions/design.md.`);
  process.exit(1);
}
console.log("check-design: no violations.");
