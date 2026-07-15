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

/** Preprocess DOCTYPE entity declarations to avoid SAX parse errors */
export function preprocessEntities(xml: string): string {
  const entityRegex = /<!ENTITY\s+(\S+)\s+"((?:[^"\\]|\\.)*)">/g;
  let match;
  const entities: Array<[string, string]> = [];
  while ((match = entityRegex.exec(xml)) !== null) {
    entities.push([match[1], match[2]]);
  }
  if (entities.length === 0) return xml;
  let result = xml.replace(entityRegex, '');
  for (const [name, value] of entities) {
    result = result.replace(new RegExp(`&${name};`, 'g'), value);
  }
  return result;
}

const _parseDita = makeParser(STANDARD_TAG_TO_BASETYPE);
const _parseDitamap = makeParser(MAP_STANDARD_TAG_TO_BASETYPE);

export function parseDita(xml: string): DitaDocument {
  return _parseDita(xml);
}

export function parseDitamap(xml: string): DitaDocument {
  return _parseDitamap(xml);
}
