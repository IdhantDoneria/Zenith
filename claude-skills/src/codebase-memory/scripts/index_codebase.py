#!/usr/bin/env python3
"""Build a lightweight symbol map of a codebase (lite port of codebase-memory-mcp).

Usage:
  python3 index_codebase.py <repo_dir> [out_file]        # index -> symbols.tsv
  python3 index_codebase.py --query <name> [out_file]    # find a symbol
  python3 index_codebase.py --callers <name> <repo_dir>  # grep call sites

symbols.tsv columns: kind, name, file, line
"""
import os, re, sys

EXT_PATTERNS = {
    (".py",): [(r"^\s*def\s+(\w+)", "func"), (r"^\s*class\s+(\w+)", "class")],
    (".js", ".jsx", ".ts", ".tsx", ".mjs"): [
        (r"^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)", "func"),
        (r"^\s*(?:export\s+)?class\s+(\w+)", "class"),
        (r"^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(", "func"),
        (r"^\s*(?:export\s+)?interface\s+(\w+)", "iface"),
    ],
    (".go",): [(r"^func\s+(?:\([^)]+\)\s+)?(\w+)", "func"), (r"^type\s+(\w+)\s+(?:struct|interface)", "type")],
    (".rs",): [(r"^\s*(?:pub\s+)?fn\s+(\w+)", "func"), (r"^\s*(?:pub\s+)?(?:struct|enum|trait)\s+(\w+)", "type")],
    (".java", ".kt", ".cs", ".php"): [
        (r"^\s*(?:public|private|protected|internal|static|final|abstract|\s)*class\s+(\w+)", "class"),
        (r"^\s*(?:public|private|protected|internal|static|final|async|override|\s)*[\w<>\[\]]+\s+(\w+)\s*\([^;]*\)\s*\{?", "func"),
    ],
    (".c", ".h", ".cpp", ".hpp", ".cc"): [(r"^[\w\*\s]+?(\w+)\s*\([^;]*\)\s*\{", "func")],
    (".rb",): [(r"^\s*def\s+(\w+[\?!]?)", "func"), (r"^\s*(?:class|module)\s+(\w+)", "class")],
}
SKIP_DIRS = {".git", "node_modules", "dist", "build", "target", "vendor", ".venv", "venv", "__pycache__"}

def index(root, out):
    rows = []
    for dirpath, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            pats = next((p for exts, p in EXT_PATTERNS.items() if f.endswith(exts)), None)
            if not pats:
                continue
            path = os.path.join(dirpath, f)
            try:
                lines = open(path, errors="ignore").read().splitlines()
            except OSError:
                continue
            for i, line in enumerate(lines, 1):
                for rx, kind in pats:
                    m = re.match(rx, line)
                    if m:
                        rows.append(f"{kind}\t{m.group(1)}\t{os.path.relpath(path, root)}\t{i}")
                        break
    open(out, "w").write("\n".join(rows) + "\n")
    kinds = {}
    for r in rows:
        kinds[r.split("\t")[0]] = kinds.get(r.split("\t")[0], 0) + 1
    print(f"indexed {len(rows)} symbols -> {out} ({', '.join(f'{v} {k}' for k, v in kinds.items())})")

if __name__ == "__main__":
    a = sys.argv[1:]
    if a and a[0] == "--query":
        out = a[2] if len(a) > 2 else "symbols.tsv"
        hits = [l for l in open(out) if f"\t{a[1]}\t" in l or a[1] in l.split("\t")[1]]
        print("".join(hits[:40]) or "no match")
    elif a and a[0] == "--callers":
        os.system(f"grep -rn --include='*.*' -E '\\b{a[1]}\\s*\\(' {a[2]} | grep -vE 'def |func |fn |function ' | head -40")
    else:
        index(a[0] if a else ".", a[1] if len(a) > 1 else "symbols.tsv")
