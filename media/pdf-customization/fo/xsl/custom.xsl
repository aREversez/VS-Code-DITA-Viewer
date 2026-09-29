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
    Drop the big chapter-number band from the chapter opener page.

    org.dita.pdf2 (xsl/fo/commons.xsl, insertChapterFirstpageStaticContent)
    paints, above every chapter/part/appendix title, a bordered band built from
    the localized 'Chapter with number' variable with the number wrapped in a
    40pt BLOCK-level fo:block. Two problems, both visible in the render:
      - the number block forces a line break on each side of itself, so the
        Chinese label "第{n}章" (cfg/common/vars/zh_cn.xml) stacks into three
        lines "第" / giant "1" / "章"; English "Chapter {n}" only hides this
        because it has no trailing word to push onto a third line.
      - the band repeats the number that the chapter title already carries
        (the title below is the auto-numbered "第 1 章 产品简介"), so the page
        shows "第 1 章" twice.
    Removing the band fixes both and leaves the chapter opening on its title.

    The band's wrapper <fo:block id="..."> is the internal-destination the PDF
    bookmark tree and the TOC links point at, so it is kept (as an empty, zero
    height block); only the number content is dropped. Overriding by the same
    match+mode wins because this stylesheet is imported last.
  -->
  <xsl:template match="*" mode="insertChapterFirstpageStaticContent">
    <xsl:param name="type" as="xs:string"/>
    <fo:block>
      <xsl:attribute name="id">
        <xsl:call-template name="generate-toc-id"/>
      </xsl:attribute>
    </fo:block>
  </xsl:template>

  <!--
    Images: honour @scale first, then keep whatever still overflows on the page.

    Before this, FOP only shrank an image to the column WIDTH
    (attrs/custom.xsl "image"), and a @scale (or @width) then replaced even that
    with a fixed size, so a scaled-up or very wide image still ran off the page
    and a long portrait screenshot was stretched to the full column and ran
    onto (and past) the next page, with its text drawn far too large.

    FOP cannot fit a height without a fixed viewport, and this stylesheet cannot
    read a bitmap header itself (Saxon-HE: unparsed-text rejects the control bytes
    every PNG starts with; no Java extensions), so the extension measures the
    images up front and stages them as image-sizes.xml beside this folder (see
    src/editor/pdfImageSizes.ts; the folder's location arrives as the
    customizationDir.url parameter). An image that is not in that file - or a
    run without the file - keeps the previous width-only behaviour.

    Sizing, in points, for an image found in the file:
      1. natural size = pixels at the file's own density (72 dpi if it records
         none, which is what FOP itself assumes);
      2. an explicit @width / @height wins, else @scale% (own or inherited, exactly
         as org.dita.pdf2 reads it), else the natural size;
      3. a portrait image (taller than 1.2 x its width) with neither of those
         is capped at 60% of the column: a phone-shaped screenshot at full
         column width is a page tall with oversized text, and this is the one
         case where "as large as fits" is the wrong default;
      4. whatever is still wider than the column, or taller than 80% of the
         body height (room for the figure title and the text around it), is
         shrunk uniformly until it fits. Images are never enlarged past step 2.

    Not touched: images inside table cells (the cell width is unknown here, the
    old width-only fit still applies) and anything the file has no entry for.
    The 60% / 80% constants are the two tuning knobs.

    Implemented as a wrapper around the stock placeImage template
    (xsl:next-match), then a rewrite of the size attributes on the one
    fo:external-graphic it produced, so nothing else in that template (alignment,
    alt text, ditaval flags) is copied here or can drift from the toolkit.
  -->
  <xsl:variable name="vdv:image-sizes-uri" as="xs:string?"
      select="if (string($customizationDir.url) != '')
              then replace($customizationDir.url, '/+$', '') || '/image-sizes.xml'
              else ()"/>
  <xsl:variable name="vdv:image-sizes" as="document-node()?"
      select="if (exists($vdv:image-sizes-uri) and doc-available($vdv:image-sizes-uri))
              then doc($vdv:image-sizes-uri) else ()"/>
  <xsl:key name="vdv-image-size" match="image" use="@key"/>

  <xsl:variable name="vdv:portrait-width-ratio" as="xs:double" select="0.6"/>
  <xsl:variable name="vdv:max-height-ratio" as="xs:double" select="0.8"/>
  <xsl:variable name="vdv:list-indent-pt" as="xs:double" select="24"/>

  <!-- A length as points; a bare number is a pixel (FOP: 96 ppi), as org.dita.pdf2 treats @width/@height. -->
  <xsl:function name="vdv:pt" as="xs:double?">
    <xsl:param name="length" as="xs:string?"/>
    <xsl:variable name="v" select="normalize-space($length)"/>
    <xsl:if test="matches($v, '^-?[0-9]*\.?[0-9]+\s*(mm|cm|in|pt|pc|px)?$')">
      <xsl:variable name="n" select="xs:double(replace($v, '^(-?[0-9]*\.?[0-9]+).*$', '$1'))"/>
      <xsl:variable name="unit" select="replace($v, '^-?[0-9]*\.?[0-9]+\s*', '')"/>
      <xsl:sequence select="$n * (if ($unit = 'mm') then 72 div 25.4
                                  else if ($unit = 'cm') then 72 div 2.54
                                  else if ($unit = 'in') then 72
                                  else if ($unit = 'pc') then 12
                                  else if ($unit = 'pt') then 1
                                  else 0.75)"/>
    </xsl:if>
  </xsl:function>

  <!-- Same recipe as imageSizeKey() in src/editor/pdfImageSizes.ts. -->
  <xsl:function name="vdv:image-key" as="xs:string">
    <xsl:param name="url" as="xs:string"/>
    <xsl:variable name="path" select="replace(replace(replace($url, '\\', '/'), '^file:', '', 'i'), '^/+', '')"/>
    <xsl:variable name="segments" as="xs:string*"
        select="fold-left(tokenize($path, '/')[not(. = ('', '.'))], (),
                          function($acc as xs:string*, $s as xs:string) as xs:string* {
                            if ($s = '..') then $acc[position() lt last()] else ($acc, $s)
                          })"/>
    <xsl:sequence select="lower-case(iri-to-uri(string-join($segments, '/')))"/>
  </xsl:function>

  <xsl:mode name="vdv:fit-image" on-no-match="shallow-copy"/>

  <xsl:template match="*[contains(@class, ' topic/image ')]" mode="placeImage" priority="10">
    <xsl:param name="imageAlign"/>
    <xsl:param name="href"/>
    <xsl:param name="height" as="xs:string?"/>
    <xsl:param name="width" as="xs:string?"/>
    <xsl:variable name="scale" as="xs:string?"
        select="(@scale, ancestor::*[@scale][1]/@scale)[1]/string()"/>
    <xsl:variable name="rendered" as="node()*">
      <xsl:next-match>
        <xsl:with-param name="imageAlign" select="$imageAlign"/>
        <xsl:with-param name="href" select="$href"/>
        <xsl:with-param name="height" select="$height"/>
        <xsl:with-param name="width" select="$width"/>
      </xsl:next-match>
    </xsl:variable>

    <xsl:variable name="fit" as="attribute()*">
      <xsl:if test="exists($vdv:image-sizes)
                    and empty(ancestor::*[contains(@class, ' topic/entry ') or contains(@class, ' topic/stentry ')])">
        <xsl:variable name="m" as="element()?"
            select="key('vdv-image-size', vdv:image-key(string($href)), $vdv:image-sizes)[1]"/>
        <xsl:if test="exists($m) and xs:double($m/@width) gt 0 and xs:double($m/@height) gt 0">
          <xsl:variable name="dpi" select="xs:double($m/@dpi)"/>
          <xsl:variable name="w0" select="xs:double($m/@width) * 72 div $dpi"/>
          <xsl:variable name="h0" select="xs:double($m/@height) * 72 div $dpi"/>
          <xsl:variable name="reqW" select="vdv:pt($width)"/>
          <xsl:variable name="reqH" select="vdv:pt($height)"/>
          <xsl:variable name="pct" as="xs:double?"
              select="if (matches($scale, '^\s*[0-9]*\.?[0-9]+\s*$') and xs:double($scale) gt 0)
                      then xs:double($scale) div 100 else ()"/>
          <xsl:variable name="sized" as="xs:boolean"
              select="exists($reqW) or exists($reqH) or exists($pct)"/>
          <!-- step 2: the size the author asked for -->
          <xsl:variable name="want" as="xs:double+"
              select="if (exists($reqW) and exists($reqH)) then ($reqW, $reqH)
                      else if (exists($reqW)) then ($reqW, $reqW * $h0 div $w0)
                      else if (exists($reqH)) then ($reqH * $w0 div $h0, $reqH)
                      else if (exists($pct)) then ($w0 * $pct, $h0 * $pct)
                      else ($w0, $h0)"/>
          <!-- step 3: an unsized portrait image is narrowed -->
          <xsl:variable name="bodyW" as="xs:double"
              select="vdv:pt($page-width) - vdv:pt($page-margin-inside) - vdv:pt($page-margin-outside)"/>
          <!-- A top-level bookmap topic's own body (before its child topics) is set in the
               right-hand 65% cell of the "in this chapter" table (createMiniToc: 10pt padding
               + 1pt rule); everything else sits in the body column indented by side-col-width. -->
          <xsl:variable name="topLevel" as="element()?"
              select="if (count(ancestor::*[contains(@class, ' topic/topic ')]) = 1)
                      then key('map-id', ancestor::*[contains(@class, ' topic/topic ')][1]/@id)[1] else ()"/>
          <xsl:variable name="inMiniToc" as="xs:boolean"
              select="exists($topLevel[contains(@class, ' bookmap/chapter ') or contains(@class, ' bookmap/appendix ')
                                       or contains(@class, ' bookmap/part ') or contains(@class, ' bookmap/preface ')])"/>
          <xsl:variable name="col" as="xs:double"
              select="(if ($inMiniToc) then $bodyW * 0.65 - 11 else $bodyW - vdv:pt($side-col-width))
                      - $vdv:list-indent-pt * count(ancestor::*[contains(@class, ' topic/li ')
                                                                or contains(@class, ' topic/sli ')
                                                                or contains(@class, ' topic/dd ')])"/>
          <xsl:variable name="k1" as="xs:double"
              select="if (not($sized) and $h0 gt 1.2 * $w0)
                      then min((1, $col * $vdv:portrait-width-ratio div $want[1])) else 1"/>
          <xsl:variable name="w1" select="$want[1] * $k1"/>
          <xsl:variable name="h1" select="$want[2] * $k1"/>
          <!-- step 4: whatever still overflows the column or the page is shrunk -->
          <xsl:variable name="maxH" as="xs:double"
              select="(vdv:pt($page-height) - vdv:pt($page-margin-top) - vdv:pt($page-margin-bottom))
                      * $vdv:max-height-ratio"/>
          <xsl:variable name="k2" as="xs:double"
              select="min((1, $col div $w1, $maxH div $h1))"/>
          <xsl:if test="$col gt 0 and $maxH gt 0 and $w1 * $k2 ge 1 and $h1 * $k2 ge 1">
            <xsl:attribute name="width" select="concat(format-number($w1 * $k2, '0.##'), 'pt')"/>
            <xsl:attribute name="height" select="concat(format-number($h1 * $k2, '0.##'), 'pt')"/>
            <xsl:attribute name="content-width" select="'scale-to-fit'"/>
            <xsl:attribute name="content-height" select="'scale-to-fit'"/>
            <xsl:attribute name="scaling" select="'uniform'"/>
          </xsl:if>
        </xsl:if>
      </xsl:if>
    </xsl:variable>
    <xsl:apply-templates select="$rendered" mode="vdv:fit-image">
      <xsl:with-param name="fit" select="$fit" tunnel="yes"/>
    </xsl:apply-templates>
  </xsl:template>

  <xsl:template match="fo:external-graphic" mode="vdv:fit-image">
    <xsl:param name="fit" as="attribute()*" tunnel="yes"/>
    <xsl:copy>
      <xsl:copy-of select="@* except @*[node-name(.) = $fit/node-name(.)]"/>
      <xsl:copy-of select="$fit"/>
      <xsl:apply-templates select="node()" mode="#current"/>
    </xsl:copy>
  </xsl:template>

  <!--
    Still open here (deliberately, pending a real render): a long, space-free
    <codeph> string can push past the column edge because XSL-FO only breaks
    lines at existing break opportunities. A fix would override the codeph
    template here to inject zero-width break opportunities without polluting
    copy-paste output; see the `codeph` comment in ../attrs/custom.xsl.
  -->

</xsl:stylesheet>
