<?xml version='1.0'?>
<!--
  Template overrides for the default org.dita.pdf2 (FOP) PDF pipeline. This is
  the second of the two extension points wired up in ../catalog.xml; it is kept
  empty for now — no `xsl:template` needs overriding yet, only attribute sets
  (see ../attrs/custom.xsl).

  Reserved for a not-yet-implemented fix: a long, space-free <codeph> string
  (an API path, a hash) can still push past the column edge because XSL-FO only
  breaks lines at existing break opportunities. A real fix would override the
  codeph template here to inject zero-width break opportunities into the text
  node (without polluting copy-paste output). Deliberately left out of this
  pass pending a real render to confirm how bad the default overflow actually
  is — see media/pdf-customization/fo/attrs/custom.xsl's `codeph` comment.
-->
<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
    xmlns:fo="http://www.w3.org/1999/XSL/Format"
    version="3.0">

</xsl:stylesheet>
