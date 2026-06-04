/**
 * Language detection + Tree-sitter grammar loading.
 *
 * Structural parsing is deterministic and LLM-free (docs/P0-CODE-MVP.md §1 step 3).
 * Adding a language = register its grammar and the node types we care about here.
 */
import Parser from "tree-sitter";

export interface SymbolQuery {
  /** Tree-sitter node types that represent a function/method definition. */
  functionTypes: string[];
  /** Tree-sitter node types that represent a class/struct definition. */
  classTypes: string[];
  /** Tree-sitter node types that represent an import/require statement. */
  importTypes: string[];
  /** Tree-sitter node types that represent a call expression. */
  callTypes: string[];
}

export interface LanguageDef {
  id: string;
  extensions: string[];
  grammar: unknown;
  query: SymbolQuery;
}

// Grammars are CommonJS native modules; default-import works under Node ESM interop.
import Python from "tree-sitter-python";
import JavaScript from "tree-sitter-javascript";
import TypeScriptModule from "tree-sitter-typescript";

const { typescript: TypeScript, tsx: TSX } = TypeScriptModule as unknown as {
  typescript: unknown;
  tsx: unknown;
};

export const LANGUAGES: LanguageDef[] = [
  {
    id: "python",
    extensions: [".py"],
    grammar: Python,
    query: {
      functionTypes: ["function_definition"],
      classTypes: ["class_definition"],
      importTypes: ["import_statement", "import_from_statement"],
      callTypes: ["call"],
    },
  },
  {
    id: "javascript",
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
    grammar: JavaScript,
    query: {
      functionTypes: [
        "function_declaration",
        "function_expression",
        "arrow_function",
        "method_definition",
        "generator_function_declaration",
      ],
      classTypes: ["class_declaration"],
      importTypes: ["import_statement"],
      callTypes: ["call_expression"],
    },
  },
  {
    id: "typescript",
    extensions: [".ts"],
    grammar: TypeScript,
    query: {
      functionTypes: [
        "function_declaration",
        "function_expression",
        "arrow_function",
        "method_definition",
        "generator_function_declaration",
      ],
      classTypes: ["class_declaration", "abstract_class_declaration"],
      importTypes: ["import_statement"],
      callTypes: ["call_expression"],
    },
  },
  {
    id: "tsx",
    extensions: [".tsx"],
    grammar: TSX,
    query: {
      functionTypes: [
        "function_declaration",
        "function_expression",
        "arrow_function",
        "method_definition",
        "generator_function_declaration",
      ],
      classTypes: ["class_declaration", "abstract_class_declaration"],
      importTypes: ["import_statement"],
      callTypes: ["call_expression"],
    },
  },
];

const byExtension = new Map<string, LanguageDef>();
for (const lang of LANGUAGES) {
  for (const ext of lang.extensions) byExtension.set(ext, lang);
}

export function languageForExtension(ext: string): LanguageDef | undefined {
  return byExtension.get(ext.toLowerCase());
}

/** Create a parser configured for the given language. */
export function parserFor(lang: LanguageDef): Parser {
  const parser = new Parser();
  parser.setLanguage(lang.grammar as Parser.Language);
  return parser;
}
