/* eslint-disable @typescript-eslint/no-explicit-any */
declare module 'sax' {
  interface Parser {
    write(xml: string): Parser;
    close(): Parser;
    line: number;
    column: number;
    onopentag: ((node: SAXNode) => void) | null;
    onclosetag: ((name: string) => void) | null;
    ontext: ((text: string) => void) | null;
    onerror: ((err: Error) => void) | null;
  }

  interface SAXNode {
    name: string;
    attributes: Record<string, string>;
    isSelfClosing: boolean;
  }

  function parser(strict: boolean, opts?: { trim?: boolean; normalize?: boolean }): Parser;
  export = parser;
}
