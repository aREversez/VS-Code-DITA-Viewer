<?xml version="1.0" encoding="UTF-8"?>
<!--
  Insert one space where resolved key text touches CJK/Latin text.
  Same rule as src/render/cjkSpacing.ts (needsSpace): a CJK ideograph next to a
  Latin letter/digit with nothing between them. Whitespace, punctuation and
  same-script neighbours are left alone. Adjacent keys share one gap.
-->
<xsl:stylesheet version="2.0"
                xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
                xmlns:xs="http://www.w3.org/2001/XMLSchema"
                xmlns:dv="urn:dita-viewer:cjk-spacing"
                exclude-result-prefixes="xs dv">

  <xsl:variable name="cjk" select="'[&#x4E00;-&#x9FFF;]'"/>
  <xsl:variable name="latin" select="'[A-Za-z0-9]'"/>
  <!-- Literal contexts: code, paths, names -->
  <xsl:variable name="literal"
                select="' [a-z-]+/(codeblock|codeph|filepath|varname|cmdname|msgph|systemoutput|userinput|apiname|parmname|option) '"/>

  <xsl:function name="dv:needs-space" as="xs:boolean">
    <xsl:param name="prev" as="xs:string?"/>
    <xsl:param name="next" as="xs:string?"/>
    <xsl:sequence select="exists($prev) and exists($next) and $prev != '' and $next != ''
      and ((matches($prev, $cjk) and matches($next, $latin))
        or (matches($prev, $latin) and matches($next, $cjk)))"/>
  </xsl:function>

  <xsl:function name="dv:eligible" as="xs:boolean">
    <xsl:param name="e" as="node()?"/>
    <xsl:sequence select="$e instance of element() and exists($e/@keyref)
      and string-length(string($e)) gt 0
      and not($e/ancestor-or-self::*[matches(@class, $literal)])
      and not(tokenize($e/@outputclass, '\s+') = 'no-cjk-spacing')"/>
  </xsl:function>

  <!-- Nearest sibling that contributes text, skipping comments/PIs/empty nodes -->
  <xsl:function name="dv:prev-char" as="xs:string?">
    <xsl:param name="e" as="element()"/>
    <xsl:variable name="p" select="($e/preceding-sibling::node()[not(self::comment() or self::processing-instruction())]
                                     [string-length(string(.)) gt 0])[last()]"/>
    <xsl:sequence select="if ($p) then substring(string($p), string-length(string($p))) else ()"/>
  </xsl:function>

  <xsl:function name="dv:next-char" as="xs:string?">
    <xsl:param name="e" as="element()"/>
    <xsl:variable name="n" select="($e/following-sibling::node()[not(self::comment() or self::processing-instruction())]
                                     [string-length(string(.)) gt 0])[1]"/>
    <xsl:sequence select="if ($n) then substring(string($n), 1, 1) else ()"/>
  </xsl:function>

  <xsl:template match="@* | node()">
    <xsl:copy>
      <xsl:apply-templates select="@* | node()"/>
    </xsl:copy>
  </xsl:template>

  <xsl:template match="*[dv:eligible(.)]" priority="10">
    <xsl:variable name="text" select="string(.)"/>
    <xsl:variable name="prev-el"
                  select="(preceding-sibling::node()[not(self::comment() or self::processing-instruction())]
                            [string-length(string(.)) gt 0])[last()]"/>
    <!-- The left neighbour key owns a shared gap, so we skip ours -->
    <xsl:if test="dv:needs-space(dv:prev-char(.), substring($text, 1, 1)) and not(dv:eligible($prev-el))">
      <xsl:text> </xsl:text>
    </xsl:if>
    <xsl:copy>
      <xsl:apply-templates select="@* | node()"/>
    </xsl:copy>
    <xsl:if test="dv:needs-space(substring($text, string-length($text)), dv:next-char(.))">
      <xsl:text> </xsl:text>
    </xsl:if>
  </xsl:template>
</xsl:stylesheet>
