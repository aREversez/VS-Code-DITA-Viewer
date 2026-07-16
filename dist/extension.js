"use strict";var dt=Object.create;var ae=Object.defineProperty;var pt=Object.getOwnPropertyDescriptor;var ut=Object.getOwnPropertyNames;var ft=Object.getPrototypeOf,mt=Object.prototype.hasOwnProperty;var gt=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),ht=(e,t)=>{for(var i in t)ae(e,i,{get:t[i],enumerable:!0})},Oe=(e,t,i,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let a of ut(t))!mt.call(e,a)&&a!==i&&ae(e,a,{get:()=>t[a],enumerable:!(r=pt(t,a))||r.enumerable});return e};var ce=(e,t,i)=>(i=e!=null?dt(ft(e)):{},Oe(t||!e||!e.__esModule?ae(i,"default",{value:e,enumerable:!0}):i,e)),vt=e=>Oe(ae({},"__esModule",{value:!0}),e);var Be=gt(le=>{"use strict";(function(e){e.parser=function(o,n){return new i(o,n)},e.SAXParser=i,e.SAXStream=m,e.createStream=f,e.MAX_BUFFER_LENGTH=64*1024;var t=["comment","sgmlDecl","textNode","tagName","doctype","procInstName","procInstBody","entity","attribName","attribValue","cdata","script"];e.EVENTS=["text","processinginstruction","sgmldeclaration","doctype","comment","opentagstart","attribute","opentag","closetag","opencdata","cdata","closecdata","error","end","ready","script","opennamespace","closenamespace"];function i(o,n){if(!(this instanceof i))return new i(o,n);var l=this;a(l),l.q=l.c="",l.bufferCheckPosition=e.MAX_BUFFER_LENGTH,l.encoding=null,l.opt=n||{},l.opt.lowercase=l.opt.lowercase||l.opt.lowercasetags,l.looseCase=l.opt.lowercase?"toLowerCase":"toUpperCase",l.opt.maxEntityCount=l.opt.maxEntityCount||512,l.opt.maxEntityDepth=l.opt.maxEntityDepth||4,l.entityCount=l.entityDepth=0,l.tags=[],l.closed=l.closedRoot=l.sawRoot=!1,l.tag=l.error=null,l.strict=!!o,l.noscript=!!(o||l.opt.noscript),l.state=c.BEGIN,l.strictEntities=l.opt.strictEntities,l.ENTITIES=l.strictEntities?Object.create(e.XML_ENTITIES):Object.create(e.ENTITIES),l.attribList=[],l.opt.xmlns&&(l.ns=Object.create(_)),l.opt.unquotedAttributeValues===void 0&&(l.opt.unquotedAttributeValues=!o),l.trackPosition=l.opt.position!==!1,l.trackPosition&&(l.position=l.line=l.column=0),z(l,"onready")}Object.create||(Object.create=function(o){function n(){}n.prototype=o;var l=new n;return l}),Object.keys||(Object.keys=function(o){var n=[];for(var l in o)o.hasOwnProperty(l)&&n.push(l);return n});function r(o){for(var n=Math.max(e.MAX_BUFFER_LENGTH,10),l=0,s=0,E=t.length;s<E;s++){var S=o[t[s]].length;if(S>n)switch(t[s]){case"textNode":ne(o);break;case"cdata":$(o,"oncdata",o.cdata),o.cdata="";break;case"script":$(o,"onscript",o.script),o.script="";break;default:X(o,"Max buffer length exceeded: "+t[s])}l=Math.max(l,S)}var k=e.MAX_BUFFER_LENGTH-l;o.bufferCheckPosition=k+o.position}function a(o){for(var n=0,l=t.length;n<l;n++)o[t[n]]=""}function d(o){ne(o),o.cdata!==""&&($(o,"oncdata",o.cdata),o.cdata=""),o.script!==""&&($(o,"onscript",o.script),o.script="")}i.prototype={end:function(){Ie(this)},write:ct,resume:function(){return this.error=null,this},close:function(){return this.write(null)},flush:function(){d(this)}};var p;try{p=require("stream").Stream}catch{p=function(){}}p||(p=function(){});var u=e.EVENTS.filter(function(o){return o!=="error"&&o!=="end"});function f(o,n){return new m(o,n)}function g(o,n){if(o.length>=2){if(o[0]===255&&o[1]===254)return"utf-16le";if(o[0]===254&&o[1]===255)return"utf-16be"}return o.length>=3&&o[0]===239&&o[1]===187&&o[2]===191?"utf8":o.length>=4?o[0]===60&&o[1]===0&&o[2]===63&&o[3]===0?"utf-16le":o[0]===0&&o[1]===60&&o[2]===0&&o[3]===63?"utf-16be":"utf8":n?"utf8":null}function m(o,n){if(!(this instanceof m))return new m(o,n);p.apply(this),this._parser=new i(o,n),this.writable=!0,this.readable=!0;var l=this;this._parser.onend=function(){l.emit("end")},this._parser.onerror=function(s){l.emit("error",s),l._parser.error=null},this._decoder=null,this._decoderBuffer=null,u.forEach(function(s){Object.defineProperty(l,"on"+s,{get:function(){return l._parser["on"+s]},set:function(E){if(!E)return l.removeAllListeners(s),l._parser["on"+s]=E,E;l.on(s,E)},enumerable:!0,configurable:!1})})}m.prototype=Object.create(p.prototype,{constructor:{value:m}}),m.prototype._decodeBuffer=function(o,n){if(this._decoderBuffer&&(o=Buffer.concat([this._decoderBuffer,o]),this._decoderBuffer=null),!this._decoder){var l=g(o,n);if(!l)return this._decoderBuffer=o,"";this._parser.encoding=l,this._decoder=new TextDecoder(l)}return this._decoder.decode(o,{stream:!n})},m.prototype.write=function(o){if(typeof Buffer=="function"&&typeof Buffer.isBuffer=="function"&&Buffer.isBuffer(o))o=this._decodeBuffer(o,!1);else if(this._decoderBuffer){var n=this._decodeBuffer(Buffer.alloc(0),!0);n&&(this._parser.write(n),this.emit("data",n))}return this._parser.write(o.toString()),this.emit("data",o),!0},m.prototype.end=function(o){if(o&&o.length&&this.write(o),this._decoderBuffer){var n=this._decodeBuffer(Buffer.alloc(0),!0);n&&(this._parser.write(n),this.emit("data",n))}else if(this._decoder){var l=this._decoder.decode();l&&(this._parser.write(l),this.emit("data",l))}return this._parser.end(),!0},m.prototype.on=function(o,n){var l=this;return!l._parser["on"+o]&&u.indexOf(o)!==-1&&(l._parser["on"+o]=function(){var s=arguments.length===1?[arguments[0]]:Array.apply(null,arguments);s.splice(0,0,o),l.emit.apply(l,s)}),p.prototype.on.call(l,o,n)};var T="[CDATA[",h="DOCTYPE",v="http://www.w3.org/XML/1998/namespace",b="http://www.w3.org/2000/xmlns/",_={xml:v,xmlns:b},D=/[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,N=/[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/,F=/[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,ee=/[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/;function R(o){return o===" "||o===`
`||o==="\r"||o==="	"}function j(o){return o==='"'||o==="'"}function re(o){return o===">"||R(o)}function V(o,n){return o.test(n)}function Te(o,n){return!V(o,n)}var c=0;e.STATE={BEGIN:c++,BEGIN_WHITESPACE:c++,TEXT:c++,TEXT_ENTITY:c++,OPEN_WAKA:c++,SGML_DECL:c++,SGML_DECL_QUOTED:c++,DOCTYPE:c++,DOCTYPE_QUOTED:c++,DOCTYPE_DTD:c++,DOCTYPE_DTD_QUOTED:c++,COMMENT_STARTING:c++,COMMENT:c++,COMMENT_ENDING:c++,COMMENT_ENDED:c++,CDATA:c++,CDATA_ENDING:c++,CDATA_ENDING_2:c++,PROC_INST:c++,PROC_INST_BODY:c++,PROC_INST_ENDING:c++,OPEN_TAG:c++,OPEN_TAG_SLASH:c++,ATTRIB:c++,ATTRIB_NAME:c++,ATTRIB_NAME_SAW_WHITE:c++,ATTRIB_VALUE:c++,ATTRIB_VALUE_QUOTED:c++,ATTRIB_VALUE_CLOSED:c++,ATTRIB_VALUE_UNQUOTED:c++,ATTRIB_VALUE_ENTITY_Q:c++,ATTRIB_VALUE_ENTITY_U:c++,CLOSE_TAG:c++,CLOSE_TAG_SAW_WHITE:c++,SCRIPT:c++,SCRIPT_ENDING:c++},e.XML_ENTITIES={amp:"&",gt:">",lt:"<",quot:'"',apos:"'"},e.ENTITIES={amp:"&",gt:">",lt:"<",quot:'"',apos:"'",AElig:198,Aacute:193,Acirc:194,Agrave:192,Aring:197,Atilde:195,Auml:196,Ccedil:199,ETH:208,Eacute:201,Ecirc:202,Egrave:200,Euml:203,Iacute:205,Icirc:206,Igrave:204,Iuml:207,Ntilde:209,Oacute:211,Ocirc:212,Ograve:210,Oslash:216,Otilde:213,Ouml:214,THORN:222,Uacute:218,Ucirc:219,Ugrave:217,Uuml:220,Yacute:221,aacute:225,acirc:226,aelig:230,agrave:224,aring:229,atilde:227,auml:228,ccedil:231,eacute:233,ecirc:234,egrave:232,eth:240,euml:235,iacute:237,icirc:238,igrave:236,iuml:239,ntilde:241,oacute:243,ocirc:244,ograve:242,oslash:248,otilde:245,ouml:246,szlig:223,thorn:254,uacute:250,ucirc:251,ugrave:249,uuml:252,yacute:253,yuml:255,copy:169,reg:174,nbsp:160,iexcl:161,cent:162,pound:163,curren:164,yen:165,brvbar:166,sect:167,uml:168,ordf:170,laquo:171,not:172,shy:173,macr:175,deg:176,plusmn:177,sup1:185,sup2:178,sup3:179,acute:180,micro:181,para:182,middot:183,cedil:184,ordm:186,raquo:187,frac14:188,frac12:189,frac34:190,iquest:191,times:215,divide:247,OElig:338,oelig:339,Scaron:352,scaron:353,Yuml:376,fnof:402,circ:710,tilde:732,Alpha:913,Beta:914,Gamma:915,Delta:916,Epsilon:917,Zeta:918,Eta:919,Theta:920,Iota:921,Kappa:922,Lambda:923,Mu:924,Nu:925,Xi:926,Omicron:927,Pi:928,Rho:929,Sigma:931,Tau:932,Upsilon:933,Phi:934,Chi:935,Psi:936,Omega:937,alpha:945,beta:946,gamma:947,delta:948,epsilon:949,zeta:950,eta:951,theta:952,iota:953,kappa:954,lambda:955,mu:956,nu:957,xi:958,omicron:959,pi:960,rho:961,sigmaf:962,sigma:963,tau:964,upsilon:965,phi:966,chi:967,psi:968,omega:969,thetasym:977,upsih:978,piv:982,ensp:8194,emsp:8195,thinsp:8201,zwnj:8204,zwj:8205,lrm:8206,rlm:8207,ndash:8211,mdash:8212,lsquo:8216,rsquo:8217,sbquo:8218,ldquo:8220,rdquo:8221,bdquo:8222,dagger:8224,Dagger:8225,bull:8226,hellip:8230,permil:8240,prime:8242,Prime:8243,lsaquo:8249,rsaquo:8250,oline:8254,frasl:8260,euro:8364,image:8465,weierp:8472,real:8476,trade:8482,alefsym:8501,larr:8592,uarr:8593,rarr:8594,darr:8595,harr:8596,crarr:8629,lArr:8656,uArr:8657,rArr:8658,dArr:8659,hArr:8660,forall:8704,part:8706,exist:8707,empty:8709,nabla:8711,isin:8712,notin:8713,ni:8715,prod:8719,sum:8721,minus:8722,lowast:8727,radic:8730,prop:8733,infin:8734,ang:8736,and:8743,or:8744,cap:8745,cup:8746,int:8747,there4:8756,sim:8764,cong:8773,asymp:8776,ne:8800,equiv:8801,le:8804,ge:8805,sub:8834,sup:8835,nsub:8836,sube:8838,supe:8839,oplus:8853,otimes:8855,perp:8869,sdot:8901,lceil:8968,rceil:8969,lfloor:8970,rfloor:8971,lang:9001,rang:9002,loz:9674,spades:9824,clubs:9827,hearts:9829,diams:9830},Object.keys(e.ENTITIES).forEach(function(o){var n=e.ENTITIES[o],l=typeof n=="number"?String.fromCharCode(n):n;e.ENTITIES[o]=l});for(var se in e.STATE)e.STATE[e.STATE[se]]=se;c=e.STATE;function z(o,n,l){o[n]&&o[n](l)}function G(o){var n=o&&o.match(/(?:^|\s)encoding\s*=\s*(['"])([^'"]+)\1/i);return n?n[2]:null}function te(o){return o?o.toLowerCase().replace(/[^a-z0-9]/g,""):null}function ot(o,n){let l=te(o),s=te(n);return!l||!s?!0:s==="utf16"?l==="utf16le"||l==="utf16be":l===s}function rt(o,n){if(!(!o.strict||!o.encoding||!n||n.name!=="xml")){var l=G(n.body);l&&!ot(o.encoding,l)&&w(o,"XML declaration encoding "+l+" does not match detected stream encoding "+o.encoding.toUpperCase())}}function $(o,n,l){o.textNode&&ne(o),z(o,n,l)}function ne(o){o.textNode=Re(o.opt,o.textNode),o.textNode&&z(o,"ontext",o.textNode),o.textNode=""}function Re(o,n){return o.trim&&(n=n.trim()),o.normalize&&(n=n.replace(/\s+/g," ")),n}function X(o,n){return ne(o),o.trackPosition&&(n+=`
Line: `+o.line+`
Column: `+o.column+`
Char: `+o.c),n=new Error(n),o.error=n,z(o,"onerror",n),o}function Ie(o){return o.sawRoot&&!o.closedRoot&&w(o,"Unclosed root tag"),o.state!==c.BEGIN&&o.state!==c.BEGIN_WHITESPACE&&o.state!==c.TEXT&&X(o,"Unexpected end"),ne(o),o.c="",o.closed=!0,z(o,"onend"),i.call(o,o.strict,o.opt),o}function w(o,n){if(typeof o!="object"||!(o instanceof i))throw new Error("bad call to strictFail");o.strict&&X(o,n)}function st(o){o.strict||(o.tagName=o.tagName[o.looseCase]());var n=o.tags[o.tags.length-1]||o,l=o.tag={name:o.tagName,attributes:{}};o.opt.xmlns&&(l.ns=n.ns),o.attribList.length=0,$(o,"onopentagstart",l)}function Ee(o,n){var l=o.indexOf(":"),s=l<0?["",o]:o.split(":"),E=s[0],S=s[1];return n&&o==="xmlns"&&(E="xmlns",S=""),{prefix:E,local:S}}function we(o){if(o.strict||(o.attribName=o.attribName[o.looseCase]()),o.attribList.indexOf(o.attribName)!==-1||o.tag.attributes.hasOwnProperty(o.attribName)){o.attribName=o.attribValue="";return}if(o.opt.xmlns){var n=Ee(o.attribName,!0),l=n.prefix,s=n.local;if(l==="xmlns")if(s==="xml"&&o.attribValue!==v)w(o,"xml: prefix must be bound to "+v+`
Actual: `+o.attribValue);else if(s==="xmlns"&&o.attribValue!==b)w(o,"xmlns: prefix must be bound to "+b+`
Actual: `+o.attribValue);else{var E=o.tag,S=o.tags[o.tags.length-1]||o;E.ns===S.ns&&(E.ns=Object.create(S.ns)),E.ns[s]=o.attribValue}o.attribList.push([o.attribName,o.attribValue])}else o.tag.attributes[o.attribName]=o.attribValue,$(o,"onattribute",{name:o.attribName,value:o.attribValue});o.attribName=o.attribValue=""}function K(o,n){if(o.opt.xmlns){var l=o.tag,s=Ee(o.tagName);l.prefix=s.prefix,l.local=s.local,l.uri=l.ns[s.prefix]||"",l.prefix&&!l.uri&&(w(o,"Unbound namespace prefix: "+JSON.stringify(o.tagName)),l.uri=s.prefix);var E=o.tags[o.tags.length-1]||o;l.ns&&E.ns!==l.ns&&Object.keys(l.ns).forEach(function(Me){$(o,"onopennamespace",{prefix:Me,uri:l.ns[Me]})});for(var S=0,k=o.attribList.length;S<k;S++){var O=o.attribList[S],B=O[0],q=O[1],L=Ee(B,!0),H=L.prefix,lt=L.local,Fe=H===""?"":l.ns[H]||"",Ne={name:B,value:q,prefix:H,local:lt,uri:Fe};H&&H!=="xmlns"&&!Fe&&(w(o,"Unbound namespace prefix: "+JSON.stringify(H)),Ne.uri=H),o.tag.attributes[B]=Ne,$(o,"onattribute",Ne)}o.attribList.length=0}o.tag.isSelfClosing=!!n,o.sawRoot=!0,o.tags.push(o.tag),$(o,"onopentag",o.tag),n||(!o.noscript&&o.tagName.toLowerCase()==="script"?o.state=c.SCRIPT:o.state=c.TEXT,o.tag=null,o.tagName=""),o.attribName=o.attribValue="",o.attribList.length=0}function xe(o){if(!o.tagName){w(o,"Weird empty close tag."),o.textNode+="</>",o.state=c.TEXT;return}if(o.script){if(o.tagName!=="script"){o.script+="</"+o.tagName+">",o.tagName="",o.state=c.SCRIPT;return}$(o,"onscript",o.script),o.script=""}var n=o.tags.length,l=o.tagName;o.strict||(l=l[o.looseCase]());for(var s=l;n--;){var E=o.tags[n];if(E.name!==s)w(o,"Unexpected close tag");else break}if(n<0){w(o,"Unmatched closing tag: "+o.tagName),o.textNode+="</"+o.tagName+">",o.state=c.TEXT;return}o.tagName=l;for(var S=o.tags.length;S-- >n;){var k=o.tag=o.tags.pop();o.tagName=o.tag.name,$(o,"onclosetag",o.tagName);var O={};for(var B in k.ns)O[B]=k.ns[B];var q=o.tags[o.tags.length-1]||o;o.opt.xmlns&&k.ns!==q.ns&&Object.keys(k.ns).forEach(function(L){var H=k.ns[L];$(o,"onclosenamespace",{prefix:L,uri:H})})}n===0&&(o.closedRoot=!0),o.tagName=o.attribValue=o.attribName="",o.attribList.length=0,o.state=c.TEXT}function at(o){var n=o.entity,l=n.toLowerCase(),s,E="";return o.ENTITIES[n]?o.ENTITIES[n]:o.ENTITIES[l]?o.ENTITIES[l]:(n=l,n.charAt(0)==="#"&&(n.charAt(1)==="x"?(n=n.slice(2),s=parseInt(n,16),E=s.toString(16)):(n=n.slice(1),s=parseInt(n,10),E=s.toString(10))),n=n.replace(/^0+/,""),isNaN(s)||E.toLowerCase()!==n||s<0||s>1114111?(w(o,"Invalid character entity"),"&"+o.entity+";"):String.fromCodePoint(s))}function Le(o,n){n==="<"?(o.state=c.OPEN_WAKA,o.startTagPosition=o.position):R(n)||(w(o,"Non-whitespace before first tag."),o.textNode=n,o.state=c.TEXT)}function De(o,n){var l="";return n<o.length&&(l=o.charAt(n)),l}function ct(o){var n=this;if(this.error)throw this.error;if(n.closed)return X(n,"Cannot write after close. Assign an onready handler.");if(o===null)return Ie(n);typeof o=="object"&&(o=o.toString());for(var l=0,s="";s=De(o,l++),n.c=s,!!s;)switch(n.trackPosition&&(n.position++,s===`
`?(n.line++,n.column=0):n.column++),n.state){case c.BEGIN:if(n.state=c.BEGIN_WHITESPACE,s==="\uFEFF")continue;Le(n,s);continue;case c.BEGIN_WHITESPACE:Le(n,s);continue;case c.TEXT:if(n.sawRoot&&!n.closedRoot){for(var S=l-1;s&&s!=="<"&&s!=="&";)s=De(o,l++),s&&n.trackPosition&&(n.position++,s===`
`?(n.line++,n.column=0):n.column++);n.textNode+=o.substring(S,l-1)}s==="<"&&!(n.sawRoot&&n.closedRoot&&!n.strict)?(n.state=c.OPEN_WAKA,n.startTagPosition=n.position):(!R(s)&&(!n.sawRoot||n.closedRoot)&&w(n,"Text data outside of root node."),s==="&"?n.state=c.TEXT_ENTITY:n.textNode+=s);continue;case c.SCRIPT:s==="<"?n.state=c.SCRIPT_ENDING:n.script+=s;continue;case c.SCRIPT_ENDING:s==="/"?n.state=c.CLOSE_TAG:(n.script+="<"+s,n.state=c.SCRIPT);continue;case c.OPEN_WAKA:if(s==="!")n.state=c.SGML_DECL,n.sgmlDecl="";else if(!R(s))if(V(D,s))n.state=c.OPEN_TAG,n.tagName=s;else if(s==="/")n.state=c.CLOSE_TAG,n.tagName="";else if(s==="?")n.state=c.PROC_INST,n.procInstName=n.procInstBody="";else{if(w(n,"Unencoded <"),n.startTagPosition+1<n.position){var E=n.position-n.startTagPosition;s=new Array(E).join(" ")+s}n.textNode+="<"+s,n.state=c.TEXT}continue;case c.SGML_DECL:if(n.sgmlDecl+s==="--"){n.state=c.COMMENT,n.comment="",n.sgmlDecl="";continue}n.doctype&&n.doctype!==!0&&n.sgmlDecl?(n.state=c.DOCTYPE_DTD,n.doctype+="<!"+n.sgmlDecl+s,n.sgmlDecl=""):(n.sgmlDecl+s).toUpperCase()===T?($(n,"onopencdata"),n.state=c.CDATA,n.sgmlDecl="",n.cdata=""):(n.sgmlDecl+s).toUpperCase()===h?(n.state=c.DOCTYPE,(n.doctype||n.sawRoot)&&w(n,"Inappropriately located doctype declaration"),n.doctype="",n.sgmlDecl=""):s===">"?($(n,"onsgmldeclaration",n.sgmlDecl),n.sgmlDecl="",n.state=c.TEXT):(j(s)&&(n.state=c.SGML_DECL_QUOTED),n.sgmlDecl+=s);continue;case c.SGML_DECL_QUOTED:s===n.q&&(n.state=c.SGML_DECL,n.q=""),n.sgmlDecl+=s;continue;case c.DOCTYPE:s===">"?(n.state=c.TEXT,$(n,"ondoctype",n.doctype),n.doctype=!0):(n.doctype+=s,s==="["?n.state=c.DOCTYPE_DTD:j(s)&&(n.state=c.DOCTYPE_QUOTED,n.q=s));continue;case c.DOCTYPE_QUOTED:n.doctype+=s,s===n.q&&(n.q="",n.state=c.DOCTYPE);continue;case c.DOCTYPE_DTD:s==="]"?(n.doctype+=s,n.state=c.DOCTYPE):s==="<"?(n.state=c.OPEN_WAKA,n.startTagPosition=n.position):j(s)?(n.doctype+=s,n.state=c.DOCTYPE_DTD_QUOTED,n.q=s):n.doctype+=s;continue;case c.DOCTYPE_DTD_QUOTED:n.doctype+=s,s===n.q&&(n.state=c.DOCTYPE_DTD,n.q="");continue;case c.COMMENT:s==="-"?n.state=c.COMMENT_ENDING:n.comment+=s;continue;case c.COMMENT_ENDING:s==="-"?(n.state=c.COMMENT_ENDED,n.comment=Re(n.opt,n.comment),n.comment&&$(n,"oncomment",n.comment),n.comment=""):(n.comment+="-"+s,n.state=c.COMMENT);continue;case c.COMMENT_ENDED:s!==">"?(w(n,"Malformed comment"),n.comment+="--"+s,n.state=c.COMMENT):n.doctype&&n.doctype!==!0?n.state=c.DOCTYPE_DTD:n.state=c.TEXT;continue;case c.CDATA:for(var S=l-1;s&&s!=="]";)s=De(o,l++),s&&n.trackPosition&&(n.position++,s===`
`?(n.line++,n.column=0):n.column++);n.cdata+=o.substring(S,l-1),s==="]"&&(n.state=c.CDATA_ENDING);continue;case c.CDATA_ENDING:s==="]"?n.state=c.CDATA_ENDING_2:(n.cdata+="]"+s,n.state=c.CDATA);continue;case c.CDATA_ENDING_2:s===">"?(n.cdata&&$(n,"oncdata",n.cdata),$(n,"onclosecdata"),n.cdata="",n.state=c.TEXT):s==="]"?n.cdata+="]":(n.cdata+="]]"+s,n.state=c.CDATA);continue;case c.PROC_INST:s==="?"?n.state=c.PROC_INST_ENDING:R(s)?n.state=c.PROC_INST_BODY:n.procInstName+=s;continue;case c.PROC_INST_BODY:if(!n.procInstBody&&R(s))continue;s==="?"?n.state=c.PROC_INST_ENDING:n.procInstBody+=s;continue;case c.PROC_INST_ENDING:if(s===">"){let q={name:n.procInstName,body:n.procInstBody};rt(n,q),$(n,"onprocessinginstruction",q),n.procInstName=n.procInstBody="",n.state=c.TEXT}else n.procInstBody+="?"+s,n.state=c.PROC_INST_BODY;continue;case c.OPEN_TAG:V(N,s)?n.tagName+=s:(st(n),s===">"?K(n):s==="/"?n.state=c.OPEN_TAG_SLASH:(R(s)||w(n,"Invalid character in tag name"),n.state=c.ATTRIB));continue;case c.OPEN_TAG_SLASH:s===">"?(K(n,!0),xe(n)):(w(n,"Forward-slash in opening tag not followed by >"),n.state=c.ATTRIB);continue;case c.ATTRIB:if(R(s))continue;s===">"?K(n):s==="/"?n.state=c.OPEN_TAG_SLASH:V(D,s)?(n.attribName=s,n.attribValue="",n.state=c.ATTRIB_NAME):w(n,"Invalid attribute name");continue;case c.ATTRIB_NAME:s==="="?n.state=c.ATTRIB_VALUE:s===">"?(w(n,"Attribute without value"),n.attribValue=n.attribName,we(n),K(n)):R(s)?n.state=c.ATTRIB_NAME_SAW_WHITE:V(N,s)?n.attribName+=s:w(n,"Invalid attribute name");continue;case c.ATTRIB_NAME_SAW_WHITE:if(s==="=")n.state=c.ATTRIB_VALUE;else{if(R(s))continue;w(n,"Attribute without value"),n.tag.attributes[n.attribName]="",n.attribValue="",$(n,"onattribute",{name:n.attribName,value:""}),n.attribName="",s===">"?K(n):V(D,s)?(n.attribName=s,n.state=c.ATTRIB_NAME):(w(n,"Invalid attribute name"),n.state=c.ATTRIB)}continue;case c.ATTRIB_VALUE:if(R(s))continue;j(s)?(n.q=s,n.state=c.ATTRIB_VALUE_QUOTED):(n.opt.unquotedAttributeValues||X(n,"Unquoted attribute value"),n.state=c.ATTRIB_VALUE_UNQUOTED,n.attribValue=s);continue;case c.ATTRIB_VALUE_QUOTED:if(s!==n.q){s==="&"?n.state=c.ATTRIB_VALUE_ENTITY_Q:n.attribValue+=s;continue}we(n),n.q="",n.state=c.ATTRIB_VALUE_CLOSED;continue;case c.ATTRIB_VALUE_CLOSED:R(s)?n.state=c.ATTRIB:s===">"?K(n):s==="/"?n.state=c.OPEN_TAG_SLASH:V(D,s)?(w(n,"No whitespace between attributes"),n.attribName=s,n.attribValue="",n.state=c.ATTRIB_NAME):w(n,"Invalid attribute name");continue;case c.ATTRIB_VALUE_UNQUOTED:if(!re(s)){s==="&"?n.state=c.ATTRIB_VALUE_ENTITY_U:n.attribValue+=s;continue}we(n),s===">"?K(n):n.state=c.ATTRIB;continue;case c.CLOSE_TAG:if(n.tagName)s===">"?xe(n):V(N,s)?n.tagName+=s:n.script?(n.script+="</"+n.tagName+s,n.tagName="",n.state=c.SCRIPT):(R(s)||w(n,"Invalid tagname in closing tag"),n.state=c.CLOSE_TAG_SAW_WHITE);else{if(R(s))continue;Te(D,s)?n.script?(n.script+="</"+s,n.state=c.SCRIPT):w(n,"Invalid tagname in closing tag."):n.tagName=s}continue;case c.CLOSE_TAG_SAW_WHITE:if(R(s))continue;s===">"?xe(n):w(n,"Invalid characters in closing tag");continue;case c.TEXT_ENTITY:case c.ATTRIB_VALUE_ENTITY_Q:case c.ATTRIB_VALUE_ENTITY_U:var k,O;switch(n.state){case c.TEXT_ENTITY:k=c.TEXT,O="textNode";break;case c.ATTRIB_VALUE_ENTITY_Q:k=c.ATTRIB_VALUE_QUOTED,O="attribValue";break;case c.ATTRIB_VALUE_ENTITY_U:k=c.ATTRIB_VALUE_UNQUOTED,O="attribValue";break}if(s===";"){var B=at(n);n.opt.unparsedEntities&&!Object.values(e.XML_ENTITIES).includes(B)?((n.entityCount+=1)>n.opt.maxEntityCount&&X(n,"Parsed entity count exceeds max entity count"),(n.entityDepth+=1)>n.opt.maxEntityDepth&&X(n,"Parsed entity depth exceeds max entity depth"),n.entity="",n.state=k,n.write(B),n.entityDepth-=1):(n[O]+=B,n.entity="",n.state=k)}else V(n.entity.length?ee:F,s)?n.entity+=s:(w(n,"Invalid character in entity name"),n[O]+="&"+n.entity+s,n.entity="",n.state=k);continue;default:throw new Error(n,"Unknown state: "+n.state)}return n.position>=n.bufferCheckPosition&&r(n),n}String.fromCodePoint||function(){var o=String.fromCharCode,n=Math.floor,l=function(){var s=16384,E=[],S,k,O=-1,B=arguments.length;if(!B)return"";for(var q="";++O<B;){var L=Number(arguments[O]);if(!isFinite(L)||L<0||L>1114111||n(L)!==L)throw RangeError("Invalid code point: "+L);L<=65535?E.push(L):(L-=65536,S=(L>>10)+55296,k=L%1024+56320,E.push(S,k)),(O+1===B||E.length>s)&&(q+=o.apply(null,E),E.length=0)}return q};Object.defineProperty?Object.defineProperty(String,"fromCodePoint",{value:l,configurable:!0,writable:!0}):String.fromCodePoint=l}()})(typeof le>"u"?le.sax={}:le)});var Yt={};ht(Yt,{activate:()=>Ht});module.exports=vt(Yt);var P=ce(require("vscode"));var y=ce(require("vscode"));var Ve=ce(Be());var Pe={topic:"topic/topic",title:"topic/title",shortdesc:"topic/shortdesc",body:"topic/body",section:"topic/section",example:"topic/example",p:"topic/p",note:"topic/note",ul:"topic/ul",ol:"topic/ol",li:"topic/li",sl:"topic/sl",sli:"topic/sli",dl:"topic/dl",dlentry:"topic/dlentry",dt:"topic/dt",dd:"topic/dd",table:"topic/table",tgroup:"topic/tgroup",colspec:"topic/colspec",thead:"topic/thead",tbody:"topic/tbody",row:"topic/row",entry:"topic/entry",simpletable:"topic/simpletable",sthead:"topic/sthead",strow:"topic/strow",stentry:"topic/stentry",image:"topic/image",fig:"topic/fig",codeblock:"topic/codeblock",pre:"topic/pre",xref:"topic/xref",link:"topic/link",linktext:"topic/linktext",relatedLinks:"topic/related-links",b:"topic/b",i:"topic/i",u:"topic/u",tt:"topic/tt",sup:"topic/sup",sub:"topic/sub",q:"topic/q",lq:"topic/lq",keyword:"topic/keyword",term:"topic/term",uicontrol:"topic/uicontrol",wintitle:"topic/wintitle",menucascade:"topic/menucascade",filepath:"topic/filepath",userinput:"topic/userinput",systemoutput:"topic/systemoutput",apiname:"topic/apiname",option:"topic/option",parmname:"topic/parmname",cmdname:"topic/cmdname",varname:"topic/varname",msgnum:"topic/msgnum",ph:"topic/ph",draftComment:"topic/draft-comment",requiredCleanup:"topic/required-cleanup",data:"topic/data",dataAbout:"topic/data-about",foreign:"topic/foreign",state:"topic/state",codeph:"topic/codeph",coderef:"topic/coderef",synph:"topic/synph",kwd:"topic/kwd",var:"topic/var",oper:"topic/oper",sep:"topic/sep",delim:"topic/delim",fragment:"topic/fragment",fragref:"topic/fragref",synblk:"topic/synblk",synnote:"topic/synnote",synnoteref:"topic/synnoteref",syntaxdiagram:"topic/syntaxdiagram",screen:"topic/screen",msgph:"topic/msgph",msgblock:"topic/msgblock",lines:"topic/lines",fn:"topic/fn",cite:"topic/cite",boolean:"topic/boolean",tm:"topic/tm",indexterm:"topic/indexterm",indextermref:"topic/indextermref","index-see":"topic/index-see","index-see-also":"topic/index-see-also","index-sort-as":"topic/index-sort-as","index-base":"topic/index-base",div:"topic/div",sectiondiv:"topic/sectiondiv",bodydiv:"topic/bodydiv",desc:"topic/desc",alt:"topic/alt",parml:"topic/parml",plentry:"topic/plentry",pt:"topic/pt",pd:"topic/pd","abbreviated-form":"topic/abbreviated-form",glossterm:"topic/glossterm",glossdef:"topic/glossdef",glossentry:"topic/glossentry",glossref:"topic/glossref",glossgroup:"topic/glossgroup",hazardstatement:"topic/hazardstatement",typeofhazard:"topic/typeofhazard",hazardsymbol:"topic/hazardsymbol",howtoavoid:"topic/howtoavoid",consequence:"topic/consequence",object:"topic/object",param:"topic/param",anchor:"topic/anchor",anchorid:"topic/anchorid",anchorkey:"topic/anchorkey",anchorref:"topic/anchorref"};var Ue={map:"map/map",title:"map/map-title",topicmeta:"map/topicmeta",navtitle:"map/navtitle",linktext:"map/linktext",shortdesc:"map/shortdesc",keywords:"map/keywords",keyword:"map/keyword",topicref:"map/topicref",topichead:"map/topichead",topicgroup:"map/topicgroup",keydef:"map/keydef",reltable:"map/reltable",relheader:"map/relheader",relrow:"map/relrow",relcell:"map/relcell",relcolspec:"map/relcolspec",anchor:"map/anchor",navref:"map/navref",mapref:"map/mapref"};var bt=/^(topic|map)\//;function yt(e){return function(i,r){let a=e[i];if(a)return a;if(r){let d=r.trim().split(/\s+/);for(let p of d)if(bt.test(p))return p}}}function Tt(){return{startLine:0,startCol:0,endLine:0,endCol:0}}function We(e){let t=yt(e);return function(r){let a=Ve.default.parser(!0,{trim:!1,normalize:!1}),d={type:"element",children:[],sourceRange:Tt()},p=[d],u="",f=0,g=0;function m(){if(u.length>0){let h=p[p.length-1];h&&h.children.push({type:"text",text:u,children:[],sourceRange:{startLine:f,startCol:g,endLine:a.line,endCol:a.column}}),u=""}}a.onopentag=h=>{m();let v=h.name,b=h.attributes.class,_=t(v,b),D=b?b.trim().split(/\s+/).filter(Boolean):void 0,N={type:"element",tagName:v,classTokens:D,baseType:_,attributes:h.attributes,children:[],sourceRange:{startLine:a.line,startCol:a.column,endLine:0,endCol:0}},F=p[p.length-1];F&&F.children.push(N),p.push(N)},a.onclosetag=()=>{m();let h=p.pop();h&&(h.sourceRange.endLine=a.line,h.sourceRange.endCol=a.column)},a.ontext=h=>{u.length===0&&(f=a.line,g=a.column),u+=h},a.onerror=h=>{throw new Error(`SAX parse error at line ${a.line}:${a.column}: ${h.message}`)},a.write(r).close();let T=d.children.find(h=>h.type==="element");if(!T)throw new Error("No root element found in DITA document");return{root:T,sourceRange:T.sourceRange}}}function Y(e){let t=/<!ENTITY\s+(\S+)\s+"((?:[^"\\]|\\.)*)">/g,i,r=[];for(;(i=t.exec(e))!==null;)r.push([i[1],i[2]]);if(r.length===0)return e;let a=e.replace(t,"");for(let[d,p]of r)a=a.replace(new RegExp(`&${d};`,"g"),p);return a}var Et=We(Pe),wt=We(Ue);function ie(e){return Et(e)}function de(e){return wt(e)}function ze(e){return e.parentBaseType==="topic/thead"}function C(e,t){return e.attributes?.[t]}function A(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function W(e,t){return t==null?"":` ${e}="${A(t)}"`}var Ge={"topic/topic":(e,t,i)=>{let r=C(e,"id");return`<article${W("id",r)} class="topic">${i(e,t)}</article>`},"topic/title":(e,t,i)=>{let r=Math.min(t.headingLevel,6);return`<h${r}>${i(e,t)}</h${r}>`},"topic/shortdesc":(e,t,i)=>`<p class="shortdesc">${i(e,t)}</p>`,"topic/body":(e,t,i)=>`<main class="body">${i(e,t)}</main>`,"topic/section":(e,t,i)=>{let r=C(e,"id");return`<section${W("id",r)}>${i(e,t)}</section>`},"topic/example":(e,t,i)=>{let r=C(e,"id");return`<section${W("id",r)} class="example">${i(e,t)}</section>`},"topic/p":(e,t,i)=>`<p>${i(e,t)}</p>`,"topic/note":(e,t,i)=>{let r=C(e,"type")||"note",d=(t.noteLabels||{note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"})[r]||r;return`<div class="note note--${A(r)}"><span class="note__label">${A(d)}:</span> ${i(e,t)}</div>`},"topic/ul":(e,t,i)=>`<ul>${i(e,t)}</ul>`,"topic/ol":(e,t,i)=>`<ol>${i(e,t)}</ol>`,"topic/li":(e,t,i)=>`<li>${i(e,t)}</li>`,"topic/sl":(e,t,i)=>`<ul class="simple-list">${i(e,t)}</ul>`,"topic/sli":(e,t,i)=>`<li>${i(e,t)}</li>`,"topic/dl":(e,t,i)=>`<dl>${i(e,t)}</dl>`,"topic/dlentry":(e,t,i)=>`<div class="dlentry">${i(e,t)}</div>`,"topic/dt":(e,t,i)=>`<dt>${i(e,t)}</dt>`,"topic/dd":(e,t,i)=>`<dd>${i(e,t)}</dd>`,"topic/table":(e,t,i)=>{let r=C(e,"id");return`<table${W("id",r)} class="cals-table">${i(e,t)}</table>`},"topic/tgroup":(e,t,i)=>i(e,t),"topic/colspec":()=>"","topic/thead":(e,t,i)=>`<thead>${i(e,t)}</thead>`,"topic/tbody":(e,t,i)=>`<tbody>${i(e,t)}</tbody>`,"topic/row":(e,t,i)=>`<tr>${i(e,t)}</tr>`,"topic/entry":(e,t,i)=>{let r=ze(t)?"th":"td";return`<${r}>${i(e,t)}</${r}>`},"topic/simpletable":(e,t,i)=>{let r=C(e,"id");return`<table${W("id",r)} class="simple-table">${i(e,t)}</table>`},"topic/sthead":(e,t,i)=>`<thead>${i(e,t)}</thead>`,"topic/strow":(e,t,i)=>`<tr>${i(e,t)}</tr>`,"topic/stentry":(e,t,i)=>{let r=ze(t)?"th":"td";return`<${r}>${i(e,t)}</${r}>`},"topic/image":(e,t)=>{let i=C(e,"href")||"",r=C(e,"alt")||"",a=C(e,"placement")||"inline",d=C(e,"width"),p=C(e,"height"),u=`${W("width",d)}${W("height",p)}`,f=i?t.asWebviewUri(i):"",g=a==="break"?' class="image-break"':"";return`<img src="${f||""}"${W("alt",r)}${u}${g} loading="lazy" data-dita-src="${A(i)}">`},"topic/fig":(e,t,i)=>{let r=C(e,"id"),a=(e.children||[]).find(f=>f.type==="element"&&f.baseType==="topic/title"),d=(e.children||[]).filter(f=>!(f.type==="element"&&f.baseType==="topic/title")),p=i({...e,children:d},t),u=a?`<figcaption>${i(a,{...t,headingLevel:t.headingLevel+1})}</figcaption>`:"";return`<figure${W("id",r)}>${p}${u}</figure>`},"topic/codeblock":(e,t,i)=>{let r=C(e,"outputclass")||"",a=r.replace(/^language-/,""),d=a?`<div class="codeblock-lang">${A(a)}</div>`:"";return`<pre class="codeblock ${A(r)}"><code>${i(e,t)}</code>${d}</pre>`},"topic/pre":(e,t,i)=>`<pre class="preformatted">${i(e,t)}</pre>`,"topic/xref":(e,t,i)=>{let r=C(e,"href")||"";if(!r)return"";let a;if(e.children.length>0)a=i(e,t);else if(r.startsWith("#")){let d=r.includes("/")?r.split("/").pop():r.slice(1);a=A(t.resolveTitle?.(d)??"")||A(r)}else r.includes("#")?a=A(t.resolveTitle?.(r)??"")||A(r):a=A(r);if(r.startsWith("#")){let d=r.includes("/")?"#"+r.split("/").pop():r;return`<a href="${A(d)}" class="xref">${a}</a>`}return`<span class="xref-external">\u2192 ${a}</span>`},"topic/link":(e,t,i)=>{let r=C(e,"href"),a=C(e,"keyref"),d=r||a||"";return d?`<a href="${A(d)}" class="link">${i(e,t)}</a>`:i(e,t)},"topic/linktext":(e,t,i)=>i(e,t),"topic/related-links":(e,t,i)=>`<aside class="related-links"><h2>Related links</h2>${i(e,t)}</aside>`,"topic/b":(e,t,i)=>`<strong>${i(e,t)}</strong>`,"topic/i":(e,t,i)=>`<em>${i(e,t)}</em>`,"topic/u":(e,t,i)=>`<u>${i(e,t)}</u>`,"topic/tt":(e,t,i)=>`<code>${i(e,t)}</code>`,"topic/sup":(e,t,i)=>`<sup>${i(e,t)}</sup>`,"topic/sub":(e,t,i)=>`<sub>${i(e,t)}</sub>`,"topic/q":(e,t,i)=>`<q>${i(e,t)}</q>`,"topic/lq":(e,t,i)=>`<blockquote>${i(e,t)}</blockquote>`,"topic/keyword":(e,t,i)=>`<span class="keyword">${i(e,t)}</span>`,"topic/term":(e,t,i)=>`<span class="term">${i(e,t)}</span>`,"topic/ph":(e,t,i)=>{let r=C(e,"keyref");if(r&&t.resolveKey){let a=t.resolveKey(r);return a?`<span class="ph">${A(a)}</span>`:`<span class="ph unresolved-keyref" title="Unresolved key: ${A(r)}">[${A(r)}]</span>`}return`<span class="ph">${i(e,t)}</span>`},"topic/uicontrol":(e,t,i)=>`<span class="uicontrol">${i(e,t)}</span>`,"topic/wintitle":(e,t,i)=>`<span class="wintitle">${i(e,t)}</span>`,"topic/menucascade":(e,t,i)=>`<span class="menucascade">${i(e,t)}</span>`,"topic/filepath":(e,t,i)=>`<span class="filepath">${i(e,t)}</span>`,"topic/userinput":(e,t,i)=>`<span class="userinput">${i(e,t)}</span>`,"topic/systemoutput":(e,t,i)=>`<span class="systemoutput">${i(e,t)}</span>`,"topic/apiname":(e,t,i)=>`<span class="apiname">${i(e,t)}</span>`,"topic/option":(e,t,i)=>`<span class="option">${i(e,t)}</span>`,"topic/parmname":(e,t,i)=>`<span class="parmname">${i(e,t)}</span>`,"topic/cmdname":(e,t,i)=>`<span class="cmdname">${i(e,t)}</span>`,"topic/varname":(e,t,i)=>`<span class="varname">${i(e,t)}</span>`,"topic/msgnum":(e,t,i)=>`<span class="msgnum">${i(e,t)}</span>`,"topic/codeph":(e,t,i)=>`<code class="codeph">${i(e,t)}</code>`,"topic/coderef":(e,t,i)=>`<span class="coderef">${i(e,t)}</span>`,"topic/synph":(e,t,i)=>`<span class="synph">${i(e,t)}</span>`,"topic/kwd":(e,t,i)=>`<span class="kwd">${i(e,t)}</span>`,"topic/var":(e,t,i)=>`<span class="var">${i(e,t)}</span>`,"topic/oper":(e,t,i)=>`<span class="oper">${i(e,t)}</span>`,"topic/sep":(e,t,i)=>`<span class="sep">${i(e,t)}</span>`,"topic/delim":(e,t,i)=>`<span class="delim">${i(e,t)}</span>`,"topic/fragment":(e,t,i)=>`<span class="fragment">${i(e,t)}</span>`,"topic/fragref":(e,t,i)=>`<span class="fragref">${i(e,t)}</span>`,"topic/synblk":(e,t,i)=>`<pre class="synblk">${i(e,t)}</pre>`,"topic/synnote":(e,t,i)=>`<div class="synnote">${i(e,t)}</div>`,"topic/synnoteref":(e,t,i)=>`<span class="synnoteref">${i(e,t)}</span>`,"topic/syntaxdiagram":(e,t,i)=>`<div class="syntaxdiagram">${i(e,t)}</div>`,"topic/screen":(e,t,i)=>`<pre class="screen">${i(e,t)}</pre>`,"topic/msgph":(e,t,i)=>`<span class="msgph">${i(e,t)}</span>`,"topic/msgblock":(e,t,i)=>`<pre class="msgblock">${i(e,t)}</pre>`,"topic/lines":(e,t,i)=>`<pre class="lines">${i(e,t)}</pre>`,"topic/fn":(e,t,i)=>{let r=C(e,"id");return`<sup class="fn${r?` fn-call-${A(r)}`:""}">${i(e,t)}</sup>`},"topic/cite":(e,t,i)=>`<cite>${i(e,t)}</cite>`,"topic/boolean":(e,t,i)=>{let r=C(e,"value")||"";return`<span class="boolean" data-value="${A(r)}">${A(r)||i(e,t)}</span>`},"topic/tm":(e,t,i)=>`<span class="tm">${i(e,t)}</span>`,"topic/indexterm":()=>"","topic/indextermref":()=>"","topic/index-see":()=>"","topic/index-see-also":()=>"","topic/index-sort-as":()=>"","topic/index-base":()=>"","topic/div":(e,t,i)=>`<div class="body-div">${i(e,t)}</div>`,"topic/sectiondiv":(e,t,i)=>`<div class="section-div">${i(e,t)}</div>`,"topic/bodydiv":(e,t,i)=>`<div class="body-div">${i(e,t)}</div>`,"topic/desc":(e,t,i)=>`<span class="desc">${i(e,t)}</span>`,"topic/alt":(e,t,i)=>`<span class="alt">${i(e,t)}</span>`,"topic/parml":(e,t,i)=>`<dl class="parml">${i(e,t)}</dl>`,"topic/plentry":(e,t,i)=>`<div class="plentry">${i(e,t)}</div>`,"topic/pt":(e,t,i)=>`<dt class="pt">${i(e,t)}</dt>`,"topic/pd":(e,t,i)=>`<dd class="pd">${i(e,t)}</dd>`,"topic/abbreviated-form":(e,t,i)=>{let r=C(e,"keyref");return r&&t.resolveKey?`<abbr class="abbreviated-form" title="${A(r)}">${A(t.resolveKey(r)||r)}</abbr>`:`<abbr class="abbreviated-form">${i(e,t)}</abbr>`},"topic/glossterm":(e,t,i)=>`<dfn class="glossterm">${i(e,t)}</dfn>`,"topic/glossdef":(e,t,i)=>`<dd class="glossdef">${i(e,t)}</dd>`,"topic/glossentry":(e,t,i)=>`<dl class="glossentry">${i(e,t)}</dl>`,"topic/glossref":(e,t,i)=>`<span class="glossref">${i(e,t)}</span>`,"topic/glossgroup":(e,t,i)=>`<div class="glossgroup">${i(e,t)}</div>`,"topic/hazardstatement":(e,t,i)=>`<div class="hazardstatement">${i(e,t)}</div>`,"topic/typeofhazard":(e,t,i)=>`<span class="typeofhazard">${i(e,t)}</span>`,"topic/hazardsymbol":()=>"","topic/howtoavoid":(e,t,i)=>`<p class="howtoavoid">${i(e,t)}</p>`,"topic/consequence":(e,t,i)=>`<p class="consequence">${i(e,t)}</p>`,"topic/object":(e,t,i)=>`<object class="dita-object">${i(e,t)}</object>`,"topic/param":()=>"","topic/anchor":e=>{let t=C(e,"id");return t?`<a${W("id",t)}></a>`:""},"topic/anchorid":e=>{let t=C(e,"id");return t?`<span${W("id",t)}></span>`:""},"topic/anchorkey":()=>"","topic/anchorref":()=>""};var xt=new Set(["topic/section","topic/example","topic/fig","topic/related-links"]),Dt=new Set(["topic/tgroup","topic/link","topic/linktext"]);function Nt(e){return xt.has(e)}function Ct(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function _t(e,t,i){return e.replace(/^<([a-zA-Z][a-zA-Z0-9]*)/,`<$1 title="${t}" data-line="${i}"`)}function St(e,t){return{type:"text",text:e,children:[],sourceRange:t}}function At(e,t){let i=e.attributes?.conref;if(!i||!t.resolveConref)return e;let r=t.resolveConref(i);if(!r)return e;let{conref:a,...d}=e.attributes||{};return{...e,children:[St(r,e.sourceRange)],attributes:d}}function He(e,t){if(e.type==="text")return Ct(e.text||"");let i=At(e,t),r=i.baseType,a=r?Ge[r]:void 0,p=(r?Nt(r):!1)?t.headingLevel+1:t.headingLevel,u={...t,headingLevel:p,parentBaseType:r};if(a){let f=a(i,u,qe);if(r&&!Dt.has(r)){let g=i.tagName||r.split("/").pop()||r;f=_t(f,g,i.sourceRange.startLine)}return f}return qe(i,u)}function qe(e,t){return(e.children||[]).map(i=>He(i,t)).join("")}function pe(e,t){return He(e,t)}var I=require("fs"),x=require("path"),Ke=require("crypto");var Z=require("fs"),ue=require("path");function fe(e){return e.type==="text"?e.text||"":(e.children||[]).map(fe).join("")}function Ce(e){let t=new Map;function i(r){if(r.type==="element"){let a=r.attributes?.id;if(a){let d=(r.children||[]).find(p=>p.type==="element"&&p.baseType==="topic/title");d&&t.set(a,fe(d))}for(let d of r.children||[])i(d)}}return i(e),t}function Ye(e){let t=new Map;function i(d){let p=(0,ue.resolve)(e,d);if(t.has(p))return t.get(p);if(!(0,Z.existsSync)(p)){t.set(p,void 0);return}try{let u=(0,Z.readFileSync)(p,"utf-8"),f=ie(Y(u));return t.set(p,f.root),f.root}catch{t.set(p,void 0);return}}function r(d,p){if(d.attributes?.id===p)return d;for(let u of d.children||[]){let f=r(u,p);if(f)return f}}function a(d,p){let u=r(d,p);if(!u)return;let f=(u.children||[]).find(g=>g.type==="element"&&g.baseType==="topic/title");if(f)return fe(f)}return{loadFile:i,findElementById:r,findTitleOfElement:a}}function _e(e){let t=Ye(e);function i(r){let a="";for(let d of r.children||[])d.type==="text"?a+=d.text||"":a+=i(d);return a}return r=>{let a=r.indexOf("#");if(a<0)return;let d=r.substring(0,a),u=r.substring(a+1).split("/"),f=u.length>1?u[1]:u[0],g=t.loadFile(d);if(!g)return;let m=t.findElementById(g,f);if(m)return i(m)}}function Se(e){let t=Ye(e);return i=>{let r=i.indexOf("#");if(r<0)return;let a=i.substring(0,r),p=i.substring(r+1).split("/")[0],u=t.loadFile(a);if(u)return t.findTitleOfElement(u,p)}}var $t={note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"},kt={note:"\u6CE8",notice:"\u6CE8\u610F",warning:"\u8B66\u544A",danger:"\u5371\u9669",important:"\u91CD\u8981",tip:"\u63D0\u793A",restriction:"\u9650\u5236"};function Rt(e){return(e.attributes?.["xml:lang"]||"").startsWith("zh")?kt:$t}function je(e){let{filePath:t,keyMap:i,asWebviewUri:r,headingLevel:a}=e;try{if(!(0,Z.existsSync)(t))return{html:"",error:`File not found: ${t}`};let d=(0,Z.readFileSync)(t,"utf-8"),p=Y(d),u=ie(p),f=Ce(u.root),g=Rt(u.root),m=(0,ue.dirname)(t),T=_e(m),h=Se(m),v=D=>{let N=f.get(D);if(N)return N;if(D.includes("#"))return h(D)},b=pe(u.root,{headingLevel:a,asWebviewUri:r,documentDir:m,resolveTitle:v,resolveKey:D=>i.get(D),resolveConref:D=>T(D),noteLabels:g}),_=fe(u.root);return{html:b,title:_}}catch(d){let p=d instanceof Error?d.message:String(d);return{html:"",error:`Error rendering ${t}: ${p}`}}}function It(){return`
(function() {
  var vscode = acquireVsCodeApi();
  var scrollTimer = null;

  function findClosest(line) {
    var els = document.querySelectorAll('[data-line]');
    var best = null;
    var bestDiff = Infinity;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var l = parseInt(el.getAttribute('data-line'), 10);
      var d = Math.abs(l - line);
      if (d < bestDiff) { bestDiff = d; best = el; }
    }
    return best;
  }

  function onScrollEnd() {
    try {
      var els = document.querySelectorAll('[data-line]');
      if (!els.length) return;
      var best = els[0], bestDist = Math.abs(els[0].getBoundingClientRect().top);
      for (var i = 1; i < els.length; i++) {
        var dist = Math.abs(els[i].getBoundingClientRect().top);
        if (dist < bestDist) { bestDist = dist; best = els[i]; }
      }
      var line = best.getAttribute('data-line');
      if (line !== null) vscode.postMessage({ type: 'scrollSync', line: parseInt(line, 10) });
    } catch(e) {}
  }

  function scrollToLine(targetLine) {
    if (targetLine <= 0) { window.scrollTo(0, 0); return; }
    var best = findClosest(targetLine);
    if (!best) return;
    var elLine = parseInt(best.getAttribute('data-line'), 10);
    if (targetLine > elLine + 2) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      return;
    }
    var rect = best.getBoundingClientRect();
    if (rect.top < -5 || rect.top > 5) {
      best.scrollIntoView({ block: 'start' });
    }
  }

  var fontSize = 100;

  // Static highlight (no animation)
  var hlStyle = document.createElement('style');
  hlStyle.textContent = '.__hl{outline:2px solid var(--vscode-textLink-foreground,#4a90d9);outline-offset:2px;border-radius:3px;background:color-mix(in srgb,var(--vscode-textLink-foreground,#4a90d9) 12%,transparent);}';
  document.head.appendChild(hlStyle);

  // Image error handling (event delegation, nonce-safe)
  document.addEventListener('error', function(e) {
    var img = e.target;
    if (img.tagName !== 'IMG' || !img.hasAttribute('data-dita-src')) return;
    var src = img.getAttribute('data-dita-src') || 'unknown';
    var msg = 'Image fail: ' + src;
    img.alt = msg;
    img.style.outline = '3px solid red';
    img.style.outlineOffset = '-1px';
  }, true);

  function highlightElement(el) {
    if (!el) return;
    var prev = document.querySelector('.__hl');
    if (prev) prev.classList.remove('__hl');
    el.classList.add('__hl');
  }

  function isElementVisible(el) {
    var rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight && rect.bottom > 0;
  }

  window.addEventListener('scroll', function() {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(onScrollEnd, 150);
  });

  window.addEventListener('click', function(e) {
    var a = e.target.closest ? e.target.closest('a.xref') : null;
    if (!a) return;
    var href = a.getAttribute('href');
    if (!href || href.charAt(0) !== '#') return;
    e.preventDefault();
    var id = href.slice(1);
    var el = document.getElementById(id);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });

  window.addEventListener('dblclick', function(e) {
    var el = e.target.closest ? e.target.closest('[data-line]') : null;
    if (!el) return;
    var line = parseInt(el.getAttribute('data-line'), 10);
    if (!isNaN(line)) vscode.postMessage({ type: 'navigateToLine', line: line });
  });

  window.addEventListener('message', function(e) {
    if (e.data.type === 'revealLine') scrollToLine(e.data.line);
    if (e.data.type === 'highlightLine') {
      var best = findClosest(e.data.line);
      if (best) {
        highlightElement(best);
        if (!isElementVisible(best)) best.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  });

  // Toolbar
  var tbStyle = 'position:fixed;top:4px;right:8px;z-index:9999;display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:5px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;background:var(--vscode-editor-background,rgba(30,30,30,0.88));border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.12));backdrop-filter:blur(4px);opacity:0.75;transition:opacity 0.15s;';
  var ddStyle = 'padding:1px 4px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);font-size:11px;outline:none;cursor:pointer;';
  var btnStyle = 'padding:1px 5px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);cursor:pointer;font-size:13px;line-height:1;outline:none;display:flex;align-items:center;';

  var toolbar = document.createElement('div');
  toolbar.id = '__toolbar';
  toolbar.style.cssText = tbStyle;
  toolbar.addEventListener('mouseenter', function() { toolbar.style.opacity = '1'; });
  toolbar.addEventListener('mouseleave', function() { toolbar.style.opacity = '0.75'; });

  // Theme CSS dropdown
  var cssFiles = window.__cssFiles || {};
  var defaultCss = window.__defaultCss || '';
  var cssKeys = Object.keys(cssFiles);
  if (cssKeys.length > 0) {
    var styleEl = document.createElement('style');
    styleEl.id = '__custom_css';
    styleEl.textContent = cssFiles[defaultCss] || '';
    document.head.appendChild(styleEl);
    var sel = document.createElement('select');
    sel.title = 'Select theme CSS';
    sel.style.cssText = 'max-width:130px;' + ddStyle;
    for (var i = 0; i < cssKeys.length; i++) {
      var opt = document.createElement('option');
      opt.value = cssKeys[i];
      opt.textContent = cssKeys[i].replace(/\\.css$/,'');
      if (cssKeys[i] === defaultCss) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', function() { styleEl.textContent = cssFiles[sel.value] || ''; });
    toolbar.appendChild(sel);
  }

  // Font size controls
  var fsDown = document.createElement('button');
  fsDown.innerHTML = 'A\u2212';
  fsDown.title = 'Decrease font size';
  fsDown.style.cssText = btnStyle + 'font-weight:bold;';
  fsDown.addEventListener('click', function() {
    fontSize = Math.max(60, fontSize - 10);
    document.body.style.fontSize = fontSize + '%';
  });
  toolbar.appendChild(fsDown);

  var fsUp = document.createElement('button');
  fsUp.innerHTML = 'A+';
  fsUp.title = 'Increase font size';
  fsUp.style.cssText = btnStyle + 'font-weight:bold;';
  fsUp.addEventListener('click', function() {
    fontSize = Math.min(200, fontSize + 10);
    document.body.style.fontSize = fontSize + '%';
  });
  toolbar.appendChild(fsUp);

  // Page width dropdown
  var widths = [
    { label: 'Auto', value: '' },
    { label: 'Full', value: '100%' },
    { label: 'Wide', value: '1400px' },
    { label: 'Desktop', value: '1280px' },
    { label: 'Narrow', value: '720px' },
  ];
  var wSel = document.createElement('select');
  wSel.title = 'Page width';
  wSel.style.cssText = 'max-width:72px;' + ddStyle;
  for (var i = 0; i < widths.length; i++) {
    var opt = document.createElement('option');
    opt.value = widths[i].value;
    opt.textContent = widths[i].label;
    wSel.appendChild(opt);
  }
  wSel.addEventListener('change', function() {
    document.body.style.maxWidth = wSel.value;
    document.body.style.margin = wSel.value ? '0 auto' : '';
  });
  toolbar.appendChild(wSel);

  // Refresh button
  var refreshBtn = document.createElement('button');
  refreshBtn.innerHTML = '&#x21bb;';
  refreshBtn.title = 'Reload DITA content';
  refreshBtn.style.cssText = btnStyle;
  refreshBtn.addEventListener('click', function() { vscode.postMessage({ type: 'refresh' }); });
  toolbar.appendChild(refreshBtn);

  document.body.appendChild(toolbar);
})();
`}var me=class{constructor(t){this.context=t}async resolveCustomTextEditor(t,i,r){let a=y.Uri.file((0,x.dirname)(t.uri.fsPath));i.webview.options={enableScripts:!0,localResourceRoots:[y.Uri.file(this.context.extensionPath),a,...(y.workspace.workspaceFolders||[]).map(v=>v.uri)]};let d=()=>y.window.visibleTextEditors.find(v=>v.document.uri.toString()===t.uri.toString()),p=v=>{i.webview.postMessage({type:"revealLine",line:v})},u=0;i.webview.onDidReceiveMessage(v=>{if(v.type==="refresh")h(),setTimeout(g,200);else if(v.type==="scrollSync"){let b=d();if(b){let _=b.visibleRanges[0]?.start.line;if(_!==void 0&&Math.abs(v.line-_)>=2){u=Date.now()+250;let N=Math.max(0,Math.min(v.line,t.lineCount-1));b.revealRange(new y.Range(N,0,N,0),y.TextEditorRevealType.AtTop),b.selection=new y.Selection(new y.Position(N,0),new y.Position(N,0))}}}else if(v.type==="navigateToLine"){let b=d();if(b){let _=Math.max(0,Math.min(v.line,t.lineCount-1));b.visibleRanges.some(N=>_>=N.start.line&&_<=N.end.line)||b.revealRange(new y.Range(_,0,_,0),y.TextEditorRevealType.AtTop),b.selection=new y.Selection(new y.Position(_,0),new y.Position(_,0))}}});let f=y.window.onDidChangeTextEditorSelection(v=>{if(v.textEditor.document.uri.toString()!==t.uri.toString()||Date.now()<u)return;let b=v.selections[0];!b||b.start.line!==b.end.line||i.webview.postMessage({type:"highlightLine",line:b.start.line})}),g=()=>{let v=d();if(v){let b=v.visibleRanges[0]?.start.line;b!==void 0&&p(b)}},m=y.window.onDidChangeTextEditorVisibleRanges(v=>{if(v.textEditor.document.uri.toString()===t.uri.toString()){if(Date.now()<u)return;let b=v.textEditor.visibleRanges[0]?.start.line;b!==void 0&&p(b)}}),T=y.workspace.onDidChangeTextDocument(v=>{v.document.uri.toString()===t.uri.toString()&&(h(),setTimeout(g,200))}),h=()=>{let v=this.generateHtml(t,i.webview);i.webview.html=v};h(),setTimeout(g,300),i.onDidDispose(()=>{T.dispose(),m.dispose(),f.dispose()})}generateHtml(t,i){let r=i.asWebviewUri(y.Uri.file((0,x.join)(this.context.extensionPath,"media","styles.css"))),a=(0,x.dirname)(t.uri.fsPath),d=y.Uri.file(a),p=u=>{try{let f=(0,x.resolve)(a,u),g=y.Uri.file(f),m=i.asWebviewUri(g);if(m)return m.toString()}catch{}try{let f=(0,x.resolve)(a,u);if((0,I.existsSync)(f)){let g=(0,I.readFileSync)(f),m=(0,x.extname)(u).toLowerCase();return`data:${m===".png"?"image/png":m===".jpg"||m===".jpeg"?"image/jpeg":m===".gif"?"image/gif":m===".svg"?"image/svg+xml":m===".webp"?"image/webp":"image/png"};base64,${g.toString("base64")}`}}catch{}return""};try{let u=t.getText(),f=Y(u),g=ie(f),m=Ce(g.root),v=(g.root.attributes?.["xml:lang"]||"").startsWith("zh")?{note:"\u6CE8",notice:"\u6CE8\u610F",warning:"\u8B66\u544A",danger:"\u5371\u9669",important:"\u91CD\u8981",tip:"\u63D0\u793A",restriction:"\u9650\u5236"}:{note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"},b=Ae(t.uri),_=_e(a),D=Se(a),N=G=>{let te=m.get(G);if(te)return te;if(G.includes("#"))return D(G)},F=pe(g.root,{headingLevel:1,asWebviewUri:p,documentDir:d.fsPath,resolveTitle:N,resolveKey:G=>b.get(G),resolveConref:G=>_(G),noteLabels:v}),{files:ee,defaultName:R}=Bt(t.uri),j=ee[R]||"",re=y.window.activeColorTheme,V=re.kind===y.ColorThemeKind.Dark||re.kind===y.ColorThemeKind.HighContrast,Te=It(),c=Xe(JSON.stringify(ee)),se=Xe(JSON.stringify(R)),z=(0,Ke.randomBytes)(16).toString("base64");return`<!DOCTYPE html>
<html lang="en"${V?' class="vscode-dark"':""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${i.cspSource} data:; style-src ${i.cspSource} 'unsafe-inline'; script-src 'nonce-${z}';">
<link rel="stylesheet" href="${r}">
${j?`<style>
${j}
</style>`:""}
<title>${t.fileName}</title>
<script nonce="${z}">window.__cssFiles=${c};window.__defaultCss=${se};</script>
</head>
<body>
${F}
<script nonce="${z}">${Te}</script>
</body>
</html>`}catch(u){let f=u instanceof Error?u.message:String(u);return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Render Error</h2>
<pre>${Lt(f)}</pre>
</div>
</body>
</html>`}}};function Lt(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function Xe(e){return e.replace(/<\/script>/gi,"<\\/script>")}function Ft(e){let t=[],i=(0,x.dirname)(e.fsPath),r=$e(i),a=i;for(;a.length>=r.length;){try{for(let p of(0,I.readdirSync)(a))p.endsWith(".ditamap")&&t.push((0,x.join)(a,p))}catch{}if(t.length>0)return t;let d=(0,x.dirname)(a);if(d===a)break;a=d}return t}function Qe(e){return e.type==="text"?e.text||"":(e.children||[]).map(Qe).join("")}function Mt(e,t){for(let i of t){let r=(e.children||[]).find(a=>a.type==="element"&&a.baseType===i);if(r){let a=Qe(r).trim();if(a)return a}}}function Ot(e){let t=(e.children||[]).find(i=>i.type==="element"&&i.baseType==="map/topicmeta");if(t)return Mt(t,["map/keyword","map/linktext","map/navtitle","map/shortdesc"])}function Ae(e){let t=new Map,i=Ft(e);for(let a of i)try{let f=function(g){if(g.type!=="element")return;let m=g.baseType;if((m==="map/topicref"||m==="map/keydef")&&g.attributes?.keys){let T=g.attributes.keys,h=Ot(g);t.set(T,h||T)}for(let T of g.children||[])f(T)};var r=f;let d=(0,I.readFileSync)(a,"utf-8"),u=de(Y(d)).root;for(let g of u.children||[])f(g)}catch{}return t}function Bt(e){let t={},i=new Set,r=g=>{let m=(0,x.basename)(g);if(!i.has(m)&&(0,I.existsSync)(g))try{t[m]=(0,I.readFileSync)(g,"utf-8"),i.add(m)}catch{}},a=(0,x.dirname)(e.fsPath),d=$e(a),p=Pt(a),u=new Set;u.add(p),d!==p&&u.add(d);try{let m=y.workspace.getConfiguration("dita-viewer").get("cssDirectory");if(m)for(let T of m){let h=Vt(T,a);h&&(0,I.existsSync)(h)&&!u.has(h)&&u.add(h)}}catch{}for(let g of u)try{for(let m of(0,I.readdirSync)(g))m.toLowerCase().endsWith(".css")&&r((0,x.join)(g,m))}catch{}try{let m=y.workspace.getConfiguration("dita-viewer").get("customCss");if(m)for(let T of m){let h=Ut(T,a);h&&r(h)}}catch{}let f=t["custom.css"]?"custom.css":Object.keys(t)[0]||"";return{files:t,defaultName:f}}function Pt(e){let t=$e(e),i=e;for(;i.length>=t.length;){if((0,I.existsSync)((0,x.join)(i,"custom.css")))return i;let r=(0,x.dirname)(i);if(r===i)break;i=r}return e}function $e(e){let t=y.workspace.workspaceFolders;if(t&&t.length>0)return t[0].uri.fsPath;let i=e.includes("/")?"/":"\\",r=e.split(/[\\/]/);return i==="/"?"/"+r.slice(1,2).join("/"):r.length>2?r.slice(0,2).join("\\"):e}function Ut(e,t){if((0,x.isAbsolute)(e)&&(0,I.existsSync)(e))return e;let i=(0,x.resolve)(t,e);if((0,I.existsSync)(i))return i;let r=y.workspace.workspaceFolders;if(r)for(let a of r){let d=(0,x.resolve)(a.uri.fsPath,e);if((0,I.existsSync)(d))return d}}function Vt(e,t){if((0,x.isAbsolute)(e))return(0,I.existsSync)(e)?e:void 0;let i=(0,x.resolve)(t,e);if((0,I.existsSync)(i))return i;let r=y.workspace.workspaceFolders;if(r)for(let a of r){let d=(0,x.resolve)(a.uri.fsPath,e);if((0,I.existsSync)(d))return d}}var M=ce(require("vscode"));function J(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Ze(e,t){return t==null?"":` ${e}="${J(t)}"`}function Q(e,t){return e.attributes?.[t]}function he(e){return e.type==="text"?e.text||"":(e.children||[]).map(he).join("")}function Je(e,t){for(let i of t){let r=(e.children||[]).find(a=>a.type==="element"&&a.baseType===i);if(r){let a=he(r).trim();if(a)return a}}}function ke(e){let t=Q(e,"keys"),i=Q(e,"href"),r=(e.children||[]).find(a=>a.type==="element"&&a.baseType==="map/topicmeta");if(r){let a=Je(r,["map/navtitle","map/linktext","map/shortdesc"]);if(a)return a;let d=r.children.find(p=>p.type==="element"&&p.baseType==="map/keywords");if(d){let p=Je(d,["map/keyword"]);if(p)return p}}if(i){let a=i.replace(/\\/g,"/").split("/"),d=a[a.length-1]||"",p=d.lastIndexOf(".");return p>0?d.substring(0,p):d}return t||"(unnamed)"}function Wt(e){return!!Q(e,"href")}function oe(e,t,i){return(e.children||[]).filter(r=>r.type==="element").map(r=>i(r,t)).join("")}function et(e,t,i){let r=Q(e,"href")||"",a=Q(e,"keys")||"",d=ke(e),p=Wt(e),u=oe(e,t,i),f=p?'<span class="map-tree-icon map-tree-icon--file">\u{1F4C4}</span>':'<span class="map-tree-icon map-tree-icon--key">\u{1F511}</span>',g=J(d),m=Ze("data-keys",a),T=r?Ze("data-href",r):"";return p?`<li class="map-tree-item map-tree-item--nav"${m}${T}>
      <a href="#" class="map-tree-link" data-href="${J(r)}">${f}<span class="map-tree-label">${g}</span></a>
      ${u?`<ul class="map-tree">${u}</ul>`:""}
    </li>`:`<li class="map-tree-item map-tree-item--keydef"${m}${T}>
    ${f}<span class="map-tree-label map-tree-label--keydef">${g}</span>
    ${u?`<ul class="map-tree">${u}</ul>`:""}
  </li>`}var zt={"map/map":(e,t,i)=>{let r=e.children.find(u=>u.type==="element"&&u.baseType==="map/map-title"),a=r?`<h1 class="map-title">${J(he(r))}</h1>`:"",p=e.children.filter(u=>u.type!=="element"||u.baseType!=="map/map-title").filter(u=>u.type==="element").map(u=>i(u,t)).join("");return`<div class="ditamap-container">
      ${a}
      <ul class="map-tree">${p}</ul>
    </div>`},"map/map-title":(e,t,i)=>`<h1 class="map-title">${J(he(e))}</h1>`,"map/topicref":et,"map/topichead":(e,t,i)=>{let r=ke(e),a=oe(e,t,i);return`<li class="map-tree-item map-tree-item--head">
      <span class="map-tree-label map-tree-label--head">${J(r)}</span>
      ${a?`<ul class="map-tree">${a}</ul>`:""}
    </li>`},"map/topicgroup":(e,t,i)=>`<li class="map-tree-item map-tree-item--group">
      <ul class="map-tree">${oe(e,t,i)}</ul>
    </li>`,"map/keydef":et,"map/reltable":(e,t,i)=>`<div class="map-reltable"><h2 class="map-reltable-title">Related Information</h2>
      <table class="map-reltable-table"><tbody>${e.children.filter(d=>d.type==="element"&&(d.baseType==="map/relheader"||d.baseType==="map/relrow")).map(d=>i(d,t)).join("")}</tbody></table>
    </div>`,"map/relheader":(e,t,i)=>`<tr class="relheader">${e.children.filter(a=>a.type==="element"&&a.baseType==="map/relcell").map(a=>i(a,t)).map(a=>`<th>${a}</th>`).join("")}</tr>`,"map/relrow":(e,t,i)=>`<tr class="relrow">${e.children.filter(a=>a.type==="element"&&a.baseType==="map/relcell").map(a=>i(a,t)).map(a=>`<td>${a}</td>`).join("")}</tr>`,"map/relcell":(e,t,i)=>`<span class="relcell-content"><ul class="map-tree map-tree--inline">${oe(e,t,i)}</ul></span>`,"map/relcolspec":()=>"","map/topicmeta":()=>"","map/linktext":()=>"","map/navtitle":()=>"","map/shortdesc":()=>"","map/keywords":()=>"","map/keyword":()=>"","map/anchor":()=>"","map/navref":()=>"","map/mapref":()=>""};function ge(e,t,i){if(e.type!=="element")return;let r=e.baseType;if(r!=="map/reltable")if(r==="map/topicref"||r==="map/keydef"||r==="map/topichead"){let a=Q(e,"href"),d=Q(e,"keys");i.push({href:a,displayName:ke(e),depth:t,keys:d});for(let p of e.children||[])ge(p,t+1,i)}else if(r==="map/topicgroup")for(let a of e.children||[])ge(a,t,i);else for(let a of e.children||[])ge(a,t,i)}function tt(e){let t=[];for(let i of e.children||[])ge(i,0,t);return t}function nt(e,t){function i(a,d){if(a.type==="text")return"";let p=a.baseType,u=p?zt[p]:void 0;return u?u(a,d,i):oe(a,d,i)}let r={docDir:t.docDir};return i(e,r)}var U=require("path"),it=require("crypto"),ye=require("fs");function Gt(){return`
(function() {
  var vscode = acquireVsCodeApi();
  var currentMode = 'tree';

  // Click on navigable tree node \u2192 post message to extension
  document.addEventListener('click', function(e) {
    var link = e.target.closest ? e.target.closest('.map-tree-link') : null;
    if (!link) return;
    e.preventDefault();
    var href = link.getAttribute('data-href');
    if (href) {
      vscode.postMessage({ type: 'openTopic', href: href });
    }
  });

  // Toolbar (same pattern as DITA viewer)
  var tbStyle = 'position:fixed;top:4px;right:8px;z-index:9999;display:flex;align-items:center;gap:4px;padding:3px 6px;border-radius:5px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;background:var(--vscode-editor-background,rgba(30,30,30,0.88));border:1px solid var(--vscode-widget-border,rgba(255,255,255,0.12));backdrop-filter:blur(4px);opacity:0.75;transition:opacity 0.15s;';
  var btnStyle = 'padding:1px 5px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);cursor:pointer;font-size:13px;line-height:1;outline:none;display:flex;align-items:center;';

  var toolbar = document.createElement('div');
  toolbar.id = '__toolbar';
  toolbar.style.cssText = tbStyle;
  toolbar.addEventListener('mouseenter', function() { toolbar.style.opacity = '1'; });
  toolbar.addEventListener('mouseleave', function() { toolbar.style.opacity = '0.75'; });

  var fontSize = 100;
  var fsDown = document.createElement('button');
  fsDown.innerHTML = 'A\u2212';
  fsDown.title = 'Decrease font size';
  fsDown.style.cssText = btnStyle + 'font-weight:bold;';
  fsDown.addEventListener('click', function() {
    fontSize = Math.max(60, fontSize - 10);
    document.body.style.fontSize = fontSize + '%';
  });
  toolbar.appendChild(fsDown);

  var fsUp = document.createElement('button');
  fsUp.innerHTML = 'A+';
  fsUp.title = 'Increase font size';
  fsUp.style.cssText = btnStyle + 'font-weight:bold;';
  fsUp.addEventListener('click', function() {
    fontSize = Math.min(200, fontSize + 10);
    document.body.style.fontSize = fontSize + '%';
  });
  toolbar.appendChild(fsUp);

  // Page width
  var widths = [
    { label: 'Auto', value: '' },
    { label: 'Full', value: '100%' },
    { label: 'Wide', value: '1400px' },
    { label: 'Desktop', value: '1280px' },
    { label: 'Narrow', value: '720px' },
  ];
  var ddStyle = 'padding:1px 4px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);font-size:11px;outline:none;cursor:pointer;';
  var wSel = document.createElement('select');
  wSel.title = 'Page width';
  wSel.style.cssText = 'max-width:72px;' + ddStyle;
  for (var i = 0; i < widths.length; i++) {
    var opt = document.createElement('option');
    opt.value = widths[i].value;
    opt.textContent = widths[i].label;
    wSel.appendChild(opt);
  }
  wSel.addEventListener('change', function() {
    document.body.style.maxWidth = wSel.value;
    document.body.style.margin = wSel.value ? '0 auto' : '';
  });
  toolbar.appendChild(wSel);

  // Mode toggle button
  var modeBtn = document.createElement('button');
  modeBtn.title = 'Switch between outline tree and full book view';
  modeBtn.style.cssText = btnStyle + 'font-size:11px;';
  modeBtn.textContent = 'Outline';
  function updateModeLabel() {
    modeBtn.textContent = currentMode === 'tree' ? 'Book' : 'Outline';
  }
  modeBtn.addEventListener('click', function() {
    var newMode = currentMode === 'tree' ? 'book' : 'tree';
    currentMode = newMode;
    updateModeLabel();
    vscode.postMessage({ type: 'switchMode', mode: newMode });
  });
  toolbar.appendChild(modeBtn);

  document.body.appendChild(toolbar);
})();
`}var be=class{constructor(t){this.context=t}async resolveCustomTextEditor(t,i,r){let a=M.Uri.file((0,U.dirname)(t.uri.fsPath)),d="tree";i.webview.options={enableScripts:!0,localResourceRoots:[M.Uri.file(this.context.extensionPath),a,...(M.workspace.workspaceFolders||[]).map(f=>f.uri)]},i.webview.onDidReceiveMessage(f=>{if(f.type==="refresh")u();else if(f.type==="openTopic"){let g=f.href;if(!g)return;let m=(0,U.dirname)(t.uri.fsPath),T=(0,U.resolve)(m,g),h=M.Uri.file(T);M.commands.executeCommand("vscode.openWith",h,"ditaViewer.preview")}else f.type==="switchMode"&&(d=f.mode,u())});let p=M.workspace.onDidChangeTextDocument(f=>{f.document.uri.toString()===t.uri.toString()&&u()}),u=()=>{let f=this.generateHtml(t,i.webview,d);i.webview.html=f};u(),i.onDidDispose(()=>{p.dispose()})}generateHtml(t,i,r){let a=i.asWebviewUri(M.Uri.file((0,U.join)(this.context.extensionPath,"media","styles.css"))),d=(0,U.dirname)(t.uri.fsPath);try{let p=t.getText(),u=Y(p),f=de(u),g;r==="book"?g=this.renderBookContent(f.root,t,i,d):g=nt(f.root,{docDir:d});let m=Gt(),T=(0,it.randomBytes)(16).toString("base64"),h=M.window.activeColorTheme;return`<!DOCTYPE html>
<html lang="en"${h.kind===M.ColorThemeKind.Dark||h.kind===M.ColorThemeKind.HighContrast?' class="vscode-dark"':""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${i.cspSource} data:; style-src ${i.cspSource} 'unsafe-inline'; script-src 'nonce-${T}';">
<link rel="stylesheet" href="${a}">
<title>${t.fileName}</title>
</head>
<body class="mode-${r}">
${g}
<script nonce="${T}">${m}</script>
</body>
</html>`}catch(p){let u=p instanceof Error?p.message:String(p);return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Map Render Error</h2>
<pre>${ve(u)}</pre>
</div>
</body>
</html>`}}renderBookContent(t,i,r,a){let d=tt(t),p=Ae(i.uri),u=new Set,f=[];for(let g of d)if(g.href){let m=(0,U.resolve)(a,g.href);if(u.has(m)){f.push(`<p class="book-skip">(Skipped: ${ve(g.href)} already included above)</p>`);continue}u.add(m);let T=(0,U.dirname)(m),h=_=>{try{let D=(0,U.resolve)(T,_),N=M.Uri.file(D),F=r.asWebviewUri(N);if(F)return F.toString()}catch{}try{let D=(0,U.resolve)(T,_);if((0,ye.existsSync)(D)){let N=(0,ye.readFileSync)(D),F=_.toLowerCase().split(".").pop()||"";return`data:${F==="png"?"image/png":F==="jpg"||F==="jpeg"?"image/jpeg":F==="gif"?"image/gif":F==="svg"?"image/svg+xml":F==="webp"?"image/webp":"image/png"};base64,${N.toString("base64")}`}}catch{}return""},v=Math.min(1+g.depth,6),b=je({filePath:m,keyMap:p,asWebviewUri:h,headingLevel:v});b.error?f.push(`<div class="book-entry book-entry--error">
            <h${v} class="book-entry-title">${ve(g.displayName)}</h${v}>
            <p class="book-error">${ve(b.error)}</p>
          </div>`):f.push(`<div class="book-entry">${b.html}</div>`)}else{let m=Math.min(1+g.depth,6);f.push(`<div class="book-entry book-entry--placeholder">
          <h${m} class="book-section-heading">${qt(g.displayName)}</h${m}>
        </div>`)}return`<div class="ditamap-book">${f.join(`
`)}</div>`}};function ve(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function qt(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Ht(e){e.subscriptions.push(P.window.registerCustomEditorProvider("ditaViewer.preview",new me(e),{webviewOptions:{retainContextWhenHidden:!0}})),e.subscriptions.push(P.window.registerCustomEditorProvider("ditaViewer.mapPreview",new be(e),{webviewOptions:{retainContextWhenHidden:!0}}));let t=P.commands.registerCommand("ditaViewer.showRendered",()=>{let r=P.window.activeTextEditor;r&&P.commands.executeCommand("vscode.openWith",r.document.uri,"ditaViewer.preview",P.ViewColumn.Beside)});e.subscriptions.push(t);let i=P.commands.registerCommand("ditaViewer.showMapRendered",()=>{let r=P.window.activeTextEditor;r&&P.commands.executeCommand("vscode.openWith",r.document.uri,"ditaViewer.mapPreview",P.ViewColumn.Beside)});e.subscriptions.push(i)}0&&(module.exports={activate});
/*! Bundled license information:

sax/lib/sax.js:
  (*! http://mths.be/fromcodepoint v0.1.0 by @mathias *)
*/
