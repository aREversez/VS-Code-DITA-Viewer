<?xml version='1.0'?>
<!--
  Template overrides for the default org.dita.pdf2 (FOP) PDF pipeline. This is
  the second of the two extension points wired up in ../catalog.xml; it is
  imported last by topic2fo_shell.xsl, so a template defined here wins over the
  built-in one of the same name. Attribute-set overrides live in
  ../attrs/custom.xsl instead.
-->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fo="http://www.w3.org/1999/XSL/Format"
    xmlns:xs="http://www.w3.org/2001/XMLSchema"
    version="3.0">

  <!--
    Restart body page numbering at 1.

    org.dita.pdf2 ships startPageNumbering (xsl/fo/commons.xsl) as an empty
    named template, so the body <fo:page-sequence> gets no starting page number
    and its arabic counter keeps running from the roman front matter (cover +
    TOC pages), which is why the first body page was labelled 4 rather than 1.
    FOP derives both the printed <fo:page-number> (header/footer) and the PDF
    page label (the reader's page box) from that starting number, so resetting it
    here is what both pick up.

    The attribute is initial-page-number, NOT the XSL-FO name initial-value:
    FOP silently ignores initial-value here (verified against a real 2.11 run -
    the page still came out 4), while initial-page-number (the name DITA-OT's
    own commented-out reset used) takes effect. This is the one non-obvious gotcha
    of the whole fix.

    Guard: only the FIRST body sequence restarts. A bookmap emits one
    page-sequence per chapter/part, so an unconditional reset would send every
    chapter back to page 1; the "no preceding bookmap/chapter or bookmap/part"
    test keeps numbering continuous across them. A plain <map> has a single body
    sequence whose context node is the map itself (no topic ancestor, no bookmap
    elements), so that node-set is empty and it restarts, which is the desired
    outcome there too. Front matter, TOC and index never call this template, so
    their numbering is untouched. See the __force__page__count override in
    ../attrs/custom.xsl: resetting the body to an odd page would otherwise make
    a plain map's TOC pad itself with a blank page to keep the body on a recto;
    that override suppresses the pad for plain maps while leaving bookmaps as-is.
  -->
  <xsl:template name="startPageNumbering" as="attribute()*">
    <xsl:variable name="topic" as="element()?"
        select="ancestor-or-self::*[contains(@class, ' topic/topic ')][1]"/>
    <xsl:variable name="mapTopic" as="element()?"
        select="if ($topic) then key('map-id', $topic/@id)[1] else ()"/>
    <xsl:variable name="precedingBody" as="element()*"
        select="$mapTopic/preceding::*[contains(@class, ' bookmap/chapter ') or contains(@class, ' bookmap/part ')]
             | $mapTopic/ancestor::*[contains(@class, ' bookmap/chapter ') or contains(@class, ' bookmap/part ')]"/>
    <xsl:if test="empty($precedingBody)">
      <xsl:attribute name="initial-page-number">1</xsl:attribute>
    </xsl:if>
  </xsl:template>

  <!--
    Still open here (deliberately, pending a real render): a long, space-free
    <codeph> string can push past the column edge because XSL-FO only breaks
    lines at existing break opportunities. A fix would override the codeph
    template here to inject zero-width break opportunities without polluting
    copy-paste output; see the `codeph` comment in ../attrs/custom.xsl.
  -->

</xsl:stylesheet>
