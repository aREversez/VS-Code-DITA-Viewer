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

  // Misc
  ph: 'topic/ph',
  draftComment: 'topic/draft-comment',
  requiredCleanup: 'topic/required-cleanup',
  data: 'topic/data',
  dataAbout: 'topic/data-about',
  foreign: 'topic/foreign',
  state: 'topic/state',
};
