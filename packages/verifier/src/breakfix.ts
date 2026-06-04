/**
 * Break-and-fix task construction for Python (docs/P0-CODE-MVP.md §5.1).
 * Pure text transforms; file IO and test execution live elsewhere.
 */

const NL = "\n";

/** Replace 1-based inclusive line range [startLine, endLine] with `replacement`. */
export function replaceLineRange(
  source: string,
  startLine: number,
  endLine: number,
  replacement: string,
): string {
  const lines = source.split(NL);
  const before = lines.slice(0, startLine - 1);
  const after = lines.slice(endLine);
  return [...before, ...replacement.split(NL), ...after].join(NL);
}

function leadingWhitespace(line: string): string {
  return line.match(/^\s*/)?.[0] ?? "";
}

export interface BlankResult {
  /** The function with its body removed, shown to the learner as a starting point. */
  brokenFunction: string;
  /** The original function text (hidden reference / hint source). */
  originalFunction: string;
  /** Full file content with the function blanked, used to check test coverage. */
  fileWithBlank: string;
}

/**
 * Blank a Python function/method body, keeping its signature (possibly multi-line)
 * and replacing the body with `raise NotImplementedError`.
 */
export function blankPythonFunction(
  source: string,
  startLine: number,
  endLine: number,
): BlankResult {
  const lines = source.split(NL);
  const fnLines = lines.slice(startLine - 1, endLine);
  const originalFunction = fnLines.join(NL);

  // Signature may span multiple lines; it ends at the first line whose code
  // (ignoring trailing comments) ends with ":".
  let headerEnd = 0;
  for (let i = 0; i < fnLines.length; i++) {
    const code = fnLines[i]!.replace(/#.*$/, "").trimEnd();
    if (code.endsWith(":")) {
      headerEnd = i;
      break;
    }
  }
  const header = fnLines.slice(0, headerEnd + 1);
  const bodyIndent = leadingWhitespace(fnLines[0]!) + "    ";
  const brokenFunction = [...header, `${bodyIndent}raise NotImplementedError("implement me")`].join(
    NL,
  );

  return {
    brokenFunction,
    originalFunction,
    fileWithBlank: replaceLineRange(source, startLine, endLine, brokenFunction),
  };
}
