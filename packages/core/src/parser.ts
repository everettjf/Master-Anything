/**
 * Per-file structural extraction: source -> symbols (functions, classes),
 * imports, and best-effort call references. Deterministic, LLM-free.
 */
import type Parser from "tree-sitter";
import { type LanguageDef, parserFor } from "./languages.js";

export interface ParsedSymbol {
  kind: "function" | "class";
  name: string;
  /** Enclosing class/function name, if nested (for method qualification). */
  container?: string;
  signature: string;
  startLine: number; // 1-based
  endLine: number; // 1-based
  /** Names of symbols referenced via calls inside this symbol's body. */
  calls: string[];
}

export interface ParsedFile {
  imports: string[]; // raw imported module/source strings
  symbols: ParsedSymbol[];
}

function nodeName(node: Parser.SyntaxNode): string | undefined {
  const nameNode = node.childForFieldName("name");
  return nameNode?.text;
}

/** First line of a node's text, trimmed, used as a lightweight signature. */
function signatureOf(node: Parser.SyntaxNode): string {
  const firstLine = node.text.split("\n", 1)[0]!.trim();
  return firstLine.length > 200 ? `${firstLine.slice(0, 197)}...` : firstLine;
}

/** Best-effort callee name for a call node (handles `foo()` and `a.b()`). */
function calleeName(node: Parser.SyntaxNode): string | undefined {
  const fn = node.childForFieldName("function") ?? node.namedChild(0);
  if (!fn) return undefined;
  if (fn.type === "identifier") return fn.text;
  // member access: take the property/attribute identifier
  const prop = fn.childForFieldName("property") ?? fn.childForFieldName("attribute");
  if (prop) return prop.text;
  const last = fn.text.split(".").pop();
  return last?.trim() || undefined;
}

function collectCalls(node: Parser.SyntaxNode, callTypes: Set<string>): string[] {
  const found: string[] = [];
  const stack: Parser.SyntaxNode[] = [node];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur !== node && callTypes.has(cur.type)) {
      const name = calleeName(cur);
      if (name) found.push(name);
    }
    for (let i = 0; i < cur.namedChildCount; i++) {
      stack.push(cur.namedChild(i)!);
    }
  }
  return found;
}

export function parseSource(source: string, lang: LanguageDef): ParsedFile {
  const parser = parserFor(lang);
  const tree = parser.parse(source);
  const { functionTypes, classTypes, importTypes, callTypes } = lang.query;
  const fnTypes = new Set(functionTypes);
  const clTypes = new Set(classTypes);
  const imTypes = new Set(importTypes);
  const caTypes = new Set(callTypes);

  const imports: string[] = [];
  const symbols: ParsedSymbol[] = [];

  const walk = (node: Parser.SyntaxNode, container?: string) => {
    const isFn = fnTypes.has(node.type);
    const isClass = clTypes.has(node.type);

    if (imTypes.has(node.type)) {
      imports.push(node.text.split("\n", 1)[0]!.trim());
    }

    if (isFn || isClass) {
      const name = nodeName(node) ?? "(anonymous)";
      symbols.push({
        kind: isClass ? "class" : "function",
        name,
        container,
        signature: signatureOf(node),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        calls: isFn ? Array.from(new Set(collectCalls(node, caTypes))) : [],
      });
      // recurse with this symbol as the container for nested defs
      const childContainer = name !== "(anonymous)" ? name : container;
      for (let i = 0; i < node.namedChildCount; i++) {
        walk(node.namedChild(i)!, childContainer);
      }
      return;
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      walk(node.namedChild(i)!, container);
    }
  };

  walk(tree.rootNode);
  return { imports, symbols };
}
