# DITA @class → baseType extraction diff

Diff recomputed: 2026-08-01T12:01:56.011Z (--diff-only: no DTD rescan)
Candidates from cached extraction: 2026-07-30T02:06:37.921Z (`E:\Software\dita-ot\plugins\org.oasis-open.dita.v1_3\dtd`)

## Topic-side (`STANDARD_TAG_TO_BASETYPE`)

### New entries (in DTD, missing from STANDARD_TAG_TO_BASETYPE) — 0

_None_


### Conflicts (both present, baseType differs) — 57

- `abbreviated-form`: DTD says `topic/term` (technicalContent/dtd/abbreviateDomain.mod:67) vs code `topic/abbreviated-form`  — _needs manual verification_
- `anchorid`: DTD says `topic/keyword` (base/dtd/delayResolutionDomain.mod:95) vs code `topic/anchorid`  — _needs manual verification_
- `anchorkey`: DTD says `topic/keyword` (base/dtd/delayResolutionDomain.mod:96) vs code `topic/anchorkey`  — _needs manual verification_
- `apiname`: DTD says `topic/keyword` (technicalContent/dtd/programmingDomain.mod:670) vs code `topic/apiname`  — _needs manual verification_
- `b`: DTD says `topic/ph` (base/dtd/highlightDomain.mod:191) vs code `topic/b`  — _needs manual verification_
- `cmdname`: DTD says `topic/keyword` (technicalContent/dtd/softwareDomain.mod:195) vs code `topic/cmdname`  — _needs manual verification_
- `codeblock`: DTD says `topic/pre` (technicalContent/dtd/programmingDomain.mod:671) vs code `topic/codeblock`  — _needs manual verification_
- `codeph`: DTD says `topic/ph` (technicalContent/dtd/programmingDomain.mod:672) vs code `topic/codeph`  — _needs manual verification_
- `coderef`: DTD says `topic/xref` (technicalContent/dtd/programmingDomain.mod:673) vs code `topic/coderef`  — _needs manual verification_
- `consequence`: DTD says `topic/li` (base/dtd/hazardstatementDomain.mod:236) vs code `topic/consequence`  — _needs manual verification_
- `delim`: DTD says `topic/ph` (technicalContent/dtd/programmingDomain.mod:674) vs code `topic/delim`  — _needs manual verification_
- `filepath`: DTD says `topic/ph` (technicalContent/dtd/softwareDomain.mod:196) vs code `topic/filepath`  — _needs manual verification_
- `fragment`: DTD says `topic/figgroup` (technicalContent/dtd/programmingDomain.mod:675) vs code `topic/fragment`  — _needs manual verification_
- `fragref`: DTD says `topic/xref` (technicalContent/dtd/programmingDomain.mod:676) vs code `topic/fragref`  — _needs manual verification_
- `glossdef`: DTD says `topic/abstract` (technicalContent/dtd/glossentry.mod:486) vs code `topic/glossdef`  — _needs manual verification_
- `glossentry`: DTD says `topic/topic` (technicalContent/dtd/glossentry.mod:484) vs code `topic/glossentry`  — _needs manual verification_
- `glossgroup`: DTD says `topic/topic` (technicalContent/dtd/glossgroup.mod:78) vs code `topic/glossgroup`  — _needs manual verification_
- `glossterm`: DTD says `topic/title` (technicalContent/dtd/glossentry.mod:485) vs code `topic/glossterm`  — _needs manual verification_
- `hazardstatement`: DTD says `topic/note` (base/dtd/hazardstatementDomain.mod:232) vs code `topic/hazardstatement`  — _needs manual verification_
- `hazardsymbol`: DTD says `topic/image` (base/dtd/hazardstatementDomain.mod:234) vs code `topic/hazardsymbol`  — _needs manual verification_
- `howtoavoid`: DTD says `topic/li` (base/dtd/hazardstatementDomain.mod:237) vs code `topic/howtoavoid`  — _needs manual verification_
- `i`: DTD says `topic/ph` (base/dtd/highlightDomain.mod:192) vs code `topic/i`  — _needs manual verification_
- `index-see`: DTD says `topic/index-base` (base/dtd/indexingDomain.mod:100) vs code `topic/index-see`  — _needs manual verification_
- `index-see-also`: DTD says `topic/index-base` (base/dtd/indexingDomain.mod:101) vs code `topic/index-see-also`  — _needs manual verification_
- `index-sort-as`: DTD says `topic/index-base` (base/dtd/indexingDomain.mod:102) vs code `topic/index-sort-as`  — _needs manual verification_
- `kwd`: DTD says `topic/keyword` (technicalContent/dtd/programmingDomain.mod:680) vs code `topic/kwd`  — _needs manual verification_
- `line-through`: DTD says `topic/ph` (base/dtd/highlightDomain.mod:193) vs code `topic/line-through`  — _needs manual verification_
- `menucascade`: DTD says `topic/ph` (technicalContent/dtd/uiDomain.mod:156) vs code `topic/menucascade`  — _needs manual verification_
- `msgblock`: DTD says `topic/pre` (technicalContent/dtd/softwareDomain.mod:197) vs code `topic/msgblock`  — _needs manual verification_
- `msgnum`: DTD says `topic/keyword` (technicalContent/dtd/softwareDomain.mod:198) vs code `topic/msgnum`  — _needs manual verification_
- `msgph`: DTD says `topic/ph` (technicalContent/dtd/softwareDomain.mod:199) vs code `topic/msgph`  — _needs manual verification_
- `oper`: DTD says `topic/ph` (technicalContent/dtd/programmingDomain.mod:681) vs code `topic/oper`  — _needs manual verification_
- `option`: DTD says `topic/keyword` (technicalContent/dtd/programmingDomain.mod:682) vs code `topic/option`  — _needs manual verification_
- `overline`: DTD says `topic/ph` (base/dtd/highlightDomain.mod:194) vs code `topic/overline`  — _needs manual verification_
- `parml`: DTD says `topic/dl` (technicalContent/dtd/programmingDomain.mod:683) vs code `topic/parml`  — _needs manual verification_
- `parmname`: DTD says `topic/keyword` (technicalContent/dtd/programmingDomain.mod:684) vs code `topic/parmname`  — _needs manual verification_
- `pd`: DTD says `topic/dd` (technicalContent/dtd/programmingDomain.mod:685) vs code `topic/pd`  — _needs manual verification_
- `plentry`: DTD says `topic/dlentry` (technicalContent/dtd/programmingDomain.mod:686) vs code `topic/plentry`  — _needs manual verification_
- `pt`: DTD says `topic/dt` (technicalContent/dtd/programmingDomain.mod:687) vs code `topic/pt`  — _needs manual verification_
- `screen`: DTD says `topic/pre` (technicalContent/dtd/uiDomain.mod:157) vs code `topic/screen`  — _needs manual verification_
- `sep`: DTD says `topic/ph` (technicalContent/dtd/programmingDomain.mod:689) vs code `topic/sep`  — _needs manual verification_
- `sub`: DTD says `topic/ph` (base/dtd/highlightDomain.mod:195) vs code `topic/sub`  — _needs manual verification_
- `sup`: DTD says `topic/ph` (base/dtd/highlightDomain.mod:196) vs code `topic/sup`  — _needs manual verification_
- `synblk`: DTD says `topic/figgroup` (technicalContent/dtd/programmingDomain.mod:690) vs code `topic/synblk`  — _needs manual verification_
- `synnote`: DTD says `topic/fn` (technicalContent/dtd/programmingDomain.mod:691) vs code `topic/synnote`  — _needs manual verification_
- `synnoteref`: DTD says `topic/xref` (technicalContent/dtd/programmingDomain.mod:692) vs code `topic/synnoteref`  — _needs manual verification_
- `synph`: DTD says `topic/ph` (technicalContent/dtd/programmingDomain.mod:693) vs code `topic/synph`  — _needs manual verification_
- `syntaxdiagram`: DTD says `topic/fig` (technicalContent/dtd/programmingDomain.mod:694) vs code `topic/syntaxdiagram`  — _needs manual verification_
- `systemoutput`: DTD says `topic/ph` (technicalContent/dtd/softwareDomain.mod:200) vs code `topic/systemoutput`  — _needs manual verification_
- `tt`: DTD says `topic/ph` (base/dtd/highlightDomain.mod:197) vs code `topic/tt`  — _needs manual verification_
- `typeofhazard`: DTD says `topic/li` (base/dtd/hazardstatementDomain.mod:235) vs code `topic/typeofhazard`  — _needs manual verification_
- `u`: DTD says `topic/ph` (base/dtd/highlightDomain.mod:198) vs code `topic/u`  — _needs manual verification_
- `uicontrol`: DTD says `topic/ph` (technicalContent/dtd/uiDomain.mod:159) vs code `topic/uicontrol`  — _needs manual verification_
- `userinput`: DTD says `topic/ph` (technicalContent/dtd/softwareDomain.mod:201) vs code `topic/userinput`  — _needs manual verification_
- `var`: DTD says `topic/ph` (technicalContent/dtd/programmingDomain.mod:695) vs code `topic/var`  — _needs manual verification_
- `varname`: DTD says `topic/keyword` (technicalContent/dtd/softwareDomain.mod:202) vs code `topic/varname`  — _needs manual verification_
- `wintitle`: DTD says `topic/keyword` (technicalContent/dtd/uiDomain.mod:160) vs code `topic/wintitle`  — _needs manual verification_

### Matched (code agrees with DTD) — 171

_Verified; no change needed._

### Only in code (hand-added, no DTD evidence) — 65

- `topic` → `topic`
- `title` → `title`
- `shortdesc` → `shortdesc`
- `prolog` → `prolog`
- `body` → `body`
- `section` → `section`
- `example` → `example`
- `p` → `p`
- `note` → `note`
- `ul` → `ul`
- `ol` → `ol`
- `li` → `li`
- `sl` → `sl`
- `sli` → `sli`
- `dl` → `dl`
- `dlentry` → `dlentry`
- `dt` → `dt`
- `dd` → `dd`
- `table` → `table`
- `tgroup` → `tgroup`
- `colspec` → `colspec`
- `thead` → `thead`
- `tbody` → `tbody`
- `row` → `row`
- `entry` → `entry`
- `simpletable` → `simpletable`
- `sthead` → `sthead`
- `strow` → `strow`
- `stentry` → `stentry`
- `image` → `image`
- `fig` → `fig`
- `pre` → `pre`
- `xref` → `xref`
- `link` → `link`
- `linktext` → `linktext`
- `related-links` → `related-links`
- `q` → `q`
- `lq` → `lq`
- `keyword` → `keyword`
- `term` → `term`
- `ph` → `ph`
- `draft-comment` → `draft-comment`
- `required-cleanup` → `required-cleanup`
- `data` → `data`
- `data-about` → `data-about`
- `foreign` → `foreign`
- `state` → `state`
- `lines` → `lines`
- `fn` → `fn`
- `cite` → `cite`
- `boolean` → `boolean`
- `tm` → `tm`
- `indexterm` → `indexterm`
- `indextermref` → `indextermref`
- `index-base` → `index-base`
- `div` → `div`
- `sectiondiv` → `sectiondiv`
- `bodydiv` → `bodydiv`
- `desc` → `desc`
- `alt` → `alt`
- `glossref` → `glossref`
- `object` → `object`
- `param` → `param`
- `anchor` → `anchor`
- `anchorref` → `anchorref`

## Map-side (`MAP_STANDARD_TAG_TO_BASETYPE`)

### New entries (in DTD, missing from MAP_STANDARD_TAG_TO_BASETYPE) — 0

_None_


### Conflicts (both present, baseType differs) — 15

- `abbrevlist`: DTD says `map/topicref` (bookmap/dtd/bookmap.mod:1200) vs code `map/bookmap-structural`  — _needs manual verification_
- `backmatter`: DTD says `map/topicref` (bookmap/dtd/bookmap.mod:1205) vs code `map/bookmap-structural`  — _needs manual verification_
- `bibliolist`: DTD says `map/topicref` (bookmap/dtd/bookmap.mod:1206) vs code `map/bookmap-structural`  — _needs manual verification_
- `booklists`: DTD says `map/topicref` (bookmap/dtd/bookmap.mod:1214) vs code `map/bookmap-structural`  — _needs manual verification_
- `figurelist`: DTD says `map/topicref` (bookmap/dtd/bookmap.mod:1233) vs code `map/bookmap-structural`  — _needs manual verification_
- `frontmatter`: DTD says `map/topicref` (bookmap/dtd/bookmap.mod:1234) vs code `map/bookmap-structural`  — _needs manual verification_
- `glossarylist`: DTD says `map/topicref` (bookmap/dtd/bookmap.mod:1235) vs code `map/bookmap-structural`  — _needs manual verification_
- `indexlist`: DTD says `map/topicref` (bookmap/dtd/bookmap.mod:1236) vs code `map/bookmap-structural`  — _needs manual verification_
- `keydef`: DTD says `map/topicref` (base/dtd/mapGroup.mod:539) vs code `map/keydef`  — _needs manual verification_
- `mapref`: DTD says `map/topicref` (base/dtd/mapGroup.mod:540) vs code `map/mapref`  — _needs manual verification_
- `tablelist`: DTD says `map/topicref` (bookmap/dtd/bookmap.mod:1254) vs code `map/bookmap-structural`  — _needs manual verification_
- `toc`: DTD says `map/topicref` (bookmap/dtd/bookmap.mod:1256) vs code `map/bookmap-structural`  — _needs manual verification_
- `topicgroup`: DTD says `map/topicref` (base/dtd/mapGroup.mod:541) vs code `map/topicgroup`  — _needs manual verification_
- `topichead`: DTD says `map/topicref` (base/dtd/mapGroup.mod:542) vs code `map/topichead`  — _needs manual verification_
- `trademarklist`: DTD says `map/topicref` (bookmap/dtd/bookmap.mod:1257) vs code `map/bookmap-structural`  — _needs manual verification_

### Matched (code agrees with DTD) — 20

_Verified; no change needed._

### Only in code (hand-added, no DTD evidence) — 21

- `map` → `map`
- `title` → `title`
- `topicmeta` → `topicmeta`
- `navtitle` → `navtitle`
- `linktext` → `linktext`
- `shortdesc` → `shortdesc`
- `keywords` → `keywords`
- `keyword` → `keyword`
- `booktitle` → `booktitle`
- `mainbooktitle` → `mainbooktitle`
- `booktitlealt` → `booktitlealt`
- `subtitle` → `subtitle`
- `topicref` → `topicref`
- `glossaryref` → `glossaryref`
- `reltable` → `reltable`
- `relheader` → `relheader`
- `relrow` → `relrow`
- `relcell` → `relcell`
- `relcolspec` → `relcolspec`
- `anchor` → `anchor`
- `navref` → `navref`

## New base types lacking a renderer

_None — every newly introduced base type already has a renderer._
