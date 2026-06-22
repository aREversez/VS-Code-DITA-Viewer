"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDita = parseDita;
const sax_1 = __importDefault(require("sax"));
const standardTagMap_1 = require("./standardTagMap");
const TOPIC_PATTERN = /^(topic|map)\//;
function parseBaseType(tagName, classAttr) {
    const fromTag = standardTagMap_1.STANDARD_TAG_TO_BASETYPE[tagName];
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
}
function makeRange() {
    return { startLine: 0, startCol: 0, endLine: 0, endCol: 0 };
}
function parseDita(xml) {
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
}
//# sourceMappingURL=ditaParser.js.map