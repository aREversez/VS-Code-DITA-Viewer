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