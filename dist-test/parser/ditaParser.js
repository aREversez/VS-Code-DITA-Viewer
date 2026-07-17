"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.preprocessEntities = preprocessEntities;
exports.parseDita = parseDita;
exports.parseDitamap = parseDitamap;
const sax_1 = __importDefault(require("sax"));
const standardTagMap_1 = require("./standardTagMap");
const mapTagMap_1 = require("./mapTagMap");
const TOPIC_PATTERN = /^(topic|map)\//;
function makeParseBaseType(tagMap) {
    return function parseBaseType(tagName, classAttr) {
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
function makeRange() {
    return { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
}
function makeParser(tagMap) {
    const parseBaseType = makeParseBaseType(tagMap);
    return function parseXml(xml) {
        const parser = sax_1.default.parser(true, { trim: false, normalize: false });
        const root = {
            type: 'element',
            children: [],
            sourceRange: makeRange(),
        };
        const stack = [root];
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
            const classAttr = node.attributes['class'];
            const baseType = parseBaseType(tagName, classAttr);
            const classTokens = classAttr
                ? classAttr.trim().split(/\s+/).filter(Boolean)
                : undefined;
            const element = {
                type: 'element',
                tagName,
                classTokens,
                baseType,
                attributes: node.attributes,
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
        parser.ontext = (text) => {
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
        const docRoot = root.children.find((c) => c.type === 'element');
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
function preprocessEntities(xml) {
    const entityRegex = /<!ENTITY\s+(\S+)\s+"((?:[^"\\]|\\.)*)">/g;
    let match;
    const entities = [];
    while ((match = entityRegex.exec(xml)) !== null) {
        entities.push([match[1], match[2]]);
    }
    if (entities.length === 0)
        return xml;
    let result = xml.replace(entityRegex, '');
    for (const [name, value] of entities) {
        result = result.replace(new RegExp(`&${name};`, 'g'), value);
    }
    return result;
}
const _parseDita = makeParser(standardTagMap_1.STANDARD_TAG_TO_BASETYPE);
const _parseDitamap = makeParser(mapTagMap_1.MAP_STANDARD_TAG_TO_BASETYPE);
function parseDita(xml) {
    return _parseDita(xml);
}
function parseDitamap(xml) {
    return _parseDitamap(xml);
}
//# sourceMappingURL=ditaParser.js.map