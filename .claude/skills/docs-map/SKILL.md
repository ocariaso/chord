---
name: docs-map
description: Keep docs/map/ in sync with the code, and route work through it. Use when adding, deleting, moving or renaming any source file under server/ or web/; when changing a file's exports, purpose or in-repo dependencies; when asked to update, check or audit the code map or docs; or when starting a change and you need to find which files own a behavior.
---

# Maintaining the CHORD code map

[`docs/map/`](../../../docs/map/) is a mechanical, file-by-file index of the repository,
written so an agent can locate the owner of any behavior without searching. **It is expected
to match the code exactly.** Unlike the prose elsewhere in `docs/`, a stale entry actively
misleads — it is worse than no entry.

## The rule

**Any change that adds, deletes, moves or renames a source file, or that changes a file's
exports, purpose or in-repo dependencies, updates the corresponding map entry in the same
change.** Not in a follow-up.

This applies to `server/` and `web/` source files and to repository-root infrastructure
(Compose files, scripts, ignore rules). It does not apply to `docs/` itself.

## Before you start work

Read [`docs/map/tasks.md`](../../../docs/map/tasks.md) first. It routes a change description to
the files it touches, and carries three checklists that are easy to get wrong:

- **Adding a job payload field** touches five places, including `_row_to_response()`, which maps
  columns explicitly — a new column is invisible until added there.
- **Adding or renaming a job status** touches both `TERMINAL_STATUSES` sets, on opposite sides
  of the wire.
- **Changing the Demucs model** touches `STEM_NAMES` and both view orderings, or the API
  advertises stems that don't exist.

Using the router is faster than grepping and stops you missing a required edit.

## Which file to update

| Changed | Update |
| --- | --- |
| anything under `server/` | [`docs/map/server.md`](../../../docs/map/server.md) |
| anything under `web/` | [`docs/map/web.md`](../../../docs/map/web.md) |
| Compose files, `scripts/`, `.gitignore`, `.gitattributes`, root `README.md` | [`docs/map/root.md`](../../../docs/map/root.md) |
| a new cross-cutting change pattern, or a newly found bug/gap | [`docs/map/tasks.md`](../../../docs/map/tasks.md) |

Each of `server.md`, `web.md` and `root.md` opens with a directory tree — **update the tree too**
when a file is added, removed or moved.

## The entry format

```markdown
### `path/to/file.ext` — <one-line purpose>
**Exports:** the public surface — functions, components, constants, types
**Imports from:** in-repo modules it depends on
**Used by:** in-repo modules that depend on it
**Notes:** what a reader would otherwise have to discover by reading the file
**See:** links to the prose docs that explain it
```

Conventions to follow:

- `—` means "none". Omit a field entirely if it never applies (e.g. `**Exports:**` on a config
  file).
- **Imports from / Used by** list *in-repo* dependencies only. Third-party packages go in
  Notes, and only when they matter.
- Give a line count for files over ~100 lines, as a sense of weight.
- "**Leaf**" means nothing imports it except the entry point that composes it.

### What belongs in Notes

The reason the map is worth reading. Notes should capture what is **surprising, constraining,
or load-bearing** — not a restatement of the code:

- Non-obvious mechanisms — *"the trailing slash on `proxy_pass` is what strips the `/api`
  prefix"*.
- Ordering constraints — *"sets `TORCH_HOME` before any torch import"*.
- Deliberate oddities and the reason — *"declared `def`, not `async def`, so FastAPI runs the
  blocking zip in a threadpool"*.
- Duplication that must stay in sync — *"`NOTE_NAMES` duplicates the array in
  `server/app/pipeline/chords.py`"*.
- Known bugs and gaps — *"`handleDownloadAll` strips only `/\.mp3$/i`, so a FLAC upload
  downloads as `song.flac_stems.zip`"*.
- Fields or files that exist but are unused — *"`stems_model` exists but is never written"*.

Skip anything a reader gets for free from the signature.

## Procedure

1. **Read the existing entry** before editing it. Match the surrounding voice and level of
   detail; don't restructure a neighbour's entry as a side effect.
2. **Update the entry** — purpose line, exports, dependencies, notes.
3. **Update the directory tree** at the top of the same page if a file was added, removed or
   moved.
4. **Fix the reverse edges.** A new import means the *imported* file's **Used by** changes too.
   This is the most commonly missed step:
   ```bash
   grep -rn "moduleName" server/ web/src/ --include=*.py --include=*.ts --include=*.tsx
   ```
5. **Check the reading order** in [`docs/map/README.md`](../../../docs/map/README.md) if you
   added something a newcomer should meet early, or deleted something it names.
6. **Check for broken relative links** — every map page links into `docs/` prose and into source
   files:
   ```bash
   python3 - <<'PY'
   import pathlib, re
   root = pathlib.Path("docs")
   bad = []
   for md in root.rglob("*.md"):
       for text, target in re.findall(r"\[([^\]]+)\]\(([^)#]+?)(?:#[^)]*)?\)", md.read_text()):
           if target.startswith(("http://", "https://", "mailto:")):
               continue
           if not (md.parent / target).resolve().exists():
               bad.append(f"{md}: {target}")
   print("\n".join(bad) or "all links resolve")
   PY
   ```

## Also update the prose when behavior changes

The map is an index; the rest of `docs/` explains intent. A file move needs only a map update. A
**behavior** change needs the matching prose page:

| Changed | Also update |
| --- | --- |
| an endpoint's shape or semantics | [`docs/api/`](../../../docs/api/) |
| a user-visible capability | [`docs/features/`](../../../docs/features/) |
| a structural or layering decision | [`docs/architecture/`](../../../docs/architecture/) — add to `decisions.md` if a tradeoff was made |
| the schema or on-disk layout | [`docs/data/`](../../../docs/data/) |
| Docker, settings, or a new failure mode | [`docs/operations/`](../../../docs/operations/) |
| a new recurring code pattern | [`docs/conventions/`](../../../docs/conventions/) |

When you fix one of the known issues listed at the bottom of
[`docs/map/tasks.md`](../../../docs/map/tasks.md), remove it from that table and from the prose
page that documents it.

## Auditing the whole map

When asked to check or audit the map, verify these three things rather than re-reading
everything.

**1. Files on disk with no map entry.** Compare basenames, since entries are written relative to
`server/` or `web/`:

```bash
{ find server web -path web/node_modules -prune -o -path server/data -prune -o \
       -path web/dist -prune -o -type f -print
  ls docker-compose*.yml scripts/*.sh LICENSE README.md .gitignore .gitattributes
} | sed 's|.*/||' | sort -u > /tmp/disk.txt
grep -ho '^### `[^`]*`' docs/map/*.md | sed 's/^### `//; s/`$//; s|.*/||' | sort -u > /tmp/mapped.txt
comm -23 /tmp/disk.txt /tmp/mapped.txt
```

**Expected output** — these are covered collectively by design, not gaps. Anything *else* in the
list is a real gap:

- the six `*Amp.tsx` files (covered as a group under `studio/amps/`)
- `tsconfig.app.json`, `tsconfig.node.json` (grouped with `tsconfig.json`)
- `favicon.svg`, `icons.svg`, `hero.png`, `react.svg`, `vite.svg`, `package-lock.json`
  (grouped in `web.md`'s trailing "and" entry)
- every `__init__.py` (one collective line at the end of `server.md`)

**2. Map entries whose file no longer exists.** Entries are written relative to a convenient
root (`app/api/routes_jobs.py`, `studio/Knob.tsx`, `src/App.tsx`), so match by path suffix:

```bash
python3 - <<'PYEOF'
import pathlib, re
disk = [str(f) for f in pathlib.Path(".").rglob("*")
        if f.is_file() and not any(x in f.parts for x in
           (".git", "node_modules", "dist", "data", ".venv"))]
entries = set()
for md in pathlib.Path("docs/map").glob("*.md"):
    entries |= set(re.findall(r"^### `([^`]+)`", md.read_text(), re.M))
stale = [e for e in sorted(entries)
         if "*" not in e and not e.endswith("/")
         and not any(d == e or d.endswith("/" + e) for d in disk)]
print("\n".join(stale) or "every entry resolves to a file")
PYEOF
```

Entries containing a `*` or ending in `/` describe a group (`app/*/__init__.py`,
`studio/amps/`) and are skipped. `path/to/file.ext` from the entry template in
`docs/map/README.md` is not an entry — ignore it if a looser grep picks it up.

**3. Broken links.** Both paths and `#anchors`, across every doc:

```bash
python3 - <<'PYEOF'
import pathlib, re
def slug(h):
    s = re.sub(r"`", "", h.strip()).lower()
    s = re.sub(r"\*\*|\*", "", s)
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"[^\w\s-]", "", s)          # keeps underscores, as GitHub does
    return re.sub(r"\s+", "-", s).strip("-")
files = list(pathlib.Path("docs").rglob("*.md")) + [pathlib.Path("CLAUDE.md")]
anchors = {f.resolve(): {slug(m) for m in re.findall(r"^#{1,6}\s+(.*)$", f.read_text(), re.M)}
           for f in files}
bad = []
for md in files:
    for _, target in re.findall(r"\[([^\]]+)\]\(([^)\s]+?)\)", md.read_text()):
        if target.startswith(("http://", "https://", "mailto:", "#")):
            continue
        path, _, anc = target.partition("#")
        if path and not (md.parent / path).resolve().exists():
            bad.append(f"{md} -> {target}   (missing file)")
            continue
        tgt = (md.parent / path).resolve() if path else md.resolve()
        if anc and tgt in anchors and anc not in anchors[tgt]:
            bad.append(f"{md} -> {target}   (missing anchor)")
print("\n".join(bad) or "all links resolve")
PYEOF
```

A regex inside backticks can look like a Markdown link to that scanner — `docs/features/lyrics.md`
contains one. Treat a reported target of `.*` as a false positive.

## Writing style

Match the existing docs, which were written to be read by people and agents both:

- State the mechanism, then the consequence. *"The queue is in-memory — a restart orphans every
  queued job, and nothing reaps them."*
- Name tradeoffs plainly, including costs. Never sell a decision.
- Flag a known bug where it lives, as a bug, rather than describing broken behavior as intended.
- Prefer a table over a bulleted list of pairs.
- Link with relative paths, into both `docs/` prose and the source files themselves.
- No emoji, no "simply", no "just".
