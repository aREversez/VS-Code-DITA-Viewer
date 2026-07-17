export const STANDARD_TAG_TO_BASETYPE: Record<string, string> = {
  // Root & structure
  topic: 'topic/topic',
  title: 'topic/title',
  shortdesc: 'topic/shortdesc',
  body: 'topic/body',
  section: 'topic/section',
  example: 'topic/example',

  // Paragraphs & notes
  p: 'topic/p',
  note: 'topic/note',

  // Lists
  ul: 'topic/ul',
  ol: 'topic/ol',
  li: 'topic/li',
  sl: 'topic/sl',
  sli: 'topic/sli',

  // Definition lists
  dl: 'topic/dl',
  dlentry: 'topic/dlentry',
  dt: 'topic/dt',
  dd: 'topic/dd',

  // Complex table (CALS)
  table: 'topic/table',
  tgroup: 'topic/tgroup',
  colspec: 'topic/colspec',
  thead: 'topic/thead',
  tbody: 'topic/tbody',
  row: 'topic/row',
  entry: 'topic/entry',

  // Simple table
  simpletable: 'topic/simpletable',
  sthead: 'topic/sthead',
  strow: 'topic/strow',
  stentry: 'topic/stentry',

  // Media
  image: 'topic/image',
  fig: 'topic/fig',

  // Code & preformatted
  codeblock: 'topic/codeblock',
  pre: 'topic/pre',

  // Links
  xref: 'topic/xref',
  link: 'topic/link',
  linktext: 'topic/linktext',
  relatedLinks: 'topic/related-links',

  // Inline formatting
  b: 'topic/b',
  i: 'topic/i',
  u: 'topic/u',
  tt: 'topic/tt',
  sup: 'topic/sup',
  sub: 'topic/sub',

  // Quotes
  q: 'topic/q',
  lq: 'topic/lq',

  // Semantic inline
  keyword: 'topic/keyword',
  term: 'topic/term',

  // UI & interaction
  uicontrol: 'topic/uicontrol',
  wintitle: 'topic/wintitle',
  menucascade: 'topic/menucascade',

  // Computer interaction
  filepath: 'topic/filepath',
  userinput: 'topic/userinput',
  systemoutput: 'topic/systemoutput',

  // API & code references
  apiname: 'topic/apiname',
  option: 'topic/option',
  parmname: 'topic/parmname',
  cmdname: 'topic/cmdname',
  varname: 'topic/varname',
  msgnum: 'topic/msgnum',

  // Misc
  ph: 'topic/ph',
  draftComment: 'topic/draft-comment',
  requiredCleanup: 'topic/required-cleanup',
  data: 'topic/data',
  dataAbout: 'topic/data-about',
  foreign: 'topic/foreign',
  state: 'topic/state',

  // Programming domain (missing)
  codeph: 'topic/codeph',
  coderef: 'topic/coderef',
  synph: 'topic/synph',
  kwd: 'topic/kwd',
  var: 'topic/var',
  oper: 'topic/oper',
  sep: 'topic/sep',
  delim: 'topic/delim',
  fragment: 'topic/fragment',
  fragref: 'topic/fragref',
  synblk: 'topic/synblk',
  synnote: 'topic/synnote',
  synnoteref: 'topic/synnoteref',
  syntaxdiagram: 'topic/syntaxdiagram',

  // Software domain
  screen: 'topic/screen',
  msgph: 'topic/msgph',
  msgblock: 'topic/msgblock',

  // Common body elements
  lines: 'topic/lines',
  fn: 'topic/fn',
  cite: 'topic/cite',
  boolean: 'topic/boolean',
  tm: 'topic/tm',
  indexterm: 'topic/indexterm',
  indextermref: 'topic/indextermref',
  'index-see': 'topic/index-see',
  'index-see-also': 'topic/index-see-also',
  'index-sort-as': 'topic/index-sort-as',
  'index-base': 'topic/index-base',
  div: 'topic/div',
  sectiondiv: 'topic/sectiondiv',
  bodydiv: 'topic/bodydiv',
  desc: 'topic/desc',
  alt: 'topic/alt',

  // Parameter lists
  parml: 'topic/parml',
  plentry: 'topic/plentry',
  pt: 'topic/pt',
  pd: 'topic/pd',

  // Abbreviation & glossary
  'abbreviated-form': 'topic/abbreviated-form',
  glossterm: 'topic/glossterm',
  glossdef: 'topic/glossdef',
  glossentry: 'topic/glossentry',
  glossref: 'topic/glossref',
  glossgroup: 'topic/glossgroup',

  // Hazard
  hazardstatement: 'topic/hazardstatement',
  typeofhazard: 'topic/typeofhazard',
  hazardsymbol: 'topic/hazardsymbol',
  howtoavoid: 'topic/howtoavoid',
  consequence: 'topic/consequence',

  // Multimedia
  object: 'topic/object',
  param: 'topic/param',

  // Anchors
  anchor: 'topic/anchor',
  anchorid: 'topic/anchorid',
  anchorkey: 'topic/anchorkey',
  anchorref: 'topic/anchorref',

};
