import sax from 'sax';
import { DitaNode, DitaDocument, SourceRange } from './domTypes';
import { STANDARD_TAG_TO_BASETYPE } from './standardTagMap';
import { MAP_STANDARD_TAG_TO_BASETYPE } from './mapTagMap';

const TOPIC_PATTERN = /^(topic|map)\//;

function makeParseBaseType(tagMap: Record<string, string>) {
  return function parseBaseType(tagName: string, classAttr: string | undefined): string | undefined {
    const fromTag = tagMap[tagName];
    if (fromTag) {
      return fromTag;
    }

    if (classAttr) {
      const tokens = classAttr.trim().split(/\s+/);
      for (const token of tokens) {
        if (TOPIC_PATTERN.test(token)) {
          return token;
        }
      }
    }

    return undefined;
  };
}

function makeRange(): SourceRange {
  return { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
}

function makeParser(tagMap: Record<string, string>) {
  const parseBaseType = makeParseBaseType(tagMap);

  return function parseXml(xml: string): DitaDocument {
    const parser = sax.parser(true, { trim: false, normalize: false });

    const root: DitaNode = {
      type: 'element',
      children: [],
      sourceRange: makeRange(),
    };

    const stack: DitaNode[] = [root];
    let currentText = '';
    let currentTextStartLine = 0;
    let currentTextStartCol = 0;

    function flushText() {
      if (currentText.length > 0) {
        const parent = stack[stack.length - 1];
        if (parent) {
          parent.children.push({
            type: 'text',
            text: currentText,
            children: [],
            sourceRange: {
              startLine: currentTextStartLine,
              startCol: currentTextStartCol,
              endLine: parser.line,
              endCol: parser.column,
            },
          });
        }
        currentText = '';
      }
    }

    parser.onopentag = (node) => {
      flushText();

      const tagName = node.name;
      const classAttr = node.attributes['class'] as string | undefined;
      const baseType = parseBaseType(tagName, classAttr);

      const classTokens = classAttr
        ? classAttr.trim().split(/\s+/).filter(Boolean)
        : undefined;

      const element: DitaNode = {
        type: 'element',
        tagName,
        classTokens,
        baseType,
        attributes: node.attributes as Record<string, string>,
        children: [],
        sourceRange: {
          startLine: parser.line,
          startCol: parser.column,
          endLine: 0,
          endCol: 0,
        },
      };

      const parent = stack[stack.length - 1];
      if (parent) {
        parent.children.push(element);
      }
      stack.push(element);
    };

    parser.onclosetag = () => {
      flushText();
      const element = stack.pop();
      if (element) {
        element.sourceRange.endLine = parser.line;
        element.sourceRange.endCol = parser.column;
      }
    };

    parser.ontext = (text: string) => {
      if (currentText.length === 0) {
        currentTextStartLine = parser.line;
        currentTextStartCol = parser.column;
      }
      currentText += text;
    };

    parser.onerror = (err) => {
      throw new Error(`SAX parse error at line ${parser.line}:${parser.column}: ${err.message}`);
    };

    parser.write(xml).close();

    const docRoot = root.children.find(
      (c): c is DitaNode => c.type === 'element',
    );
    if (!docRoot) {
      throw new Error('No root element found in DITA document');
    }

    return {
      root: docRoot,
      sourceRange: docRoot.sourceRange,
    };
  };
}

/**
 * Preprocess XML to avoid SAX parse errors:
 * 1. Extract entity declarations from the DOCTYPE
 * 2. Strip the entire DOCTYPE declaration
 * 3. Replace known entity references with their values
 * 4. Remove any remaining undeclared entity references
 *    (keeps built-in XML entities: &amp; &lt; &gt; &quot; &apos;)
 */
export function preprocessEntities(xml: string): string {
  // 1. Extract simple entity declarations: <!ENTITY name "value">
  const entityRegex = /<!ENTITY\s+(\S+)\s+"((?:[^"\\]|\\.)*)">/g;
  let match;
  const entities: Array<[string, string]> = [];
  while ((match = entityRegex.exec(xml)) !== null) {
    entities.push([match[1], match[2]]);
  }

  // 2. Strip the entire DOCTYPE declaration
  let result = stripDoctype(xml);

  // 3. Replace known entity references with their values
  for (const [name, value] of entities) {
    result = result.replace(new RegExp(`&${name};`, 'g'), value);
  }

  // 4. Remove any remaining undeclared entity references to prevent
  //    SAX parse errors. Keep built-in XML entities and numeric refs.
  const builtin = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
  result = result.replace(/&([a-zA-Z_][a-zA-Z0-9_.-]*);/g, (full, name) => {
    return builtin.has(name) ? full : '';
  });

  return result;
}

/** Strips the entire <!DOCTYPE ...> declaration, including internal subset [...]. */
function stripDoctype(xml: string): string {
  const start = xml.indexOf('<!DOCTYPE');
  if (start < 0) return xml;

  // Check for an internal subset marked by [ ... ]>
  const bracketStart = xml.indexOf('[', start);
  const firstGt = xml.indexOf('>', start);

  if (bracketStart >= 0 && (firstGt < 0 || bracketStart < firstGt)) {
    // Has internal subset — find the closing ]>
    const end = xml.indexOf(']>', bracketStart);
    if (end >= 0) {
      return xml.substring(0, start) + xml.substring(end + 2);
    }
  }
  // No internal subset — just strip up to and including the first >
  if (firstGt >= 0) {
    return xml.substring(0, start) + xml.substring(firstGt + 1);
  }
  return xml;
}

const _parseDita = makeParser(STANDARD_TAG_TO_BASETYPE);
const _parseDitamap = makeParser(MAP_STANDARD_TAG_TO_BASETYPE);

export function parseDita(xml: string): DitaDocument {
  return _parseDita(xml);
}

export function parseDitamap(xml: string): DitaDocument {
  return _parseDitamap(xml);
}
