#!/usr/bin/env python3
"""
Build the MicroPython autocomplete catalogue from the official stubs.

    python3 scripts/gen-micropython-stubs.py            # download + generate
    python3 scripts/gen-micropython-stubs.py --wheels DIR  # use wheels already in DIR

Reads the `micropython-stubs` packages published on PyPI by the MicroPython
stubs project (https://github.com/josverl/micropython-stubs, MIT licence) —
the same `.pyi` files Pylance/Pyright use — and writes

    src/renderer/src/components/micropython-stubs.json

which `micropython-stubs.ts` loads to give the editor real signatures and
docstrings for `machine`, `time`, `network`, `rp2`, `esp32`, … .

Port-specific stubs are merged: a module or member that exists on only some of
the ports listed in PORT_PACKAGES is tagged with those ports, so the editor can
say "rp2 only" instead of pretending `rp2.PIO` exists on an ESP32.

Only the Python standard library (`ast`, `re`, `json`, …) is needed; `pip` is
used for the download step.
"""
from __future__ import annotations

import argparse
import ast
import glob
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile

STUBS_VERSION = '1.29.0'

# Board stubs, in priority order: when two ports document the same member the
# first one's docstring/signature wins. Generic ports keep the catalogue honest
# about what is everywhere vs. one chip.
PORT_PACKAGES = [
    ('rp2', 'micropython-rp2-rpi_pico_w-stubs'),
    ('esp32', 'micropython-esp32-stubs'),
]
STDLIB_PACKAGE = 'micropython-stdlib-stubs'

# Modules taken from the stdlib stub package (CPython typeshed merged with the
# MicroPython docs). Only members WITH a docstring are kept from these: that
# docstring is MicroPython's own documentation, while the bare `...` entries
# are CPython API that MicroPython does not have (`os.fork`, `sys.settrace`).
STDLIB_MODULES = ['os', 'sys', 'json', 'struct', 'io', 're', 'array', 'collections', 'asyncio']

# …except where the stubs carry MicroPython's API without docstrings: these
# names are kept anyway (from https://docs.micropython.org/en/latest/library/asyncio.html).
STDLIB_ALLOW = {
    'asyncio': {
        'run', 'sleep', 'sleep_ms', 'create_task', 'current_task', 'gather', 'wait_for',
        'wait_for_ms', 'get_event_loop', 'new_event_loop', 'open_connection', 'start_server',
        'Event', 'ThreadSafeFlag', 'Lock', 'Task', 'Loop', 'StreamReader', 'StreamWriter',
    },
}

# Frozen modules whose stub is only `def __getattr__`: point them at the real one.
EXTRA_ALIASES = {'urequests': 'requests'}

# Not something a user imports: boot scripts, internals, setup helpers.
SKIP_MODULES = {
    '__builtins__', '_boot', '_boot_fat', 'inisetup', 'flashbdev', 'webrepl_setup',
    'upysh', 'aioble', 'umqtt', 'lwip', 'apa106', 'urequests',
}

OUT = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..',
    'src', 'renderer', 'src', 'components', 'micropython-stubs.json'
)

# Hover docs are capped so the bundle stays small; the rest is a click away in
# the official docs the module entry links to.
DOC_LIMIT = 900


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def download(dest: str) -> None:
    pkgs = [f'{p}~={STUBS_VERSION}' for _, p in PORT_PACKAGES] + [f'{STDLIB_PACKAGE}~={STUBS_VERSION}']
    subprocess.check_call(
        [sys.executable, '-m', 'pip', 'download', '--no-deps', '--quiet', '-d', dest, *pkgs]
    )


def unpack(wheels: str, package: str, into: str) -> str:
    stem = package.replace('-', '_')
    matches = sorted(glob.glob(os.path.join(wheels, f'{stem}-*.whl')))
    if not matches:
        sys.exit(f'no wheel for {package} in {wheels}')
    target = os.path.join(into, stem)
    with zipfile.ZipFile(matches[-1]) as z:
        z.extractall(target)
    return target


def wheel_version(wheels: str, package: str) -> str:
    stem = package.replace('-', '_')
    name = os.path.basename(sorted(glob.glob(os.path.join(wheels, f'{stem}-*.whl')))[-1])
    return name.split('-')[1]


# ---------------------------------------------------------------------------
# RST → Markdown (just enough for docstrings)
# ---------------------------------------------------------------------------

ROLE_WITH_TARGET = re.compile(r':[a-z]+:`([^`<]+?)\s*<[^>]+>`')
ROLE = re.compile(r':[a-z]+:`~?([^`]+)`')


def rst_inline(text: str) -> str:
    text = ROLE_WITH_TARGET.sub(lambda m: f'`{m.group(1).strip()}`', text)
    text = ROLE.sub(lambda m: f'`{m.group(1)}`', text)
    text = text.replace('``', '`')
    text = re.sub(r'``+', '`', text)
    return text


def clean_doc(doc: str | None, limit: int = DOC_LIMIT) -> str:
    if not doc:
        return ''
    doc = doc.split('\n---\n')[0]  # the stubber's "Module: … on micropython-…" footer
    lines = [ln.rstrip() for ln in doc.strip('\n').split('\n')]
    # dedent everything after the first line
    indents = [len(l) - len(l.lstrip()) for l in lines[1:] if l.strip()]
    pad = min(indents) if indents else 0
    lines = [lines[0].strip()] + [l[pad:] for l in lines[1:]]

    out: list[str] = []
    i = 0
    in_code = False
    code_indent = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if in_code:
            if stripped and (len(line) - len(line.lstrip())) < code_indent:
                out.append('```')
                in_code = False
                continue
            out.append(line[code_indent:] if stripped else '')
            i += 1
            continue
        # A section heading (text + ---/=== underline) or an RST table ends the
        # summary: what follows is reference detail, not hover material.
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ''
        if stripped and nxt and re.fullmatch(r'[-=~^]{3,}', nxt):
            break
        if re.fullmatch(r'[=\s]{6,}', stripped) and '=' in stripped:
            break
        if stripped.startswith('.. '):  # directives (note, admonition, …)
            i += 1
            while i < len(lines) and (not lines[i].strip() or lines[i].startswith(' ')):
                i += 1
            continue
        if stripped.startswith('MicroPython module:') or stripped.startswith('CPython module:'):
            i += 1
            continue
        if stripped.endswith('::'):
            text = stripped[:-2].rstrip()
            if text:
                out.append(rst_inline(text) + ':')
            # find the indented block
            j = i + 1
            while j < len(lines) and not lines[j].strip():
                j += 1
            if j < len(lines):
                code_indent = len(lines[j]) - len(lines[j].lstrip())
                if code_indent > len(line) - len(line.lstrip()):
                    out.append('```python')
                    in_code = True
                    i = j
                    continue
            i += 1
            continue
        # Markdown reads 4+ leading spaces as code; RST indentation is only
        # structure here, so flatten it (keeping list items as list items).
        body = line.lstrip()
        if body.startswith(('- ', '* ')) or re.match(r'\d+\. ', body):
            depth = (len(line) - len(body)) // 4
            out.append('  ' * min(depth, 1) + rst_inline(body))
        else:
            out.append(rst_inline(body))
        i += 1
    if in_code:
        out.append('```')

    text = '\n'.join(out).strip()
    text = re.sub(r'\n{3,}', '\n\n', text)
    if len(text) > limit:
        # cut at a paragraph boundary, never inside a code fence
        paras = text.split('\n\n')
        kept: list[str] = []
        size = 0
        for p in paras:
            if size + len(p) > limit and kept:
                break
            kept.append(p)
            size += len(p) + 2
        text = '\n\n'.join(kept)
        if text.count('```') % 2:
            text += '\n```'
    return text.strip()


def summary(doc: str) -> str:
    """The first sentence, for the one-line `detail`."""
    first = doc.split('\n\n')[0].replace('\n', ' ').strip()
    if first.startswith('```'):
        return ''
    m = re.match(r'(.+?[.!?])(\s|$)', first)
    s = m.group(1) if m else first
    return s if len(s) <= 120 else s[:117].rstrip() + '…'


# ---------------------------------------------------------------------------
# Signatures
# ---------------------------------------------------------------------------

NOISE_TYPES = {'Incomplete', 'Any', 'None'}

# The current file's short type aliases (`_PinLike` → `Pin | int | str`), so a
# signature shows what to pass rather than a private name.
TYPE_ALIASES: dict[str, str] = {}


def read_type_aliases(nodes) -> dict[str, str]:
    out = {}
    for node in nodes:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value is not None \
                and 'TypeAlias' in ast.unparse(node.annotation):
            value = ast.unparse(node.value)
            if len(value) <= 24 and 'Incomplete' not in value:
                out[node.target.id] = value
    return out


def ann(node: ast.expr | None) -> str:
    if node is None:
        return ''
    s = ast.unparse(node)
    s = re.sub(r'\b_?[A-Za-z_]+\.(?=[A-Z])', '', s)  # typing.X → X
    for alias, value in TYPE_ALIASES.items():
        s = re.sub(rf'(?<![\w.]){re.escape(alias)}(?!\w)', value, s)
    return '' if s in NOISE_TYPES else s


def default(node: ast.expr) -> str:
    s = ast.unparse(node)
    return '…' if s == '...' else s


def signature(fn: ast.FunctionDef | ast.AsyncFunctionDef, drop_self: bool, name: str | None = None) -> dict:
    a = fn.args
    params: list[dict] = []
    posonly = list(a.posonlyargs)
    regular = list(a.args)
    allpos = posonly + regular
    defaults = [None] * (len(allpos) - len(a.defaults)) + list(a.defaults)
    for idx, (arg, d) in enumerate(zip(allpos, defaults)):
        if idx == 0 and drop_self and arg.arg in ('self', 'cls'):
            continue
        params.append({'name': arg.arg, 'type': ann(arg.annotation), 'default': default(d) if d is not None else None})
    if a.vararg:
        params.append({'name': '*' + a.vararg.arg, 'type': ann(a.vararg.annotation), 'default': None})
    elif a.kwonlyargs:
        params.append({'name': '*', 'type': '', 'default': None})
    for arg, d in zip(a.kwonlyargs, a.kw_defaults):
        params.append({'name': arg.arg, 'type': ann(arg.annotation), 'default': default(d) if d is not None else None})
    if a.kwarg:
        params.append({'name': '**' + a.kwarg.arg, 'type': ann(a.kwarg.annotation), 'default': None})

    def fmt(p: dict) -> str:
        s = p['name']
        if p['type']:
            s += f": {p['type']}"
        if p['default'] is not None:
            s += f" = {p['default']}" if p['type'] else f"={p['default']}"
        return s

    ret = ann(fn.returns)
    label = f"{name or fn.name}({', '.join(fmt(p) for p in params)})"
    if ret and ret not in ('NoReturn',):
        label += f' -> {ret}'
    return {
        'label': label,
        'params': [fmt(p) for p in params if p['name'] != '*'],
        'doc': clean_doc(ast.get_docstring(fn), 600),
        **({'returns': ret} if ret else {}),
    }


# ---------------------------------------------------------------------------
# Module walking
# ---------------------------------------------------------------------------

def walk_body(body: list[ast.stmt]):
    """Top-level statements, looking inside `if sys.version_info …` blocks."""
    for node in body:
        if isinstance(node, ast.If):
            yield from walk_body(node.body)
            yield from walk_body(node.orelse)
        elif isinstance(node, ast.Try):
            yield from walk_body(node.body)
        else:
            yield node


def is_overload(fn: ast.AST) -> bool:
    return any(
        (isinstance(d, ast.Name) and d.id == 'overload')
        or (isinstance(d, ast.Attribute) and d.attr == 'overload')
        for d in getattr(fn, 'decorator_list', [])
    )


def is_private(name: str) -> bool:
    return name.startswith('_')


def assign_target(node: ast.stmt) -> tuple[str | None, ast.expr | None]:
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        return node.target.id, node.annotation
    if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        return node.targets[0].id, None
    return None, None


def following_docstring(body: list[ast.stmt], idx: int) -> str | None:
    if idx + 1 < len(body):
        nxt = body[idx + 1]
        if isinstance(nxt, ast.Expr) and isinstance(nxt.value, ast.Constant) and isinstance(nxt.value.value, str):
            return nxt.value.value
    return None


def collect_functions(nodes, drop_self: bool, require_doc: bool, allow: set[str] = frozenset()) -> dict[str, dict]:
    """name → {kind, signatures[], doc}. Overloads become extra signatures."""
    out: dict[str, dict] = {}
    for node in nodes:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        name = node.name
        if is_private(name) and name != '__init__':
            continue
        doc_raw = ast.get_docstring(node)
        if require_doc and not doc_raw and name not in allow:
            continue
        sig = signature(node, drop_self)
        entry = out.setdefault(name, {'kind': 'function', 'signatures': [], 'doc': ''})
        if isinstance(node, ast.AsyncFunctionDef):
            entry['async'] = True
        if any(isinstance(d, ast.Name) and d.id in ('property',) for d in node.decorator_list):
            entry['kind'] = 'variable'
        if sig['label'] not in [s['label'] for s in entry['signatures']]:
            entry['signatures'].append(sig)
        if not entry['doc'] and doc_raw:
            entry['doc'] = clean_doc(doc_raw)
    return out


def collect_class(node: ast.ClassDef, require_doc: bool) -> dict:
    members: dict[str, dict] = {}
    body = list(walk_body(node.body))
    funcs = collect_functions(body, drop_self=True, require_doc=False)
    init = funcs.pop('__init__', None)
    for name, f in funcs.items():
        if require_doc and not f['doc'] and not any(s['doc'] for s in f['signatures']):
            continue
        f['kind'] = 'method' if f['kind'] == 'function' else f['kind']
        members[name] = f
    for idx, stmt in enumerate(body):
        name, annotation = assign_target(stmt)
        if not name or is_private(name) or name in members:
            continue
        doc = following_docstring(body, idx)
        if require_doc and not doc:
            continue
        constant = name.isupper()
        members[name] = {
            'kind': 'constant' if constant else 'variable',
            'doc': clean_doc(doc, 400),
            **({'type': ann(annotation)} if annotation is not None and ann(annotation) else {}),
        }
    for stmt in body:
        if isinstance(stmt, ast.ClassDef) and not is_private(stmt.name):
            members[stmt.name] = collect_class(stmt, require_doc)
    entry: dict = {'kind': 'class', 'doc': clean_doc(ast.get_docstring(node)), 'members': members}
    if init:
        entry['signatures'] = [
            {**s, 'label': re.sub(r'^__init__', node.name, s['label']).replace(' -> None', '')}
            for s in init['signatures']
        ]
        for s in entry['signatures']:
            s.pop('returns', None)
        if not entry['doc']:
            entry['doc'] = init['doc']
    bases = [ast.unparse(b) for b in node.bases]
    if bases:
        entry['bases'] = bases
    return entry


def parse_file(path: str) -> ast.Module:
    with open(path, encoding='utf-8') as f:
        return ast.parse(f.read(), filename=path)


def module_file(root: str, dotted: str) -> str | None:
    rel = dotted.replace('.', os.sep)
    for cand in (os.path.join(root, rel + '.pyi'), os.path.join(root, rel, '__init__.pyi')):
        if os.path.exists(cand):
            return cand
    return None


def collect_module(root: str, dotted: str, require_doc: bool, seen: set[str] | None = None,
                   allow: set[str] = frozenset()) -> dict | None:
    path = module_file(root, dotted)
    if not path:
        return None
    seen = seen or set()
    if dotted in seen:
        return None
    seen.add(dotted)
    tree = parse_file(path)
    nodes = list(walk_body(tree.body))
    members: dict[str, dict] = {}
    alias_of = None

    # `from time import *` and nothing else: a u-module alias (utime → time).
    real = [n for n in nodes if not (isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant))]
    if len(real) == 1 and isinstance(real[0], ast.ImportFrom) and real[0].level == 0 \
            and [a.name for a in real[0].names] == ['*']:
        return {'alias': real[0].module}

    # Relative star-imports (asyncio's `from .tasks import *`) pull a sibling in.
    pkg = dotted if path.endswith('__init__.pyi') else dotted.rpartition('.')[0]
    for node in nodes:
        if isinstance(node, ast.ImportFrom) and node.level == 1 and any(a.name == '*' for a in node.names):
            sub = collect_module(root, f'{pkg}.{node.module}', require_doc, seen, allow)
            if sub and 'members' in sub:
                for k, v in sub['members'].items():
                    members.setdefault(k, v)

    # (after the sub-modules above, which set their own)
    TYPE_ALIASES.clear()
    TYPE_ALIASES.update(read_type_aliases(nodes))
    for name, f in collect_functions(nodes, drop_self=False, require_doc=require_doc, allow=allow).items():
        members[name] = f
    for node in nodes:
        if isinstance(node, ast.ClassDef) and not is_private(node.name) and not node.name.endswith('WiPy'):
            keep = node.name in allow
            cls = collect_class(node, require_doc and not keep)
            if require_doc and not keep and not cls['doc'] and not cls['members']:
                continue
            members[node.name] = cls
    for idx, stmt in enumerate(nodes):
        name, annotation = assign_target(stmt)
        if not name or is_private(name) or name in members:
            continue
        # `ID_T: TypeAlias = …` is typing plumbing, not API
        if annotation is not None and 'TypeAlias' in ast.unparse(annotation):
            continue
        if isinstance(stmt, ast.Assign) and isinstance(stmt.value, (ast.Name, ast.Attribute, ast.Subscript, ast.Call)) \
                and not name.isupper():
            continue
        doc = following_docstring(nodes, idx)
        if require_doc and not doc:
            continue
        members[name] = {
            'kind': 'constant' if name.isupper() else 'variable',
            'doc': clean_doc(doc, 400),
            **({'type': ann(annotation)} if annotation is not None and ann(annotation) else {}),
        }
    url = None
    raw_doc = ast.get_docstring(tree) or ''
    m = re.search(r'MicroPython module:\s*(\S+)', raw_doc)
    if m:
        url = m.group(1)
    out = {'doc': clean_doc(raw_doc), 'members': members}
    if url:
        out['url'] = url
    return out


def top_level_modules(root: str) -> list[str]:
    names = []
    for entry in sorted(os.listdir(root)):
        full = os.path.join(root, entry)
        if entry.endswith('.pyi'):
            names.append(entry[:-4])
        elif os.path.isdir(full) and os.path.exists(os.path.join(full, '__init__.pyi')):
            names.append(entry)
    return [n for n in names if not is_private(n) and n not in SKIP_MODULES]


# ---------------------------------------------------------------------------
# Merge
# ---------------------------------------------------------------------------

def tag(members: dict, port: str) -> None:
    """Mark every member (and every class member, recursively) as seen on `port`."""
    for m in members.values():
        m['_ports'] = [port]
        if m.get('kind') == 'class':
            tag(m['members'], port)


def merge_members(base: dict, extra: dict, port: str) -> None:
    """Fold `extra` (already tagged with `port`) into `base`."""
    for name, m in extra.items():
        b = base.get(name)
        if b is None:
            base[name] = m
            continue
        if port not in b['_ports']:
            b['_ports'].append(port)
        if m.get('kind') == 'class' and b.get('kind') == 'class':
            merge_members(b['members'], m['members'], port)
        if not b.get('doc') and m.get('doc'):
            b['doc'] = m['doc']
        if not b.get('signatures') and m.get('signatures'):
            b['signatures'] = m['signatures']


def finalize(members: dict, owner_ports: list[str]) -> None:
    for m in members.values():
        ports = m.pop('_ports', owner_ports)
        if sorted(ports) != sorted(owner_ports):
            m['ports'] = sorted(ports)
        if m.get('kind') == 'class':
            finalize(m['members'], ports)
        if not m.get('doc'):
            m.pop('doc', None)
        if 'signatures' in m and not m['signatures']:
            m.pop('signatures')
        # An overload's docstring is usually the member's own: keep it once.
        for sig in m.get('signatures', []):
            if not sig.get('doc') or sig['doc'] == m.get('doc') or len(m.get('signatures', [])) == 1:
                if not m.get('doc') and sig.get('doc'):
                    m['doc'] = sig['doc']
                sig.pop('doc', None)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--wheels', help='directory with the stub wheels already downloaded')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        wheels = args.wheels
        if not wheels:
            wheels = os.path.join(tmp, 'wheels')
            download(wheels)
        unpacked = os.path.join(tmp, 'src')
        stdlib_root = os.path.join(unpack(wheels, STDLIB_PACKAGE, unpacked), 'stdlib')

        modules: dict[str, dict] = {}
        aliases: dict[str, str] = {}
        all_ports = [p for p, _ in PORT_PACKAGES]
        versions = {STDLIB_PACKAGE: wheel_version(wheels, STDLIB_PACKAGE)}

        for port, package in PORT_PACKAGES:
            versions[package] = wheel_version(wheels, package)
            root = unpack(wheels, package, unpacked)
            for name in top_level_modules(root):
                mod = collect_module(root, name, require_doc=False)
                if mod is None or ('alias' not in mod and not mod['members']):
                    continue
                if 'alias' in mod:
                    aliases[name] = mod['alias']
                    continue
                if name in STDLIB_MODULES:
                    continue
                tag(mod['members'], port)
                if name not in modules:
                    modules[name] = {**mod, '_ports': [port]}
                else:
                    modules[name]['_ports'].append(port)
                    merge_members(modules[name]['members'], mod['members'], port)
                    if not modules[name].get('doc'):
                        modules[name]['doc'] = mod['doc']

        for name in STDLIB_MODULES:
            mod = collect_module(stdlib_root, name, require_doc=True, allow=STDLIB_ALLOW.get(name, frozenset()))
            if mod and mod.get('members'):
                # stdlib members are untagged: they inherit "every port"
                modules[name] = {**mod, '_ports': list(all_ports)}

        result_modules = {}
        for name in sorted(modules):
            mod = modules[name]
            ports = mod.pop('_ports')
            finalize(mod['members'], sorted(ports))
            if sorted(ports) != sorted(all_ports):
                mod['ports'] = sorted(ports)
            if not mod.get('doc'):
                mod.pop('doc', None)
            result_modules[name] = mod

        # Drop aliases whose target we did not keep.
        aliases.update(EXTRA_ALIASES)
        aliases = {k: v for k, v in sorted(aliases.items()) if v in result_modules}

        data = {
            '_generated': 'by scripts/gen-micropython-stubs.py — do not edit by hand',
            'source': {
                'project': 'https://github.com/josverl/micropython-stubs',
                'license': 'MIT',
                'packages': versions,
                'ports': all_ports,
            },
            'aliases': aliases,
            'modules': result_modules,
        }
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=None, separators=(',', ':'), sort_keys=False)
            f.write('\n')
        print(f'wrote {args.out}: {len(result_modules)} modules, {len(aliases)} aliases, '
              f'{os.path.getsize(args.out) // 1024} KiB')


if __name__ == '__main__':
    main()
