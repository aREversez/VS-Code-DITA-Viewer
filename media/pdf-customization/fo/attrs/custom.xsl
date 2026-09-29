<?xml version='1.0'?>
<!--
  Attribute-set overrides for the default org.dita.pdf2 (FOP) PDF pipeline.
  Loaded via media/pdf-customization/catalog.xml when the extension passes
  the `customization.dir` option for the `pdf` transtype (buildDitaOtArgs).

  Overriding an attribute-set here replaces the default one wholesale, so any
  attribute the default already sets has to be repeated, not just the new ones
  (see the notes on each block below).

  Stylesheet shell / attribute-set naming matches org.dita.pdf2's own
  cfg/fo/attrs/custom.xsl placeholder (XSLT 3.0, fo: namespace bound but unused
  here since attribute-set members are all plain FO properties).
-->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fo="http://www.w3.org/1999/XSL/Format"
    version="3.0">

  <!--
    Fix: a large image was drawn at its intrinsic pixel size and ran off the
    page. org.dita.pdf2's own `image` attribute-set (cfg/fo/attrs/topic-attr.xsl)
    ships empty, so this is a plain fill-in rather than a merge with anything
    the default already set.

    `width` sets the reference rectangle to the full available column width;
    FOP's `content-width`/`content-height` = "scale-down-to-fit" then shrink the
    image proportionally to fit inside it, and never scale a small image up
    ("uniform" keeps the aspect ratio while doing so). This is Apache FOP
    syntax, not core XSL-FO — other FO processors (e.g. RenderX) ignore it.
  -->
  <xsl:attribute-set name="image">
    <xsl:attribute name="width">100%</xsl:attribute>
    <xsl:attribute name="content-width">scale-down-to-fit</xsl:attribute>
    <xsl:attribute name="content-height">scale-down-to-fit</xsl:attribute>
    <xsl:attribute name="scaling">uniform</xsl:attribute>
  </xsl:attribute-set>

  <!--
    Fix: Latin text alternated between serif and sans-serif, which looked
    messy next to the (serif) CJK glyphs.

    org.dita.pdf2 sets the page root (__fo__root) to `serif`, but two of its
    attribute-sets hard-code `sans-serif`, and font-family inherits, so
    everything under them switches typeface:
      - `common.title` (cfg/fo/attrs/commons-attr.xsl): the base of every
        title (topic, section, example, table, figure, front-matter, running
        head/foot ...). Its only member is the font-family, so the override is
        just that one attribute.
      - `__toc__mini` (cfg/fo/attrs/toc-attr.xsl): the in-topic "mini TOC"
        (a heading block and its link list). Only font-family is actually
        changed; font-size and end-indent are repeated for explicitness (the
        toolkit merges an override with the default per-attribute, so they would
        carry over anyway - see the __toc__mini__table note further down).
    Both now say `serif`, the same logical font as the root, so the whole
    document resolves through the one Serif entry of font-mappings.xml.
    codeph and the other code/UI/markup sets stay monospace on purpose.
  -->
  <xsl:attribute-set name="common.title">
    <xsl:attribute name="font-family">serif</xsl:attribute>
  </xsl:attribute-set>

  <xsl:attribute-set name="__toc__mini">
    <xsl:attribute name="font-size">10.5pt</xsl:attribute>
    <xsl:attribute name="font-family">serif</xsl:attribute>
    <xsl:attribute name="end-indent">5pt</xsl:attribute>
  </xsl:attribute-set>

  <!--
    Fix: <codeph> was plain monospace with no visual separation from the
    surrounding sentence. The default (org.dita.pdf2/cfg/fo/attrs/pr-domain-attr.xsl)
    sets only font-family: monospace, repeated here for explicitness (an
    override merges with the default per-attribute, so it would persist anyway).

    Deliberately not addressed here: a very long, space-free <codeph> string
    (e.g. a long API path or hash) can still push past the column edge —
    XSL-FO line breaking only happens at existing break opportunities
    (spaces, hyphenation points), and code identifiers aren't in any language
    dictionary, so `hyphenate` doesn't help. That needs a text-level fix (e.g.
    injecting zero-width break opportunities from a template override in
    fo/xsl/custom.xsl), which is out of scope for this pass — see
    fo/xsl/custom.xsl for the placeholder left for it.
  -->
  <xsl:attribute-set name="codeph">
    <xsl:attribute name="font-family">monospace</xsl:attribute>
    <xsl:attribute name="background-color">#f0f0f0</xsl:attribute>
    <xsl:attribute name="padding-start">2pt</xsl:attribute>
    <xsl:attribute name="padding-end">2pt</xsl:attribute>
  </xsl:attribute-set>

  <!--
    Fix: stop the body page-number reset (fo/xsl/custom.xsl) from inserting a
    blank page at the end of the table of contents.

    Once the body sequence carries an explicit initial-page-number (odd, = 1),
    a preceding sequence with force-page-count="auto" pads itself to an even
    page count so the body opens on a right-hand (recto) page. For a plain
    <map> that padding is just a stray blank TOC page — pointless on screen and
    in single-sided output — so the non-bookmap branch drops from "auto" to
    "no-force". The bookmap branch is kept exactly as org.dita.pdf2 ships it
    ("even"): a real book is duplex-printed, so its recto alignment (and the
    blank pages that buy it) is intentional and left untouched.

    Override replaces the whole set, so the bookmap branch is repeated verbatim
    from cfg/fo/attrs/commons-attr.xsl; only the <xsl:otherwise> value differs.
  -->
  <xsl:attribute-set name="__force__page__count">
    <xsl:attribute name="force-page-count">
      <xsl:choose>
        <xsl:when test="/*[contains(@class, ' bookmap/bookmap ')]">
          <xsl:value-of select="'even'"/>
        </xsl:when>
        <xsl:otherwise>
          <xsl:value-of select="'no-force'"/>
        </xsl:otherwise>
      </xsl:choose>
    </xsl:attribute>
  </xsl:attribute-set>

  <!--
    Fix: number the cover/title page with a lowercase roman numeral too.

    The front cover is its own page-sequence (org.dita.pdf2's createFrontMatter,
    master-reference "front-matter") using the page-sequence.cover attribute-set,
    which ships with no `format`, so FOP defaults it to arabic: the reader showed
    the cover as "1" while the TOC right after it was already lowercase roman
    (ii, iii). Adding format="i" makes the cover "i", so the front matter reads
    i, ii, iii ... before the body restarts at 1. Override replaces the set
    wholesale, so the inherited __force__page__count is repeated to keep parity
    handling identical to the default.
  -->
  <xsl:attribute-set name="page-sequence.cover" use-attribute-sets="__force__page__count">
    <xsl:attribute name="format">i</xsl:attribute>
  </xsl:attribute-set>

  <!--
    Fix: a table-of-contents / list-of-figures / list-of-tables page that sits
    in <backmatter> was numbered in lowercase roman, and the roman numeral
    carried on from the body (a 895-page book listed its "List of Figures" at
    page "dcccxcv").

    org.dita.pdf2 gives page-sequence.toc (and lot / lof, which inherit it)
    the frontmatter attribute-set, whose only member is format="i". That is
    right for a booklist in <frontmatter>, where the pages really do come
    before the arabic body. In <backmatter> the same pages come AFTER the body,
    so their counter keeps running from it, and a roman format prints - and
    cites, in the TOC's page-number-citation - that running count in roman.

    The sequence's context node is the ot-placeholder:* element; its @id is the
    id of the booklist entry in the merged map (the same pairing
    processTopicNotices uses for backmatter notices), so the map tells us which
    matter it belongs to. Backmatter -> arabic ("1"), everything else keeps "i".
    The condition lives inside the attribute value because an attribute-set may
    contain only xsl:attribute. Own members override used sets, so this wins
    over the inherited page-sequence.frontmatter format; force-page-count is
    repeated from __force__page__count exactly as the default composes it.
  -->
  <xsl:attribute-set name="page-sequence.toc" use-attribute-sets="__force__page__count page-sequence.frontmatter">
    <xsl:attribute name="format"
        select="if (exists(@id) and exists(key('map-id', @id)/ancestor::*[contains(@class, ' bookmap/backmatter ')])) then '1' else 'i'"/>
  </xsl:attribute-set>

  <!--
    Fix: keep a chapter's content on the same page as its title.

    Each bookmap chapter opens with a two-column "in this chapter" table
    (createMiniToc: left column = the subtopic list, right column = the
    chapter's own shortdesc/body), and the child topics flow *after* that table.
    org.dita.pdf2 puts page-break-after="always" on the table
    (cfg/fo/attrs/toc-attr.xsl __toc__mini__table), so the child topics were
    forced onto a fresh page - leaving the title + subtopic list alone on the
    opener page, which reads as "the chapter title got its own page". Setting
    the break to auto lets the first child topic continue on the same page.

    It has to be set to "auto" explicitly, not simply omitted: an attribute-set
    override here is merged per-attribute with the default (verified - dropping
    page-break-after from the override left the default "always" on the rendered
    fo:table), so removing an inherited attribute by omission does not work; you
    have to override its value. table-layout and width are repeated to keep them
    explicit regardless.
  -->
  <xsl:attribute-set name="__toc__mini__table">
    <xsl:attribute name="table-layout">fixed</xsl:attribute>
    <xsl:attribute name="width">100%</xsl:attribute>
    <xsl:attribute name="page-break-after">auto</xsl:attribute>
  </xsl:attribute-set>

</xsl:stylesheet>
