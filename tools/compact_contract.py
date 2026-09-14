"""Generate the exact compact source used for public-network deployment."""

from __future__ import annotations

import ast
import difflib
import io
import json
import keyword
import string
import tokenize
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "contracts" / "docket.py"
TARGET = ROOT / "contracts" / "docket.deploy.py"
ERRORS = ROOT / "contracts" / "docket.deploy.errors.json"
TEST_SOURCE = ROOT / "tests" / "direct" / "test_docket.py"
DEPENDS = '# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }'


class RemoveDocstrings(ast.NodeTransformer):
    """Remove runtime-inert docstrings while preserving executable statements."""

    def _strip(self, node: ast.AST) -> ast.AST:
        body = getattr(node, "body", None)
        if (
            isinstance(body, list)
            and body
            and isinstance(body[0], ast.Expr)
            and isinstance(body[0].value, ast.Constant)
            and isinstance(body[0].value.value, str)
        ):
            body.pop(0)
        return self.generic_visit(node)

    visit_Module = _strip
    visit_ClassDef = _strip
    visit_FunctionDef = _strip
    visit_AsyncFunctionDef = _strip


class EncodeRaiseMessages(ast.NodeTransformer):
    def __init__(self, preserved_snippets: set[str]) -> None:
        self.messages: dict[str, str] = {}
        self.preserved_snippets = preserved_snippets

    def visit_Raise(self, node: ast.Raise) -> ast.AST:
        self.generic_visit(node)
        if (
            isinstance(node.exc, ast.Call)
            and node.exc.args
            and isinstance(node.exc.args[0], ast.Constant)
            and isinstance(node.exc.args[0].value, str)
        ):
            message = node.exc.args[0].value
            if any(snippet in message for snippet in self.preserved_snippets):
                return node
            code = f"D{len(self.messages) + 1:03d}"
            self.messages[code] = message
            node.exc.args[0] = ast.Constant(code)
        return node


def short_names():
    alphabet = string.ascii_lowercase
    length = 1
    while True:
        for number in range(len(alphabet) ** length):
            value = number
            name = ""
            for _ in range(length):
                name = alphabet[value % len(alphabet)] + name
                value //= len(alphabet)
            if not keyword.iskeyword(name):
                yield name
        length += 1


class RenameIdentifiers(ast.NodeTransformer):
    def __init__(self, names: dict[str, str], attributes: dict[str, str] | None = None):
        self.names = names
        self.attributes = attributes or {}

    def visit_Name(self, node: ast.Name) -> ast.AST:
        node.id = self.names.get(node.id, node.id)
        return node

    def visit_Attribute(self, node: ast.Attribute) -> ast.AST:
        self.generic_visit(node)
        node.attr = self.attributes.get(node.attr, node.attr)
        return node

    def visit_arg(self, node: ast.arg) -> ast.AST:
        node.arg = self.names.get(node.arg, node.arg)
        return node

    def visit_FunctionDef(self, node: ast.FunctionDef) -> ast.AST:
        node.name = self.attributes.get(node.name, self.names.get(node.name, node.name))
        return self.generic_visit(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> ast.AST:
        node.name = self.attributes.get(node.name, self.names.get(node.name, node.name))
        return self.generic_visit(node)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> ast.AST:
        if node.name:
            node.name = self.names.get(node.name, node.name)
        return self.generic_visit(node)


def symbol_map(tree: ast.Module) -> tuple[dict[str, str], dict[str, str]]:
    global_candidates: list[str] = []
    private_methods: list[str] = []
    for node in tree.body:
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            global_candidates.extend(
                target.id for target in targets
                if isinstance(target, ast.Name) and target.id.isupper()
            )
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if node.name.startswith("_") and not node.name.startswith("__"):
                global_candidates.append(node.name)
        elif isinstance(node, ast.ClassDef) and node.name == "Docket":
            private_methods.extend(
                child.name for child in node.body
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef))
                and child.name.startswith("_")
                and not child.name.startswith("__")
            )

    names = short_names()
    global_map = {name: next(names) for name in dict.fromkeys(global_candidates)}
    method_names = short_names()
    method_map = {name: f"_{next(method_names)}" for name in dict.fromkeys(private_methods)}
    return global_map, method_map


class CompactFunctions(ast.NodeTransformer):
    PUBLIC_METHODS = {
        "register_task", "submit_delivery", "accept_delivery", "open_dispute",
        "escalate_submission", "resolve_dispute", "supplement_evidence",
        "refund_inconclusive_task", "cancel_task", "get_task", "get_task_count",
    }

    def _compact(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> ast.AST:
        if node.name not in self.PUBLIC_METHODS:
            node.returns = None
            for argument in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
                argument.annotation = None
            if node.args.vararg:
                node.args.vararg.annotation = None
            if node.args.kwarg:
                node.args.kwarg.annotation = None

        nested = any(
            isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda))
            for statement in node.body
            for child in ast.walk(statement)
        )
        if not nested:
            arguments = {
                argument.arg
                for argument in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]
            }
            if node.args.vararg:
                arguments.add(node.args.vararg.arg)
            if node.args.kwarg:
                arguments.add(node.args.kwarg.arg)
            local_names = {
                child.id for statement in node.body for child in ast.walk(statement)
                if isinstance(child, ast.Name) and isinstance(child.ctx, (ast.Store, ast.Del))
            }
            local_names.update(
                child.name for statement in node.body for child in ast.walk(statement)
                if isinstance(child, ast.ExceptHandler) and child.name
            )
            local_names.difference_update(arguments)
            local_names.discard("self")
            all_names = {
                child.id for statement in node.body for child in ast.walk(statement)
                if isinstance(child, ast.Name)
            }
            available = (name for name in short_names() if name not in all_names and name not in arguments)
            rename = {name: next(available) for name in sorted(local_names)}
            node.body = [RenameIdentifiers(rename).visit(statement) for statement in node.body]
        return self.generic_visit(node)

    visit_FunctionDef = _compact
    visit_AsyncFunctionDef = _compact


def minify_python(source: str) -> str:
    """Remove formatting that Python's tokenizer does not need at runtime."""
    indent_depth = 0
    at_line_start = True
    previous: tokenize.TokenInfo | None = None
    chunks: list[str] = []

    def needs_space(left: tokenize.TokenInfo, right: tokenize.TokenInfo) -> bool:
        word_types = {tokenize.NAME, tokenize.NUMBER, tokenize.STRING}
        fstring_types = {tokenize.FSTRING_START, tokenize.FSTRING_MIDDLE, tokenize.FSTRING_END}
        if right.type == tokenize.FSTRING_START:
            return left.type in word_types
        if left.type in fstring_types or right.type in fstring_types:
            return False
        return left.type in word_types and right.type in word_types

    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        if token.type in {tokenize.NL, tokenize.COMMENT, tokenize.ENCODING, tokenize.ENDMARKER}:
            continue
        if token.type == tokenize.INDENT:
            indent_depth += 1
        elif token.type == tokenize.DEDENT:
            indent_depth -= 1
        elif token.type == tokenize.NEWLINE:
            chunks.append("\n")
            at_line_start = True
            previous = None
        else:
            if at_line_start:
                chunks.append(" " * indent_depth)
                at_line_start = False
            if previous and needs_space(previous, token):
                chunks.append(" ")
            chunks.append(token.string)
            previous = token
    return "".join(chunks).strip() + "\n"


test_tree = ast.parse(TEST_SOURCE.read_text(encoding="utf-8"), filename=str(TEST_SOURCE))
preserved_error_snippets = {
    call.args[0].value
    for call in ast.walk(test_tree)
    if isinstance(call, ast.Call)
    and isinstance(call.func, ast.Attribute)
    and call.func.attr == "expect_revert"
    and call.args
    and isinstance(call.args[0], ast.Constant)
    and isinstance(call.args[0].value, str)
}

tree = ast.parse(SOURCE.read_text(encoding="utf-8"), filename=str(SOURCE))
tree = RemoveDocstrings().visit(tree)
# The deploy artifact exposes stable compact error codes. The readable contract
# retains the explanatory messages used by the direct test suite.
error_encoder = EncodeRaiseMessages(set())
tree = error_encoder.visit(tree)
global_map, method_map = symbol_map(tree)
tree = RenameIdentifiers(global_map, method_map).visit(tree)
tree = CompactFunctions().visit(tree)
ast.fix_missing_locations(tree)
unminified_source = ast.unparse(tree)
source = minify_python(unminified_source)
minified_ast = ast.dump(ast.parse(source), include_attributes=False, indent=2)
unminified_ast = ast.dump(ast.parse(unminified_source), include_attributes=False, indent=2)
if minified_ast != unminified_ast:
    raise RuntimeError(
        "Tokenizer compaction changed the contract AST:\n" + "\n".join(
            list(difflib.unified_diff(unminified_ast.splitlines(), minified_ast.splitlines(), n=2))[:40]
        )
    )
TARGET.write_text(f"{DEPENDS}\n{source}", encoding="utf-8", newline="\n")
ERRORS.write_text(
    json.dumps(error_encoder.messages, indent=2, ensure_ascii=False) + "\n",
    encoding="utf-8",
    newline="\n",
)
compile(TARGET.read_text(encoding="utf-8"), str(TARGET), "exec")
print(TARGET)
