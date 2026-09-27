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
    Fix: <codeph> was plain monospace with no visual separation from the
    surrounding sentence. The default (org.dita.pdf2/cfg/fo/attrs/pr-domain-attr.xsl)
    sets only font-family: monospace, which has to be repeated here since an
    override replaces rather than merges.

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

</xsl:stylesheet>
