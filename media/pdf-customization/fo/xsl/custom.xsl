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
    xmlns:opentopic="http://www.idiominc.com/opentopic"
    xmlns:vdv="urn:dita-viewer:pdf-customization"
    exclude-result-prefixes="xs opentopic vdv"
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
    Chapter / appendix / part numbers count only entries that produce a page.

    org.dita.pdf2 numbers a bookmap chapter (and appendix, part) with
    <xsl:number count="bookmap/chapter"> over the map, i.e. it counts every
    <chapter> element, including ones that never become a topic in the PDF:
    a key-only <chapter keys="product_version"> (a keydef in disguise, kept in
    the map purely for keyref text substitution) has no @href, so it renders
    nothing, yet it still consumed a number. The first real chapter came out as
    "Chapter 2", and the same skewed number appears in both the table of
    contents and the chapter's own title (both go through the topicTitleNumber
    mode), so the TOC no longer matched what a reader counting the printed
    chapters would expect.

    An entry renders if, and only if, the merged intermediate file holds a
    topic carrying the entry's @id (the same map-id <-> topic-id pairing
    org.dita.pdf2 itself relies on to find a chapter's topic); a key-only
    entry has no such topic. A resource-only entry is already dropped from the
    merged map before this stylesheet runs, so it needs no case of its own.
    Everything else about the numbering is kept as the default has it:
    chapters run on across <part> boundaries, appendices restart within their
    parent, and a plain <map> (whose top-level topicrefs are matched by the
    default template too, but which it leaves un-numbered) is still
    un-numbered.
  
  -->
  <xsl:function name="vdv:renders-topic" as="xs:boolean">
    <xsl:param name="entry" as="element()"/>
    <xsl:sequence select="exists($entry/@id) and exists(key('topic-id', $entry/@id, root($entry)))"/>
  </xsl:function>

  <xsl:template match="*[contains(@class, ' bookmap/chapter ')] |
                       opentopic:map/*[contains(@class, ' map/topicref ')]" mode="topicTitleNumber" priority="-1">
    <xsl:variable name="self" select="." as="element()"/>
    <xsl:if test="contains(@class, ' bookmap/chapter ') and vdv:renders-topic($self)">
      <xsl:number value="count($map/descendant::*[contains(@class, ' bookmap/chapter ')][vdv:renders-topic(.)]
                                                 [. &lt;&lt; $self or . is $self])"
                  format="1"/>
    </xsl:if>
  </xsl:template>

  <xsl:template match="*[contains(@class, ' bookmap/appendix ')]" mode="topicTitleNumber">
    <xsl:number format="A" count="*[contains(@class, ' bookmap/appendix ')][vdv:renders-topic(.)]"/>
  </xsl:template>

  <xsl:template match="*[contains(@class, ' bookmap/part ')]" mode="topicTitleNumber">
    <xsl:number format="I" count="*[contains(@class, ' bookmap/part ')][vdv:renders-topic(.)]"/>
  </xsl:template>

  <!--
    Still open here (deliberately, pending a real render): a long, space-free
    <codeph> string can push past the column edge because XSL-FO only breaks
    lines at existing break opportunities. A fix would override the codeph
    template here to inject zero-width break opportunities without polluting
    copy-paste output; see the `codeph` comment in ../attrs/custom.xsl.
  -->

</xsl:stylesheet>
