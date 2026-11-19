// Parents whose content model is element-only, so a comment written inside
// them sits between blocks rather than inside a sentence and should get a
// block of its own. Everything else -- p, ph, li, entry, title, note text --
// holds mixed content, where an inline <span> is both valid and what the
// author saw. This is the same inline/block distinction profiling markers
// make (INLINE_PROFILING_BASETYPES), stated the other way round: there,
// inline was the short list; here the inline cases are the majority, and
// getting it wrong on the block side is the harmless direction (a comment on
// its own line inside a phrase) while a <div> inside a <p> would make the
// browser close the paragraph and split the sentence around it.
//
// Shared by the XML-comment renderer (renderer.ts) and the topic/draft-comment
// renderer (baseTypeMap.ts), which make the same inline/block decision for the
// same reason. Lives in its own module because renderer.ts imports
// baseTypeMap.ts at run time -- a value import the other way would be an
// import cycle (scripts/check-cycles.cjs).
export const BLOCK_COMMENT_PARENTS = new Set([
  'topic/body',
  'topic/section',
  'topic/example',
  'topic/fig',
  'topic/div',
  'topic/bodydiv',
  'topic/sectiondiv',
  'topic/topic',
  'topic/abstract',
  'topic/related-links',
  'topic/imagemap',
  // List containers: a comment written between two <li>s is not part of
  // either item's sentence, and an inline span there would be a stray
  // fragment of the previous item.
  'topic/ul',
  'topic/ol',
  'topic/sl',
  'topic/dl',
]);

// <draft-comment> is not limited to a sentence: its content model is
// %basic.phandblock; (DITA 1.3.2 commonElements.mod), so it may hold
// paragraphs, lists, tables and the like. An inline <span> around a <p> paints
// the comment's background in fragments either side of the paragraph, so a
// comment that holds one of these base types gets the block box -- but only
// where a <div> is a legal neighbor (BLOCK_CONTENT_HOSTS). Directly inside a
// <p> or a phrase it stays inline, because a <div> there would make the
// browser close the paragraph and split the sentence.
export const BLOCK_LEVEL_BASETYPES = new Set([
  'topic/p',
  'topic/ul',
  'topic/ol',
  'topic/sl',
  'topic/dl',
  'topic/table',
  'topic/simpletable',
  'topic/fig',
  'topic/note',
  'topic/pre',
  'topic/lines',
  'topic/lq',
  'topic/div',
]);

// Mixed-content parents that render as a block container (li, td, a note's
// body div, dd, ...), where a block-level comment is as legal as any <p>.
export const BLOCK_CONTENT_HOSTS = new Set([
  'topic/li',
  'topic/entry',
  'topic/stentry',
  'topic/dd',
  'topic/note',
  'topic/itemgroup',
  'topic/lq',
]);
