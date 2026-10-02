import sax from 'sax';
import { DitaNode, DitaDocument, SourceRange } from './domTypes';
import { STANDARD_TAG_TO_BASETYPE } from './standardTagMap';
import { MAP_STANDARD_TAG_TO_BASETYPE } from './mapTagMap';
import { lookupNamedEntity } from './namedEntities';

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

    // CDATA sections fire a separate sax event (not ontext) — without this
    // handler, <![CDATA[...]]> content (common in codeblocks) is dropped.
    parser.oncdata = (text: string) => {
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
 * Common ISO/HTML character entities that DITA DTDs normally declare in
 * external subsets. The DOCTYPE (and with it those declarations) is
 * stripped before parsing, so map the frequent ones to literal characters
 * instead of silently deleting the text.
 */
const ISO_ENTITIES: Record<string, string> = {
  nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±',
  micro: 'µ', middot: '·', laquo: '«', raquo: '»', sect: '§', para: '¶',
  times: '×', divide: '÷', frac12: '½', frac14: '¼', frac34: '¾',
  sup1: '¹', sup2: '²', sup3: '³', cent: '¢', pound: '£', yen: '¥', euro: '€',
  ndash: '–', mdash: '—', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  hellip: '…', bull: '•', dagger: '†', Dagger: '‡', prime: '′', Prime: '″',
  larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔',
};

const BUILTIN_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

/** Nested-entity expansion cap; also what stops a self-referential declaration. */
const MAX_ENTITY_DEPTH = 8;

/** A CDATA section or comment (left verbatim) or a named entity reference. */
const CDATA_COMMENT_OR_ENTITY_REF = /(<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->)|&([a-zA-Z_][a-zA-Z0-9_.-]*);/g;

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

/**
 * Preprocess XML to avoid SAX parse errors:
 * 1. Extract general entity declarations from the DOCTYPE (single- or
 *    double-quoted; parameter entities `<!ENTITY % ...>` are ignored)
 * 2. Strip the entire DOCTYPE declaration
 * 3. Replace entity references outside CDATA sections and comments:
 *    declared entities (first declaration wins; values may reference other
 *    entities, expanded up to MAX_ENTITY_DEPTH) take precedence over the
 *    ISO/HTML character tables; built-in XML entities are kept as-is
 * 4. Any reference that still can't be resolved (e.g. declared in an
 *    external DTD subset that is never loaded) is kept as the literal
 *    text "&name;" rather than deleted -- deleting it made the text vanish
 *    without a trace, and a bare reference would make SAX throw
 *
 * CDATA sections and comments are left exactly as written: inside them
 * "&nbsp;" is just characters (e.g. a codeblock showing HTML), not a reference.
 */
export function preprocessEntities(xml: string): string {
  // 1. Extract simple entity declarations: <!ENTITY name "value"> / 'value'.
  //    `[^\s%]` as the first name character rejects parameter entities
  //    (<!ENTITY % name ...>), which are not referenced as &name;.
  const entityRegex = /<!ENTITY\s+([^\s%]\S*)\s+(?:"([^"]*)"|'([^']*)')\s*>/g;
  const declared = new Map<string, string>();
  let match;
  while ((match = entityRegex.exec(xml)) !== null) {
    if (!declared.has(match[1])) declared.set(match[1], match[2] ?? match[3]);
  }

  // 2. Strip the entire DOCTYPE declaration
  const stripped = stripDoctype(xml);

  // 3./4. One pass over everything that is not a CDATA section or comment.
  //    Values are substituted via a callback so '$&'/'$$' sequences in an
  //    entity value stay literal, and names are looked up in a Map so ones
  //    containing regex metacharacters (e.g. '.') match exactly.
  const expand = (text: string, depth: number): string =>
    text.replace(CDATA_COMMENT_OR_ENTITY_REF, (full: string, verbatim: string | undefined, name: string) => {
      if (verbatim !== undefined) return full;
      if (BUILTIN_ENTITIES.has(name)) return full;
      const declaredValue = declared.get(name);
      if (declaredValue !== undefined) {
        // Declared values are markup and are inserted as written.
        return depth < MAX_ENTITY_DEPTH ? expand(declaredValue, depth + 1) : `&amp;${name};`;
      }
      const chars = ISO_ENTITIES[name] ?? lookupNamedEntity(name);
      // Table values are plain characters: escape the markup-significant
      // ones (e.g. the HTML5 aliases &AMP; and &LT;).
      if (chars !== undefined) return chars.replace(/[&<>]/g, (c) => XML_ESCAPES[c]);
      return `&amp;${name};`;
    });

  return expand(stripped, 0);
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
