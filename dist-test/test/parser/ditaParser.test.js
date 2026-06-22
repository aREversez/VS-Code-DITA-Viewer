"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const ditaParser_1 = require("../../parser/ditaParser");
describe('ditaParser', () => {
    it('should parse a minimal topic with title and shortdesc', () => {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE topic PUBLIC "-//OASIS//DTD DITA Topic//EN" "topic.dtd">
<topic id="test">
  <title>Test Title</title>
  <shortdesc>A short description.</shortdesc>
</topic>`;
        const doc = (0, ditaParser_1.parseDita)(xml);
        assert.strictEqual(doc.root.tagName, 'topic');
        assert.strictEqual(doc.root.baseType, 'topic/topic');
        const elements = doc.root.children.filter((c) => c.type === 'element');
        assert.strictEqual(elements.length, 2);
        const title = elements[0];
        assert.strictEqual(title.baseType, 'topic/title');
        assert.strictEqual(title.children[0].text, 'Test Title');
        const shortdesc = elements[1];
        assert.strictEqual(shortdesc.baseType, 'topic/shortdesc');
    });
    it('should map tagName to baseType via STANDARD_TAG_TO_BASETYPE', () => {
        const xml = `<topic id="t"><body><p>para</p><note type="warning">note</note></body></topic>`;
        const doc = (0, ditaParser_1.parseDita)(xml);
        const body = doc.root.children[0];
        assert.strictEqual(body.baseType, 'topic/body');
        const p = body.children[0];
        assert.strictEqual(p.baseType, 'topic/p');
        const note = body.children[1];
        assert.strictEqual(note.baseType, 'topic/note');
        assert.strictEqual(note.attributes?.type, 'warning');
    });
    it('should fall back to class attribute when tag is not in standard map', () => {
        const xml = `<topic id="t"><body><customElement class="- topic/p mydomain/myelem ">text</customElement></body></topic>`;
        const doc = (0, ditaParser_1.parseDita)(xml);
        const body = doc.root.children[0];
        const custom = body.children[0];
        assert.strictEqual(custom.tagName, 'customElement');
        assert.strictEqual(custom.baseType, 'topic/p');
        assert.deepStrictEqual(custom.classTokens, ['-', 'topic/p', 'mydomain/myelem']);
    });
    it('should set baseType to undefined for unknown tag without class', () => {
        const xml = `<topic id="t"><body><unknown>text</unknown></body></topic>`;
        const doc = (0, ditaParser_1.parseDita)(xml);
        const body = doc.root.children[0];
        const unknown = body.children[0];
        assert.strictEqual(unknown.tagName, 'unknown');
        assert.strictEqual(unknown.baseType, undefined);
    });
    it('should handle lists properly', () => {
        const xml = `<topic id="t"><body><ol><li>one</li><li>two</li></ol></body></topic>`;
        const doc = (0, ditaParser_1.parseDita)(xml);
        const body = doc.root.children[0];
        const ol = body.children[0];
        assert.strictEqual(ol.baseType, 'topic/ol');
        assert.strictEqual(ol.children.length, 2);
        assert.strictEqual(ol.children[0].baseType, 'topic/li');
    });
    it('should parse CALS table structure', () => {
        const xml = `<topic id="t"><body><table><tgroup cols="2"><colspec colname="c1"/><thead><row><entry>H1</entry></row></thead><tbody><row><entry>D1</entry></row></tbody></tgroup></table></body></topic>`;
        const doc = (0, ditaParser_1.parseDita)(xml);
        const body = doc.root.children[0];
        const table = body.children[0];
        assert.strictEqual(table.baseType, 'topic/table');
        const tgroup = table.children[0];
        assert.strictEqual(tgroup.baseType, 'topic/tgroup');
    });
    it('should preserve sourceRange on elements', () => {
        const xml = `<topic id="t"><title>Hello</title></topic>`;
        const doc = (0, ditaParser_1.parseDita)(xml);
        assert.ok(doc.root.sourceRange.startLine >= 0);
        const title = doc.root.children[0];
        assert.ok(title.sourceRange.startLine >= 0);
        assert.ok(title.sourceRange.endLine >= title.sourceRange.startLine);
    });
    it('should handle inline formatting elements', () => {
        const xml = `<topic id="t"><body><p><b>bold</b> and <i>italic</i></p></body></topic>`;
        const doc = (0, ditaParser_1.parseDita)(xml);
        const body = doc.root.children[0];
        const p = body.children[0];
        assert.strictEqual(p.children[0].baseType, 'topic/b');
        assert.strictEqual(p.children[2].baseType, 'topic/i');
    });
    it('should handle codeblock and pre', () => {
        const xml = `<topic id="t"><body><codeblock>code here</codeblock><pre>pre text</pre></body></topic>`;
        const doc = (0, ditaParser_1.parseDita)(xml);
        const body = doc.root.children[0];
        assert.strictEqual(body.children[0].baseType, 'topic/codeblock');
        assert.strictEqual(body.children[1].baseType, 'topic/pre');
    });
});
//# sourceMappingURL=ditaParser.test.js.map