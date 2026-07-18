"use strict";var wt=Object.create;var fe=Object.defineProperty;var xt=Object.getOwnPropertyDescriptor;var Dt=Object.getOwnPropertyNames;var Ct=Object.getPrototypeOf,St=Object.prototype.hasOwnProperty;var Nt=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),At=(e,t)=>{for(var i in t)fe(e,i,{get:t[i],enumerable:!0})},Ve=(e,t,i,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of Dt(t))!St.call(e,s)&&s!==i&&fe(e,s,{get:()=>t[s],enumerable:!(r=xt(t,s))||r.enumerable});return e};var me=(e,t,i)=>(i=e!=null?wt(Ct(e)):{},Ve(t||!e||!e.__esModule?fe(i,"default",{value:e,enumerable:!0}):i,e)),_t=e=>Ve(fe({},"__esModule",{value:!0}),e);var We=Nt(ge=>{"use strict";(function(e){e.parser=function(o,n){return new i(o,n)},e.SAXParser=i,e.SAXStream=g,e.createStream=m,e.MAX_BUFFER_LENGTH=64*1024;var t=["comment","sgmlDecl","textNode","tagName","doctype","procInstName","procInstBody","entity","attribName","attribValue","cdata","script"];e.EVENTS=["text","processinginstruction","sgmldeclaration","doctype","comment","opentagstart","attribute","opentag","closetag","opencdata","cdata","closecdata","error","end","ready","script","opennamespace","closenamespace"];function i(o,n){if(!(this instanceof i))return new i(o,n);var l=this;s(l),l.q=l.c="",l.bufferCheckPosition=e.MAX_BUFFER_LENGTH,l.encoding=null,l.opt=n||{},l.opt.lowercase=l.opt.lowercase||l.opt.lowercasetags,l.looseCase=l.opt.lowercase?"toLowerCase":"toUpperCase",l.opt.maxEntityCount=l.opt.maxEntityCount||512,l.opt.maxEntityDepth=l.opt.maxEntityDepth||4,l.entityCount=l.entityDepth=0,l.tags=[],l.closed=l.closedRoot=l.sawRoot=!1,l.tag=l.error=null,l.strict=!!o,l.noscript=!!(o||l.opt.noscript),l.state=c.BEGIN,l.strictEntities=l.opt.strictEntities,l.ENTITIES=l.strictEntities?Object.create(e.XML_ENTITIES):Object.create(e.ENTITIES),l.attribList=[],l.opt.xmlns&&(l.ns=Object.create(y)),l.opt.unquotedAttributeValues===void 0&&(l.opt.unquotedAttributeValues=!o),l.trackPosition=l.opt.position!==!1,l.trackPosition&&(l.position=l.line=l.column=0),F(l,"onready")}Object.create||(Object.create=function(o){function n(){}n.prototype=o;var l=new n;return l}),Object.keys||(Object.keys=function(o){var n=[];for(var l in o)o.hasOwnProperty(l)&&n.push(l);return n});function r(o){for(var n=Math.max(e.MAX_BUFFER_LENGTH,10),l=0,a=0,C=t.length;a<C;a++){var $=o[t[a]].length;if($>n)switch(t[a]){case"textNode":se(o);break;case"cdata":I(o,"oncdata",o.cdata),o.cdata="";break;case"script":I(o,"onscript",o.script),o.script="";break;default:ee(o,"Max buffer length exceeded: "+t[a])}l=Math.max(l,$)}var L=e.MAX_BUFFER_LENGTH-l;o.bufferCheckPosition=L+o.position}function s(o){for(var n=0,l=t.length;n<l;n++)o[t[n]]=""}function d(o){se(o),o.cdata!==""&&(I(o,"oncdata",o.cdata),o.cdata=""),o.script!==""&&(I(o,"onscript",o.script),o.script="")}i.prototype={end:function(){Pe(this)},write:yt,resume:function(){return this.error=null,this},close:function(){return this.write(null)},flush:function(){d(this)}};var p;try{p=require("stream").Stream}catch{p=function(){}}p||(p=function(){});var u=e.EVENTS.filter(function(o){return o!=="error"&&o!=="end"});function m(o,n){return new g(o,n)}function f(o,n){if(o.length>=2){if(o[0]===255&&o[1]===254)return"utf-16le";if(o[0]===254&&o[1]===255)return"utf-16be"}return o.length>=3&&o[0]===239&&o[1]===187&&o[2]===191?"utf8":o.length>=4?o[0]===60&&o[1]===0&&o[2]===63&&o[3]===0?"utf-16le":o[0]===0&&o[1]===60&&o[2]===0&&o[3]===63?"utf-16be":"utf8":n?"utf8":null}function g(o,n){if(!(this instanceof g))return new g(o,n);p.apply(this),this._parser=new i(o,n),this.writable=!0,this.readable=!0;var l=this;this._parser.onend=function(){l.emit("end")},this._parser.onerror=function(a){l.emit("error",a),l._parser.error=null},this._decoder=null,this._decoderBuffer=null,u.forEach(function(a){Object.defineProperty(l,"on"+a,{get:function(){return l._parser["on"+a]},set:function(C){if(!C)return l.removeAllListeners(a),l._parser["on"+a]=C,C;l.on(a,C)},enumerable:!0,configurable:!1})})}g.prototype=Object.create(p.prototype,{constructor:{value:g}}),g.prototype._decodeBuffer=function(o,n){if(this._decoderBuffer&&(o=Buffer.concat([this._decoderBuffer,o]),this._decoderBuffer=null),!this._decoder){var l=f(o,n);if(!l)return this._decoderBuffer=o,"";this._parser.encoding=l,this._decoder=new TextDecoder(l)}return this._decoder.decode(o,{stream:!n})},g.prototype.write=function(o){if(typeof Buffer=="function"&&typeof Buffer.isBuffer=="function"&&Buffer.isBuffer(o))o=this._decodeBuffer(o,!1);else if(this._decoderBuffer){var n=this._decodeBuffer(Buffer.alloc(0),!0);n&&(this._parser.write(n),this.emit("data",n))}return this._parser.write(o.toString()),this.emit("data",o),!0},g.prototype.end=function(o){if(o&&o.length&&this.write(o),this._decoderBuffer){var n=this._decodeBuffer(Buffer.alloc(0),!0);n&&(this._parser.write(n),this.emit("data",n))}else if(this._decoder){var l=this._decoder.decode();l&&(this._parser.write(l),this.emit("data",l))}return this._parser.end(),!0},g.prototype.on=function(o,n){var l=this;return!l._parser["on"+o]&&u.indexOf(o)!==-1&&(l._parser["on"+o]=function(){var a=arguments.length===1?[arguments[0]]:Array.apply(null,arguments);a.splice(0,0,o),l.emit.apply(l,a)}),p.prototype.on.call(l,o,n)};var w="[CDATA[",b="DOCTYPE",A="http://www.w3.org/XML/1998/namespace",h="http://www.w3.org/2000/xmlns/",y={xml:A,xmlns:h},E=/[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,x=/[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/,D=/[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,Q=/[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/;function k(o){return o===" "||o===`
`||o==="\r"||o==="	"}function V(o){return o==='"'||o==="'"}function J(o){return o===">"||k(o)}function z(o,n){return o.test(n)}function Z(o,n){return!z(o,n)}var c=0;e.STATE={BEGIN:c++,BEGIN_WHITESPACE:c++,TEXT:c++,TEXT_ENTITY:c++,OPEN_WAKA:c++,SGML_DECL:c++,SGML_DECL_QUOTED:c++,DOCTYPE:c++,DOCTYPE_QUOTED:c++,DOCTYPE_DTD:c++,DOCTYPE_DTD_QUOTED:c++,COMMENT_STARTING:c++,COMMENT:c++,COMMENT_ENDING:c++,COMMENT_ENDED:c++,CDATA:c++,CDATA_ENDING:c++,CDATA_ENDING_2:c++,PROC_INST:c++,PROC_INST_BODY:c++,PROC_INST_ENDING:c++,OPEN_TAG:c++,OPEN_TAG_SLASH:c++,ATTRIB:c++,ATTRIB_NAME:c++,ATTRIB_NAME_SAW_WHITE:c++,ATTRIB_VALUE:c++,ATTRIB_VALUE_QUOTED:c++,ATTRIB_VALUE_CLOSED:c++,ATTRIB_VALUE_UNQUOTED:c++,ATTRIB_VALUE_ENTITY_Q:c++,ATTRIB_VALUE_ENTITY_U:c++,CLOSE_TAG:c++,CLOSE_TAG_SAW_WHITE:c++,SCRIPT:c++,SCRIPT_ENDING:c++},e.XML_ENTITIES={amp:"&",gt:">",lt:"<",quot:'"',apos:"'"},e.ENTITIES={amp:"&",gt:">",lt:"<",quot:'"',apos:"'",AElig:198,Aacute:193,Acirc:194,Agrave:192,Aring:197,Atilde:195,Auml:196,Ccedil:199,ETH:208,Eacute:201,Ecirc:202,Egrave:200,Euml:203,Iacute:205,Icirc:206,Igrave:204,Iuml:207,Ntilde:209,Oacute:211,Ocirc:212,Ograve:210,Oslash:216,Otilde:213,Ouml:214,THORN:222,Uacute:218,Ucirc:219,Ugrave:217,Uuml:220,Yacute:221,aacute:225,acirc:226,aelig:230,agrave:224,aring:229,atilde:227,auml:228,ccedil:231,eacute:233,ecirc:234,egrave:232,eth:240,euml:235,iacute:237,icirc:238,igrave:236,iuml:239,ntilde:241,oacute:243,ocirc:244,ograve:242,oslash:248,otilde:245,ouml:246,szlig:223,thorn:254,uacute:250,ucirc:251,ugrave:249,uuml:252,yacute:253,yuml:255,copy:169,reg:174,nbsp:160,iexcl:161,cent:162,pound:163,curren:164,yen:165,brvbar:166,sect:167,uml:168,ordf:170,laquo:171,not:172,shy:173,macr:175,deg:176,plusmn:177,sup1:185,sup2:178,sup3:179,acute:180,micro:181,para:182,middot:183,cedil:184,ordm:186,raquo:187,frac14:188,frac12:189,frac34:190,iquest:191,times:215,divide:247,OElig:338,oelig:339,Scaron:352,scaron:353,Yuml:376,fnof:402,circ:710,tilde:732,Alpha:913,Beta:914,Gamma:915,Delta:916,Epsilon:917,Zeta:918,Eta:919,Theta:920,Iota:921,Kappa:922,Lambda:923,Mu:924,Nu:925,Xi:926,Omicron:927,Pi:928,Rho:929,Sigma:931,Tau:932,Upsilon:933,Phi:934,Chi:935,Psi:936,Omega:937,alpha:945,beta:946,gamma:947,delta:948,epsilon:949,zeta:950,eta:951,theta:952,iota:953,kappa:954,lambda:955,mu:956,nu:957,xi:958,omicron:959,pi:960,rho:961,sigmaf:962,sigma:963,tau:964,upsilon:965,phi:966,chi:967,psi:968,omega:969,thetasym:977,upsih:978,piv:982,ensp:8194,emsp:8195,thinsp:8201,zwnj:8204,zwj:8205,lrm:8206,rlm:8207,ndash:8211,mdash:8212,lsquo:8216,rsquo:8217,sbquo:8218,ldquo:8220,rdquo:8221,bdquo:8222,dagger:8224,Dagger:8225,bull:8226,hellip:8230,permil:8240,prime:8242,Prime:8243,lsaquo:8249,rsaquo:8250,oline:8254,frasl:8260,euro:8364,image:8465,weierp:8472,real:8476,trade:8482,alefsym:8501,larr:8592,uarr:8593,rarr:8594,darr:8595,harr:8596,crarr:8629,lArr:8656,uArr:8657,rArr:8658,dArr:8659,hArr:8660,forall:8704,part:8706,exist:8707,empty:8709,nabla:8711,isin:8712,notin:8713,ni:8715,prod:8719,sum:8721,minus:8722,lowast:8727,radic:8730,prop:8733,infin:8734,ang:8736,and:8743,or:8744,cap:8745,cup:8746,int:8747,there4:8756,sim:8764,cong:8773,asymp:8776,ne:8800,equiv:8801,le:8804,ge:8805,sub:8834,sup:8835,nsub:8836,sube:8838,supe:8839,oplus:8853,otimes:8855,perp:8869,sdot:8901,lceil:8968,rceil:8969,lfloor:8970,rfloor:8971,lang:9001,rang:9002,loz:9674,spades:9824,clubs:9827,hearts:9829,diams:9830},Object.keys(e.ENTITIES).forEach(function(o){var n=e.ENTITIES[o],l=typeof n=="number"?String.fromCharCode(n):n;e.ENTITIES[o]=l});for(var U in e.STATE)e.STATE[e.STATE[U]]=U;c=e.STATE;function F(o,n,l){o[n]&&o[n](l)}function M(o){var n=o&&o.match(/(?:^|\s)encoding\s*=\s*(['"])([^'"]+)\1/i);return n?n[2]:null}function Y(o){return o?o.toLowerCase().replace(/[^a-z0-9]/g,""):null}function ht(o,n){let l=Y(o),a=Y(n);return!l||!a?!0:a==="utf16"?l==="utf16le"||l==="utf16be":l===a}function vt(o,n){if(!(!o.strict||!o.encoding||!n||n.name!=="xml")){var l=M(n.body);l&&!ht(o.encoding,l)&&S(o,"XML declaration encoding "+l+" does not match detected stream encoding "+o.encoding.toUpperCase())}}function I(o,n,l){o.textNode&&se(o),F(o,n,l)}function se(o){o.textNode=Me(o.opt,o.textNode),o.textNode&&F(o,"ontext",o.textNode),o.textNode=""}function Me(o,n){return o.trim&&(n=n.trim()),o.normalize&&(n=n.replace(/\s+/g," ")),n}function ee(o,n){return se(o),o.trackPosition&&(n+=`
Line: `+o.line+`
Column: `+o.column+`
Char: `+o.c),n=new Error(n),o.error=n,F(o,"onerror",n),o}function Pe(o){return o.sawRoot&&!o.closedRoot&&S(o,"Unclosed root tag"),o.state!==c.BEGIN&&o.state!==c.BEGIN_WHITESPACE&&o.state!==c.TEXT&&ee(o,"Unexpected end"),se(o),o.c="",o.closed=!0,F(o,"onend"),i.call(o,o.strict,o.opt),o}function S(o,n){if(typeof o!="object"||!(o instanceof i))throw new Error("bad call to strictFail");o.strict&&ee(o,n)}function bt(o){o.strict||(o.tagName=o.tagName[o.looseCase]());var n=o.tags[o.tags.length-1]||o,l=o.tag={name:o.tagName,attributes:{}};o.opt.xmlns&&(l.ns=n.ns),o.attribList.length=0,I(o,"onopentagstart",l)}function xe(o,n){var l=o.indexOf(":"),a=l<0?["",o]:o.split(":"),C=a[0],$=a[1];return n&&o==="xmlns"&&(C="xmlns",$=""),{prefix:C,local:$}}function De(o){if(o.strict||(o.attribName=o.attribName[o.looseCase]()),o.attribList.indexOf(o.attribName)!==-1||o.tag.attributes.hasOwnProperty(o.attribName)){o.attribName=o.attribValue="";return}if(o.opt.xmlns){var n=xe(o.attribName,!0),l=n.prefix,a=n.local;if(l==="xmlns")if(a==="xml"&&o.attribValue!==A)S(o,"xml: prefix must be bound to "+A+`
Actual: `+o.attribValue);else if(a==="xmlns"&&o.attribValue!==h)S(o,"xmlns: prefix must be bound to "+h+`
Actual: `+o.attribValue);else{var C=o.tag,$=o.tags[o.tags.length-1]||o;C.ns===$.ns&&(C.ns=Object.create($.ns)),C.ns[a]=o.attribValue}o.attribList.push([o.attribName,o.attribValue])}else o.tag.attributes[o.attribName]=o.attribValue,I(o,"onattribute",{name:o.attribName,value:o.attribValue});o.attribName=o.attribValue=""}function te(o,n){if(o.opt.xmlns){var l=o.tag,a=xe(o.tagName);l.prefix=a.prefix,l.local=a.local,l.uri=l.ns[a.prefix]||"",l.prefix&&!l.uri&&(S(o,"Unbound namespace prefix: "+JSON.stringify(o.tagName)),l.uri=a.prefix);var C=o.tags[o.tags.length-1]||o;l.ns&&C.ns!==l.ns&&Object.keys(l.ns).forEach(function(Ue){I(o,"onopennamespace",{prefix:Ue,uri:l.ns[Ue]})});for(var $=0,L=o.attribList.length;$<L;$++){var W=o.attribList[$],H=W[0],j=W[1],P=xe(H,!0),X=P.prefix,Et=P.local,Fe=X===""?"":l.ns[X]||"",Ne={name:H,value:j,prefix:X,local:Et,uri:Fe};X&&X!=="xmlns"&&!Fe&&(S(o,"Unbound namespace prefix: "+JSON.stringify(X)),Ne.uri=X),o.tag.attributes[H]=Ne,I(o,"onattribute",Ne)}o.attribList.length=0}o.tag.isSelfClosing=!!n,o.sawRoot=!0,o.tags.push(o.tag),I(o,"onopentag",o.tag),n||(!o.noscript&&o.tagName.toLowerCase()==="script"?o.state=c.SCRIPT:o.state=c.TEXT,o.tag=null,o.tagName=""),o.attribName=o.attribValue="",o.attribList.length=0}function Ce(o){if(!o.tagName){S(o,"Weird empty close tag."),o.textNode+="</>",o.state=c.TEXT;return}if(o.script){if(o.tagName!=="script"){o.script+="</"+o.tagName+">",o.tagName="",o.state=c.SCRIPT;return}I(o,"onscript",o.script),o.script=""}var n=o.tags.length,l=o.tagName;o.strict||(l=l[o.looseCase]());for(var a=l;n--;){var C=o.tags[n];if(C.name!==a)S(o,"Unexpected close tag");else break}if(n<0){S(o,"Unmatched closing tag: "+o.tagName),o.textNode+="</"+o.tagName+">",o.state=c.TEXT;return}o.tagName=l;for(var $=o.tags.length;$-- >n;){var L=o.tag=o.tags.pop();o.tagName=o.tag.name,I(o,"onclosetag",o.tagName);var W={};for(var H in L.ns)W[H]=L.ns[H];var j=o.tags[o.tags.length-1]||o;o.opt.xmlns&&L.ns!==j.ns&&Object.keys(L.ns).forEach(function(P){var X=L.ns[P];I(o,"onclosenamespace",{prefix:P,uri:X})})}n===0&&(o.closedRoot=!0),o.tagName=o.attribValue=o.attribName="",o.attribList.length=0,o.state=c.TEXT}function Tt(o){var n=o.entity,l=n.toLowerCase(),a,C="";return o.ENTITIES[n]?o.ENTITIES[n]:o.ENTITIES[l]?o.ENTITIES[l]:(n=l,n.charAt(0)==="#"&&(n.charAt(1)==="x"?(n=n.slice(2),a=parseInt(n,16),C=a.toString(16)):(n=n.slice(1),a=parseInt(n,10),C=a.toString(10))),n=n.replace(/^0+/,""),isNaN(a)||C.toLowerCase()!==n||a<0||a>1114111?(S(o,"Invalid character entity"),"&"+o.entity+";"):String.fromCodePoint(a))}function Be(o,n){n==="<"?(o.state=c.OPEN_WAKA,o.startTagPosition=o.position):k(n)||(S(o,"Non-whitespace before first tag."),o.textNode=n,o.state=c.TEXT)}function Se(o,n){var l="";return n<o.length&&(l=o.charAt(n)),l}function yt(o){var n=this;if(this.error)throw this.error;if(n.closed)return ee(n,"Cannot write after close. Assign an onready handler.");if(o===null)return Pe(n);typeof o=="object"&&(o=o.toString());for(var l=0,a="";a=Se(o,l++),n.c=a,!!a;)switch(n.trackPosition&&(n.position++,a===`
`?(n.line++,n.column=0):n.column++),n.state){case c.BEGIN:if(n.state=c.BEGIN_WHITESPACE,a==="\uFEFF")continue;Be(n,a);continue;case c.BEGIN_WHITESPACE:Be(n,a);continue;case c.TEXT:if(n.sawRoot&&!n.closedRoot){for(var $=l-1;a&&a!=="<"&&a!=="&";)a=Se(o,l++),a&&n.trackPosition&&(n.position++,a===`
`?(n.line++,n.column=0):n.column++);n.textNode+=o.substring($,l-1)}a==="<"&&!(n.sawRoot&&n.closedRoot&&!n.strict)?(n.state=c.OPEN_WAKA,n.startTagPosition=n.position):(!k(a)&&(!n.sawRoot||n.closedRoot)&&S(n,"Text data outside of root node."),a==="&"?n.state=c.TEXT_ENTITY:n.textNode+=a);continue;case c.SCRIPT:a==="<"?n.state=c.SCRIPT_ENDING:n.script+=a;continue;case c.SCRIPT_ENDING:a==="/"?n.state=c.CLOSE_TAG:(n.script+="<"+a,n.state=c.SCRIPT);continue;case c.OPEN_WAKA:if(a==="!")n.state=c.SGML_DECL,n.sgmlDecl="";else if(!k(a))if(z(E,a))n.state=c.OPEN_TAG,n.tagName=a;else if(a==="/")n.state=c.CLOSE_TAG,n.tagName="";else if(a==="?")n.state=c.PROC_INST,n.procInstName=n.procInstBody="";else{if(S(n,"Unencoded <"),n.startTagPosition+1<n.position){var C=n.position-n.startTagPosition;a=new Array(C).join(" ")+a}n.textNode+="<"+a,n.state=c.TEXT}continue;case c.SGML_DECL:if(n.sgmlDecl+a==="--"){n.state=c.COMMENT,n.comment="",n.sgmlDecl="";continue}n.doctype&&n.doctype!==!0&&n.sgmlDecl?(n.state=c.DOCTYPE_DTD,n.doctype+="<!"+n.sgmlDecl+a,n.sgmlDecl=""):(n.sgmlDecl+a).toUpperCase()===w?(I(n,"onopencdata"),n.state=c.CDATA,n.sgmlDecl="",n.cdata=""):(n.sgmlDecl+a).toUpperCase()===b?(n.state=c.DOCTYPE,(n.doctype||n.sawRoot)&&S(n,"Inappropriately located doctype declaration"),n.doctype="",n.sgmlDecl=""):a===">"?(I(n,"onsgmldeclaration",n.sgmlDecl),n.sgmlDecl="",n.state=c.TEXT):(V(a)&&(n.state=c.SGML_DECL_QUOTED),n.sgmlDecl+=a);continue;case c.SGML_DECL_QUOTED:a===n.q&&(n.state=c.SGML_DECL,n.q=""),n.sgmlDecl+=a;continue;case c.DOCTYPE:a===">"?(n.state=c.TEXT,I(n,"ondoctype",n.doctype),n.doctype=!0):(n.doctype+=a,a==="["?n.state=c.DOCTYPE_DTD:V(a)&&(n.state=c.DOCTYPE_QUOTED,n.q=a));continue;case c.DOCTYPE_QUOTED:n.doctype+=a,a===n.q&&(n.q="",n.state=c.DOCTYPE);continue;case c.DOCTYPE_DTD:a==="]"?(n.doctype+=a,n.state=c.DOCTYPE):a==="<"?(n.state=c.OPEN_WAKA,n.startTagPosition=n.position):V(a)?(n.doctype+=a,n.state=c.DOCTYPE_DTD_QUOTED,n.q=a):n.doctype+=a;continue;case c.DOCTYPE_DTD_QUOTED:n.doctype+=a,a===n.q&&(n.state=c.DOCTYPE_DTD,n.q="");continue;case c.COMMENT:a==="-"?n.state=c.COMMENT_ENDING:n.comment+=a;continue;case c.COMMENT_ENDING:a==="-"?(n.state=c.COMMENT_ENDED,n.comment=Me(n.opt,n.comment),n.comment&&I(n,"oncomment",n.comment),n.comment=""):(n.comment+="-"+a,n.state=c.COMMENT);continue;case c.COMMENT_ENDED:a!==">"?(S(n,"Malformed comment"),n.comment+="--"+a,n.state=c.COMMENT):n.doctype&&n.doctype!==!0?n.state=c.DOCTYPE_DTD:n.state=c.TEXT;continue;case c.CDATA:for(var $=l-1;a&&a!=="]";)a=Se(o,l++),a&&n.trackPosition&&(n.position++,a===`
`?(n.line++,n.column=0):n.column++);n.cdata+=o.substring($,l-1),a==="]"&&(n.state=c.CDATA_ENDING);continue;case c.CDATA_ENDING:a==="]"?n.state=c.CDATA_ENDING_2:(n.cdata+="]"+a,n.state=c.CDATA);continue;case c.CDATA_ENDING_2:a===">"?(n.cdata&&I(n,"oncdata",n.cdata),I(n,"onclosecdata"),n.cdata="",n.state=c.TEXT):a==="]"?n.cdata+="]":(n.cdata+="]]"+a,n.state=c.CDATA);continue;case c.PROC_INST:a==="?"?n.state=c.PROC_INST_ENDING:k(a)?n.state=c.PROC_INST_BODY:n.procInstName+=a;continue;case c.PROC_INST_BODY:if(!n.procInstBody&&k(a))continue;a==="?"?n.state=c.PROC_INST_ENDING:n.procInstBody+=a;continue;case c.PROC_INST_ENDING:if(a===">"){let j={name:n.procInstName,body:n.procInstBody};vt(n,j),I(n,"onprocessinginstruction",j),n.procInstName=n.procInstBody="",n.state=c.TEXT}else n.procInstBody+="?"+a,n.state=c.PROC_INST_BODY;continue;case c.OPEN_TAG:z(x,a)?n.tagName+=a:(bt(n),a===">"?te(n):a==="/"?n.state=c.OPEN_TAG_SLASH:(k(a)||S(n,"Invalid character in tag name"),n.state=c.ATTRIB));continue;case c.OPEN_TAG_SLASH:a===">"?(te(n,!0),Ce(n)):(S(n,"Forward-slash in opening tag not followed by >"),n.state=c.ATTRIB);continue;case c.ATTRIB:if(k(a))continue;a===">"?te(n):a==="/"?n.state=c.OPEN_TAG_SLASH:z(E,a)?(n.attribName=a,n.attribValue="",n.state=c.ATTRIB_NAME):S(n,"Invalid attribute name");continue;case c.ATTRIB_NAME:a==="="?n.state=c.ATTRIB_VALUE:a===">"?(S(n,"Attribute without value"),n.attribValue=n.attribName,De(n),te(n)):k(a)?n.state=c.ATTRIB_NAME_SAW_WHITE:z(x,a)?n.attribName+=a:S(n,"Invalid attribute name");continue;case c.ATTRIB_NAME_SAW_WHITE:if(a==="=")n.state=c.ATTRIB_VALUE;else{if(k(a))continue;S(n,"Attribute without value"),n.tag.attributes[n.attribName]="",n.attribValue="",I(n,"onattribute",{name:n.attribName,value:""}),n.attribName="",a===">"?te(n):z(E,a)?(n.attribName=a,n.state=c.ATTRIB_NAME):(S(n,"Invalid attribute name"),n.state=c.ATTRIB)}continue;case c.ATTRIB_VALUE:if(k(a))continue;V(a)?(n.q=a,n.state=c.ATTRIB_VALUE_QUOTED):(n.opt.unquotedAttributeValues||ee(n,"Unquoted attribute value"),n.state=c.ATTRIB_VALUE_UNQUOTED,n.attribValue=a);continue;case c.ATTRIB_VALUE_QUOTED:if(a!==n.q){a==="&"?n.state=c.ATTRIB_VALUE_ENTITY_Q:n.attribValue+=a;continue}De(n),n.q="",n.state=c.ATTRIB_VALUE_CLOSED;continue;case c.ATTRIB_VALUE_CLOSED:k(a)?n.state=c.ATTRIB:a===">"?te(n):a==="/"?n.state=c.OPEN_TAG_SLASH:z(E,a)?(S(n,"No whitespace between attributes"),n.attribName=a,n.attribValue="",n.state=c.ATTRIB_NAME):S(n,"Invalid attribute name");continue;case c.ATTRIB_VALUE_UNQUOTED:if(!J(a)){a==="&"?n.state=c.ATTRIB_VALUE_ENTITY_U:n.attribValue+=a;continue}De(n),a===">"?te(n):n.state=c.ATTRIB;continue;case c.CLOSE_TAG:if(n.tagName)a===">"?Ce(n):z(x,a)?n.tagName+=a:n.script?(n.script+="</"+n.tagName+a,n.tagName="",n.state=c.SCRIPT):(k(a)||S(n,"Invalid tagname in closing tag"),n.state=c.CLOSE_TAG_SAW_WHITE);else{if(k(a))continue;Z(E,a)?n.script?(n.script+="</"+a,n.state=c.SCRIPT):S(n,"Invalid tagname in closing tag."):n.tagName=a}continue;case c.CLOSE_TAG_SAW_WHITE:if(k(a))continue;a===">"?Ce(n):S(n,"Invalid characters in closing tag");continue;case c.TEXT_ENTITY:case c.ATTRIB_VALUE_ENTITY_Q:case c.ATTRIB_VALUE_ENTITY_U:var L,W;switch(n.state){case c.TEXT_ENTITY:L=c.TEXT,W="textNode";break;case c.ATTRIB_VALUE_ENTITY_Q:L=c.ATTRIB_VALUE_QUOTED,W="attribValue";break;case c.ATTRIB_VALUE_ENTITY_U:L=c.ATTRIB_VALUE_UNQUOTED,W="attribValue";break}if(a===";"){var H=Tt(n);n.opt.unparsedEntities&&!Object.values(e.XML_ENTITIES).includes(H)?((n.entityCount+=1)>n.opt.maxEntityCount&&ee(n,"Parsed entity count exceeds max entity count"),(n.entityDepth+=1)>n.opt.maxEntityDepth&&ee(n,"Parsed entity depth exceeds max entity depth"),n.entity="",n.state=L,n.write(H),n.entityDepth-=1):(n[W]+=H,n.entity="",n.state=L)}else z(n.entity.length?Q:D,a)?n.entity+=a:(S(n,"Invalid character in entity name"),n[W]+="&"+n.entity+a,n.entity="",n.state=L);continue;default:throw new Error(n,"Unknown state: "+n.state)}return n.position>=n.bufferCheckPosition&&r(n),n}String.fromCodePoint||function(){var o=String.fromCharCode,n=Math.floor,l=function(){var a=16384,C=[],$,L,W=-1,H=arguments.length;if(!H)return"";for(var j="";++W<H;){var P=Number(arguments[W]);if(!isFinite(P)||P<0||P>1114111||n(P)!==P)throw RangeError("Invalid code point: "+P);P<=65535?C.push(P):(P-=65536,$=(P>>10)+55296,L=P%1024+56320,C.push($,L)),(W+1===H||C.length>a)&&(j+=o.apply(null,C),C.length=0)}return j};Object.defineProperty?Object.defineProperty(String,"fromCodePoint",{value:l,configurable:!0,writable:!0}):String.fromCodePoint=l}()})(typeof ge>"u"?ge.sax={}:ge)});var ln={};At(ln,{activate:()=>an});module.exports=_t(ln);var v=me(require("vscode")),gt=require("child_process"),re=require("fs"),ue=require("path");var T=me(require("vscode"));var Ge=me(We());var He={topic:"topic/topic",title:"topic/title",shortdesc:"topic/shortdesc",body:"topic/body",section:"topic/section",example:"topic/example",p:"topic/p",note:"topic/note",ul:"topic/ul",ol:"topic/ol",li:"topic/li",sl:"topic/sl",sli:"topic/sli",dl:"topic/dl",dlentry:"topic/dlentry",dt:"topic/dt",dd:"topic/dd",table:"topic/table",tgroup:"topic/tgroup",colspec:"topic/colspec",thead:"topic/thead",tbody:"topic/tbody",row:"topic/row",entry:"topic/entry",simpletable:"topic/simpletable",sthead:"topic/sthead",strow:"topic/strow",stentry:"topic/stentry",image:"topic/image",fig:"topic/fig",codeblock:"topic/codeblock",pre:"topic/pre",xref:"topic/xref",link:"topic/link",linktext:"topic/linktext",relatedLinks:"topic/related-links",b:"topic/b",i:"topic/i",u:"topic/u",tt:"topic/tt",sup:"topic/sup",sub:"topic/sub",q:"topic/q",lq:"topic/lq",keyword:"topic/keyword",term:"topic/term",uicontrol:"topic/uicontrol",wintitle:"topic/wintitle",menucascade:"topic/menucascade",filepath:"topic/filepath",userinput:"topic/userinput",systemoutput:"topic/systemoutput",apiname:"topic/apiname",option:"topic/option",parmname:"topic/parmname",cmdname:"topic/cmdname",varname:"topic/varname",msgnum:"topic/msgnum",ph:"topic/ph",draftComment:"topic/draft-comment",requiredCleanup:"topic/required-cleanup",data:"topic/data",dataAbout:"topic/data-about",foreign:"topic/foreign",state:"topic/state",codeph:"topic/codeph",coderef:"topic/coderef",synph:"topic/synph",kwd:"topic/kwd",var:"topic/var",oper:"topic/oper",sep:"topic/sep",delim:"topic/delim",fragment:"topic/fragment",fragref:"topic/fragref",synblk:"topic/synblk",synnote:"topic/synnote",synnoteref:"topic/synnoteref",syntaxdiagram:"topic/syntaxdiagram",screen:"topic/screen",msgph:"topic/msgph",msgblock:"topic/msgblock",lines:"topic/lines",fn:"topic/fn",cite:"topic/cite",boolean:"topic/boolean",tm:"topic/tm",indexterm:"topic/indexterm",indextermref:"topic/indextermref","index-see":"topic/index-see","index-see-also":"topic/index-see-also","index-sort-as":"topic/index-sort-as","index-base":"topic/index-base",div:"topic/div",sectiondiv:"topic/sectiondiv",bodydiv:"topic/bodydiv",desc:"topic/desc",alt:"topic/alt",parml:"topic/parml",plentry:"topic/plentry",pt:"topic/pt",pd:"topic/pd","abbreviated-form":"topic/abbreviated-form",glossterm:"topic/glossterm",glossdef:"topic/glossdef",glossentry:"topic/glossentry",glossref:"topic/glossref",glossgroup:"topic/glossgroup",hazardstatement:"topic/hazardstatement",typeofhazard:"topic/typeofhazard",hazardsymbol:"topic/hazardsymbol",howtoavoid:"topic/howtoavoid",consequence:"topic/consequence",object:"topic/object",param:"topic/param",anchor:"topic/anchor",anchorid:"topic/anchorid",anchorkey:"topic/anchorkey",anchorref:"topic/anchorref"};var ze={map:"map/map",title:"map/map-title",topicmeta:"map/topicmeta",navtitle:"map/navtitle",linktext:"map/linktext",shortdesc:"map/shortdesc",keywords:"map/keywords",keyword:"map/keyword",topicref:"map/topicref",topichead:"map/topichead",topicgroup:"map/topicgroup",keydef:"map/keydef",reltable:"map/reltable",relheader:"map/relheader",relrow:"map/relrow",relcell:"map/relcell",relcolspec:"map/relcolspec",anchor:"map/anchor",navref:"map/navref",mapref:"map/mapref"};var kt=/^(topic|map)\//;function $t(e){return function(i,r){let s=e[i];if(s)return s;if(r){let d=r.trim().split(/\s+/);for(let p of d)if(kt.test(p))return p}}}function Rt(){return{startLine:0,startCol:0,endLine:0,endCol:0}}function qe(e){let t=$t(e);return function(r){let s=Ge.default.parser(!0,{trim:!1,normalize:!1}),d={type:"element",children:[],sourceRange:Rt()},p=[d],u="",m=0,f=0;function g(){if(u.length>0){let b=p[p.length-1];b&&b.children.push({type:"text",text:u,children:[],sourceRange:{startLine:m,startCol:f,endLine:s.line,endCol:s.column}}),u=""}}s.onopentag=b=>{g();let A=b.name,h=b.attributes.class,y=t(A,h),E=h?h.trim().split(/\s+/).filter(Boolean):void 0,x={type:"element",tagName:A,classTokens:E,baseType:y,attributes:b.attributes,children:[],sourceRange:{startLine:s.line,startCol:s.column,endLine:0,endCol:0}},D=p[p.length-1];D&&D.children.push(x),p.push(x)},s.onclosetag=()=>{g();let b=p.pop();b&&(b.sourceRange.endLine=s.line,b.sourceRange.endCol=s.column)},s.ontext=b=>{u.length===0&&(m=s.line,f=s.column),u+=b},s.onerror=b=>{throw new Error(`SAX parse error at line ${s.line}:${s.column}: ${b.message}`)},s.write(r).close();let w=d.children.find(b=>b.type==="element");if(!w)throw new Error("No root element found in DITA document");return{root:w,sourceRange:w.sourceRange}}}function K(e){let t=/<!ENTITY\s+(\S+)\s+"((?:[^"\\]|\\.)*)">/g,i,r=[];for(;(i=t.exec(e))!==null;)r.push([i[1],i[2]]);if(r.length===0)return e;let s=e.replace(t,"");for(let[d,p]of r)s=s.replace(new RegExp(`&${d};`,"g"),p);return s}var It=qe(He),Lt=qe(ze);function ae(e){return It(e)}function ce(e){return Lt(e)}function Ye(e){return e.parentBaseType==="topic/thead"}function _(e,t){return e.attributes?.[t]}function R(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function q(e,t){return t==null?"":` ${e}="${R(t)}"`}var je={"topic/topic":(e,t,i)=>{let r=_(e,"id");return`<article${q("id",r)} class="topic">${i(e,t)}</article>`},"topic/title":(e,t,i)=>{let r=Math.min(t.headingLevel,6);return`<h${r}>${i(e,t)}</h${r}>`},"topic/shortdesc":(e,t,i)=>`<p class="shortdesc">${i(e,t)}</p>`,"topic/body":(e,t,i)=>`<main class="body">${i(e,t)}</main>`,"topic/section":(e,t,i)=>{let r=_(e,"id");return`<section${q("id",r)}>${i(e,t)}</section>`},"topic/example":(e,t,i)=>{let r=_(e,"id");return`<section${q("id",r)} class="example">${i(e,t)}</section>`},"topic/p":(e,t,i)=>`<p>${i(e,t)}</p>`,"topic/note":(e,t,i)=>{let r=_(e,"type")||"note",d=(t.noteLabels||{note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"})[r]||r;return`<div class="note note--${R(r)}"><span class="note__label">${R(d)}:</span> ${i(e,t)}</div>`},"topic/ul":(e,t,i)=>`<ul>${i(e,t)}</ul>`,"topic/ol":(e,t,i)=>`<ol>${i(e,t)}</ol>`,"topic/li":(e,t,i)=>`<li>${i(e,t)}</li>`,"topic/sl":(e,t,i)=>`<ul class="simple-list">${i(e,t)}</ul>`,"topic/sli":(e,t,i)=>`<li>${i(e,t)}</li>`,"topic/dl":(e,t,i)=>`<dl>${i(e,t)}</dl>`,"topic/dlentry":(e,t,i)=>`<div class="dlentry">${i(e,t)}</div>`,"topic/dt":(e,t,i)=>`<dt>${i(e,t)}</dt>`,"topic/dd":(e,t,i)=>`<dd>${i(e,t)}</dd>`,"topic/table":(e,t,i)=>{let r=_(e,"id");return`<table${q("id",r)} class="cals-table">${i(e,t)}</table>`},"topic/tgroup":(e,t,i)=>i(e,t),"topic/colspec":()=>"","topic/thead":(e,t,i)=>`<thead>${i(e,t)}</thead>`,"topic/tbody":(e,t,i)=>`<tbody>${i(e,t)}</tbody>`,"topic/row":(e,t,i)=>`<tr>${i(e,t)}</tr>`,"topic/entry":(e,t,i)=>{let r=Ye(t)?"th":"td";return`<${r}>${i(e,t)}</${r}>`},"topic/simpletable":(e,t,i)=>{let r=_(e,"id");return`<table${q("id",r)} class="simple-table">${i(e,t)}</table>`},"topic/sthead":(e,t,i)=>`<thead>${i(e,t)}</thead>`,"topic/strow":(e,t,i)=>`<tr>${i(e,t)}</tr>`,"topic/stentry":(e,t,i)=>{let r=Ye(t)?"th":"td";return`<${r}>${i(e,t)}</${r}>`},"topic/image":(e,t)=>{let i=_(e,"href")||"",r=_(e,"alt")||"",s=_(e,"placement")||"inline",d=_(e,"width"),p=_(e,"height"),u=`${q("width",d)}${q("height",p)}`,m=i?t.asWebviewUri(i):"",f=s==="break"?' class="image-break"':"";return`<img src="${m||""}"${q("alt",r)}${u}${f} loading="lazy" data-dita-src="${R(i)}">`},"topic/fig":(e,t,i)=>{let r=_(e,"id"),s=(e.children||[]).find(m=>m.type==="element"&&m.baseType==="topic/title"),d=(e.children||[]).filter(m=>!(m.type==="element"&&m.baseType==="topic/title")),p=i({...e,children:d},t),u=s?`<figcaption>${i(s,{...t,headingLevel:t.headingLevel+1})}</figcaption>`:"";return`<figure${q("id",r)}>${p}${u}</figure>`},"topic/codeblock":(e,t,i)=>{let r=_(e,"outputclass")||"",s=r.replace(/^language-/,""),d=s?`<div class="codeblock-lang">${R(s)}</div>`:"";return`<pre class="codeblock ${R(r)}"><code>${i(e,t)}</code>${d}</pre>`},"topic/pre":(e,t,i)=>`<pre class="preformatted">${i(e,t)}</pre>`,"topic/xref":(e,t,i)=>{let r=_(e,"href")||"";if(!r)return"";let s;if(e.children.length>0)s=i(e,t);else if(r.startsWith("#")){let d=r.includes("/")?r.split("/").pop():r.slice(1);s=R(t.resolveTitle?.(d)??"")||R(r)}else r.includes("#")?s=R(t.resolveTitle?.(r)??"")||R(r):s=R(r);if(r.startsWith("#")){let d=r.includes("/")?"#"+r.split("/").pop():r;return`<a href="${R(d)}" class="xref">${s}</a>`}return`<span class="xref-external">\u2192 ${s}</span>`},"topic/link":(e,t,i)=>{let r=_(e,"href"),s=_(e,"keyref"),d=r||s||"";return d?`<a href="${R(d)}" class="link">${i(e,t)}</a>`:i(e,t)},"topic/linktext":(e,t,i)=>i(e,t),"topic/related-links":(e,t,i)=>`<aside class="related-links"><h2>Related links</h2>${i(e,t)}</aside>`,"topic/b":(e,t,i)=>`<strong>${i(e,t)}</strong>`,"topic/i":(e,t,i)=>`<em>${i(e,t)}</em>`,"topic/u":(e,t,i)=>`<u>${i(e,t)}</u>`,"topic/tt":(e,t,i)=>`<code>${i(e,t)}</code>`,"topic/sup":(e,t,i)=>`<sup>${i(e,t)}</sup>`,"topic/sub":(e,t,i)=>`<sub>${i(e,t)}</sub>`,"topic/q":(e,t,i)=>`<q>${i(e,t)}</q>`,"topic/lq":(e,t,i)=>`<blockquote>${i(e,t)}</blockquote>`,"topic/keyword":(e,t,i)=>`<span class="keyword">${i(e,t)}</span>`,"topic/term":(e,t,i)=>`<span class="term">${i(e,t)}</span>`,"topic/ph":(e,t,i)=>{let r=_(e,"keyref");if(r&&t.resolveKey){let s=t.resolveKey(r);return s?`<span class="ph">${R(s)}</span>`:`<span class="ph unresolved-keyref" title="Unresolved key: ${R(r)}">[${R(r)}]</span>`}return`<span class="ph">${i(e,t)}</span>`},"topic/uicontrol":(e,t,i)=>`<span class="uicontrol">${i(e,t)}</span>`,"topic/wintitle":(e,t,i)=>`<span class="wintitle">${i(e,t)}</span>`,"topic/menucascade":(e,t,i)=>`<span class="menucascade">${i(e,t)}</span>`,"topic/filepath":(e,t,i)=>`<span class="filepath">${i(e,t)}</span>`,"topic/userinput":(e,t,i)=>`<span class="userinput">${i(e,t)}</span>`,"topic/systemoutput":(e,t,i)=>`<span class="systemoutput">${i(e,t)}</span>`,"topic/apiname":(e,t,i)=>`<span class="apiname">${i(e,t)}</span>`,"topic/option":(e,t,i)=>`<span class="option">${i(e,t)}</span>`,"topic/parmname":(e,t,i)=>`<span class="parmname">${i(e,t)}</span>`,"topic/cmdname":(e,t,i)=>`<span class="cmdname">${i(e,t)}</span>`,"topic/varname":(e,t,i)=>`<span class="varname">${i(e,t)}</span>`,"topic/msgnum":(e,t,i)=>`<span class="msgnum">${i(e,t)}</span>`,"topic/codeph":(e,t,i)=>`<code class="codeph">${i(e,t)}</code>`,"topic/coderef":(e,t,i)=>`<span class="coderef">${i(e,t)}</span>`,"topic/synph":(e,t,i)=>`<span class="synph">${i(e,t)}</span>`,"topic/kwd":(e,t,i)=>`<span class="kwd">${i(e,t)}</span>`,"topic/var":(e,t,i)=>`<span class="var">${i(e,t)}</span>`,"topic/oper":(e,t,i)=>`<span class="oper">${i(e,t)}</span>`,"topic/sep":(e,t,i)=>`<span class="sep">${i(e,t)}</span>`,"topic/delim":(e,t,i)=>`<span class="delim">${i(e,t)}</span>`,"topic/fragment":(e,t,i)=>`<span class="fragment">${i(e,t)}</span>`,"topic/fragref":(e,t,i)=>`<span class="fragref">${i(e,t)}</span>`,"topic/synblk":(e,t,i)=>`<pre class="synblk">${i(e,t)}</pre>`,"topic/synnote":(e,t,i)=>`<div class="synnote">${i(e,t)}</div>`,"topic/synnoteref":(e,t,i)=>`<span class="synnoteref">${i(e,t)}</span>`,"topic/syntaxdiagram":(e,t,i)=>`<div class="syntaxdiagram">${i(e,t)}</div>`,"topic/screen":(e,t,i)=>`<pre class="screen">${i(e,t)}</pre>`,"topic/msgph":(e,t,i)=>`<span class="msgph">${i(e,t)}</span>`,"topic/msgblock":(e,t,i)=>`<pre class="msgblock">${i(e,t)}</pre>`,"topic/lines":(e,t,i)=>`<pre class="lines">${i(e,t)}</pre>`,"topic/fn":(e,t,i)=>{let r=_(e,"id");return`<sup class="fn${r?` fn-call-${R(r)}`:""}">${i(e,t)}</sup>`},"topic/cite":(e,t,i)=>`<cite>${i(e,t)}</cite>`,"topic/boolean":(e,t,i)=>{let r=_(e,"value")||"";return`<span class="boolean" data-value="${R(r)}">${R(r)||i(e,t)}</span>`},"topic/tm":(e,t,i)=>`<span class="tm">${i(e,t)}</span>`,"topic/indexterm":()=>"","topic/indextermref":()=>"","topic/index-see":()=>"","topic/index-see-also":()=>"","topic/index-sort-as":()=>"","topic/index-base":()=>"","topic/div":(e,t,i)=>`<div class="body-div">${i(e,t)}</div>`,"topic/sectiondiv":(e,t,i)=>`<div class="section-div">${i(e,t)}</div>`,"topic/bodydiv":(e,t,i)=>`<div class="body-div">${i(e,t)}</div>`,"topic/desc":(e,t,i)=>`<span class="desc">${i(e,t)}</span>`,"topic/alt":(e,t,i)=>`<span class="alt">${i(e,t)}</span>`,"topic/parml":(e,t,i)=>`<dl class="parml">${i(e,t)}</dl>`,"topic/plentry":(e,t,i)=>`<div class="plentry">${i(e,t)}</div>`,"topic/pt":(e,t,i)=>`<dt class="pt">${i(e,t)}</dt>`,"topic/pd":(e,t,i)=>`<dd class="pd">${i(e,t)}</dd>`,"topic/abbreviated-form":(e,t,i)=>{let r=_(e,"keyref");return r&&t.resolveKey?`<abbr class="abbreviated-form" title="${R(r)}">${R(t.resolveKey(r)||r)}</abbr>`:`<abbr class="abbreviated-form">${i(e,t)}</abbr>`},"topic/glossterm":(e,t,i)=>`<dfn class="glossterm">${i(e,t)}</dfn>`,"topic/glossdef":(e,t,i)=>`<dd class="glossdef">${i(e,t)}</dd>`,"topic/glossentry":(e,t,i)=>`<dl class="glossentry">${i(e,t)}</dl>`,"topic/glossref":(e,t,i)=>`<span class="glossref">${i(e,t)}</span>`,"topic/glossgroup":(e,t,i)=>`<div class="glossgroup">${i(e,t)}</div>`,"topic/hazardstatement":(e,t,i)=>`<div class="hazardstatement">${i(e,t)}</div>`,"topic/typeofhazard":(e,t,i)=>`<span class="typeofhazard">${i(e,t)}</span>`,"topic/hazardsymbol":()=>"","topic/howtoavoid":(e,t,i)=>`<p class="howtoavoid">${i(e,t)}</p>`,"topic/consequence":(e,t,i)=>`<p class="consequence">${i(e,t)}</p>`,"topic/object":(e,t,i)=>`<object class="dita-object">${i(e,t)}</object>`,"topic/param":()=>"","topic/anchor":e=>{let t=_(e,"id");return t?`<a${q("id",t)}></a>`:""},"topic/anchorid":e=>{let t=_(e,"id");return t?`<span${q("id",t)}></span>`:""},"topic/anchorkey":()=>"","topic/anchorref":()=>""};var Ot=new Set(["topic/section","topic/example","topic/fig","topic/related-links"]),Mt=new Set(["topic/tgroup","topic/link","topic/linktext"]);function Pt(e){return Ot.has(e)}function Bt(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function Ft(e,t,i){return e.replace(/^<([a-zA-Z][a-zA-Z0-9]*)/,`<$1 title="${t}" data-line="${i}"`)}function Ut(e,t){return{type:"text",text:e,children:[],sourceRange:t}}function Vt(e,t){let i=e.attributes?.conref;if(!i||!t.resolveConref)return e;let r=t.resolveConref(i);if(!r)return e;let{conref:s,...d}=e.attributes||{};return{...e,children:[Ut(r,e.sourceRange)],attributes:d}}function Ke(e,t){if(e.type==="text")return Bt(e.text||"");let i=Vt(e,t),r=i.baseType,s=r?je[r]:void 0,p=(r?Pt(r):!1)?t.headingLevel+1:t.headingLevel,u={...t,headingLevel:p,parentBaseType:r};if(s){let m=s(i,u,Xe);if(r&&!Mt.has(r)){let f=i.tagName||r.split("/").pop()||r;m=Ft(m,f,i.sourceRange.startLine)}return m}return Xe(i,u)}function Xe(e,t){return(e.children||[]).map(i=>Ke(i,t)).join("")}function he(e,t){return Ke(e,t)}var O=require("fs"),N=require("path"),it=require("crypto");var ie=require("fs"),ve=require("path");function be(e){return e.type==="text"?e.text||"":(e.children||[]).map(be).join("")}function Ae(e){let t=new Map;function i(r){if(r.type==="element"){let s=r.attributes?.id;if(s){let d=(r.children||[]).find(p=>p.type==="element"&&p.baseType==="topic/title");d&&t.set(s,be(d))}for(let d of r.children||[])i(d)}}return i(e),t}function Qe(e){let t=new Map;function i(d){let p=(0,ve.resolve)(e,d);if(t.has(p))return t.get(p);if(!(0,ie.existsSync)(p)){t.set(p,void 0);return}try{let u=(0,ie.readFileSync)(p,"utf-8"),m=ae(K(u));return t.set(p,m.root),m.root}catch{t.set(p,void 0);return}}function r(d,p){if(d.attributes?.id===p)return d;for(let u of d.children||[]){let m=r(u,p);if(m)return m}}function s(d,p){let u=r(d,p);if(!u)return;let m=(u.children||[]).find(f=>f.type==="element"&&f.baseType==="topic/title");if(m)return be(m)}return{loadFile:i,findElementById:r,findTitleOfElement:s}}function _e(e){let t=Qe(e);function i(r){let s="";for(let d of r.children||[])d.type==="text"?s+=d.text||"":s+=i(d);return s}return r=>{let s=r.indexOf("#");if(s<0)return;let d=r.substring(0,s),u=r.substring(s+1).split("/"),m=u.length>1?u[1]:u[0],f=t.loadFile(d);if(!f)return;let g=t.findElementById(f,m);if(g)return i(g)}}function ke(e){let t=Qe(e);return i=>{let r=i.indexOf("#");if(r<0)return;let s=i.substring(0,r),p=i.substring(r+1).split("/")[0],u=t.loadFile(s);if(u)return t.findTitleOfElement(u,p)}}var Wt={note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"},Ht={note:"\u6CE8",notice:"\u6CE8\u610F",warning:"\u8B66\u544A",danger:"\u5371\u9669",important:"\u91CD\u8981",tip:"\u63D0\u793A",restriction:"\u9650\u5236"};function zt(e){return(e.attributes?.["xml:lang"]||"").startsWith("zh")?Ht:Wt}function le(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function Gt(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Ze(e,t){let i=Math.min(1+t,6);return`<div class="book-entry book-entry--placeholder">
  <h${i} class="book-section-heading">${Gt(e)}</h${i}>
</div>`}function Je(e,t,i){let r=Math.min(1+i,6);return`<div class="book-entry book-entry--error">
  <h${r} class="book-entry-title">${le(e)}</h${r}>
  <p class="book-error">${le(t)}</p>
</div>`}function et(e){return`<p class="book-skip">(Skipped: ${le(e)} already included above)</p>`}function tt(e){let{filePath:t,keyMap:i,asWebviewUri:r,headingLevel:s}=e;try{if(!(0,ie.existsSync)(t))return{html:"",error:`File not found: ${t}`};let d=(0,ie.readFileSync)(t,"utf-8"),p=K(d),u=ae(p),m=Ae(u.root),f=zt(u.root),g=(0,ve.dirname)(t),w=_e(g),b=ke(g),A=x=>{let D=m.get(x);if(D)return D;if(x.includes("#"))return b(x)},h=he(u.root,{headingLevel:s,asWebviewUri:r,documentDir:g,resolveTitle:A,resolveKey:x=>i.get(x),resolveConref:x=>w(x),noteLabels:f}),y=(u.root.children||[]).find(x=>x.type==="element"&&x.baseType==="topic/title"),E=y?be(y):void 0;return{html:h,title:E}}catch(d){let p=d instanceof Error?d.message:String(d);return{html:"",error:`Error rendering ${t}: ${p}`}}}function qt(){return`
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

  // Font toggle (serif / sans-serif)
  var isSerif = false;
  var fontBtn = document.createElement('button');
  fontBtn.textContent = 'Sans';
  fontBtn.title = 'Current: Sans-serif. Click to switch to Serif';
  fontBtn.style.cssText = btnStyle + 'font-size:11px;';
  fontBtn.addEventListener('click', function() {
    isSerif = !isSerif;
    fontBtn.textContent = isSerif ? 'Serif' : 'Sans';
    fontBtn.title = isSerif ? 'Current: Serif. Click to switch to Sans-serif' : 'Current: Sans-serif. Click to switch to Serif';
    document.body.style.fontFamily = isSerif ? "Georgia,'Times New Roman','Noto Serif SC','Songti SC',STSong,SimSun,serif" : '';
  });
  toolbar.appendChild(fontBtn);

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
`}var Te=class{constructor(t){this.context=t}async resolveCustomTextEditor(t,i,r){let s=T.Uri.file((0,N.dirname)(t.uri.fsPath));i.webview.options={enableScripts:!0,localResourceRoots:[T.Uri.file(this.context.extensionPath),s,...(T.workspace.workspaceFolders||[]).map(h=>h.uri)]};let d=()=>T.window.visibleTextEditors.find(h=>h.document.uri.toString()===t.uri.toString()),p=h=>{i.webview.postMessage({type:"revealLine",line:h})},u=0;i.webview.onDidReceiveMessage(h=>{if(h.type==="refresh")A(),setTimeout(f,200);else if(h.type==="scrollSync"){let y=d();if(y){let E=y.visibleRanges[0]?.start.line;if(E!==void 0&&Math.abs(h.line-E)>=2){u=Date.now()+250;let D=Math.max(0,Math.min(h.line,t.lineCount-1));y.revealRange(new T.Range(D,0,D,0),T.TextEditorRevealType.AtTop),y.selection=new T.Selection(new T.Position(D,0),new T.Position(D,0))}}}else if(h.type==="navigateToLine"){let y=d();if(y){let E=Math.max(0,Math.min(h.line,t.lineCount-1));y.visibleRanges.some(D=>E>=D.start.line&&E<=D.end.line)||y.revealRange(new T.Range(E,0,E,0),T.TextEditorRevealType.AtTop),y.selection=new T.Selection(new T.Position(E,0),new T.Position(E,0))}}});let m=T.window.onDidChangeTextEditorSelection(h=>{if(h.textEditor.document.uri.toString()!==t.uri.toString()||Date.now()<u)return;let y=h.selections[0];!y||y.start.line!==y.end.line||i.webview.postMessage({type:"highlightLine",line:y.start.line})}),f=()=>{let h=d();if(h){let y=h.visibleRanges[0]?.start.line;y!==void 0&&p(y)}},g=T.window.onDidChangeTextEditorVisibleRanges(h=>{if(h.textEditor.document.uri.toString()===t.uri.toString()){if(Date.now()<u)return;let y=h.textEditor.visibleRanges[0]?.start.line;y!==void 0&&p(y)}}),w=T.workspace.onDidChangeTextDocument(h=>{h.document.uri.toString()===t.uri.toString()&&(A(),setTimeout(f,200))}),b=T.window.onDidChangeActiveColorTheme(()=>{A()}),A=()=>{let h=this.generateHtml(t,i.webview);i.webview.html=h};A(),setTimeout(f,300),i.onDidDispose(()=>{w.dispose(),g.dispose(),m.dispose(),b.dispose()})}generateHtml(t,i){let r=i.asWebviewUri(T.Uri.file((0,N.join)(this.context.extensionPath,"media","styles.css"))),s=(0,N.dirname)(t.uri.fsPath),d=T.Uri.file(s),p=u=>{try{let m=(0,N.resolve)(s,u),f=T.Uri.file(m),g=i.asWebviewUri(f);if(g)return g.toString()}catch{}try{let m=(0,N.resolve)(s,u);if((0,O.existsSync)(m)){let f=(0,O.readFileSync)(m),g=(0,N.extname)(u).toLowerCase();return`data:${g===".png"?"image/png":g===".jpg"||g===".jpeg"?"image/jpeg":g===".gif"?"image/gif":g===".svg"?"image/svg+xml":g===".webp"?"image/webp":"image/png"};base64,${f.toString("base64")}`}}catch{}return""};try{let u=t.getText(),m=K(u),f=ae(m),g=Ae(f.root),A=(f.root.attributes?.["xml:lang"]||"").startsWith("zh")?{note:"\u6CE8",notice:"\u6CE8\u610F",warning:"\u8B66\u544A",danger:"\u5371\u9669",important:"\u91CD\u8981",tip:"\u63D0\u793A",restriction:"\u9650\u5236"}:{note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"},h=Re(t.uri),y=_e(s),E=ke(s),x=M=>{let Y=g.get(M);if(Y)return Y;if(M.includes("#"))return E(M)},D=he(f.root,{headingLevel:1,asWebviewUri:p,documentDir:d.fsPath,resolveTitle:x,resolveKey:M=>h.get(M),resolveConref:M=>y(M),noteLabels:A}),{files:Q,defaultName:k}=Kt(t.uri),V=Q[k]||"",J=T.window.activeColorTheme,z=J.kind===T.ColorThemeKind.Dark||J.kind===T.ColorThemeKind.HighContrast,Z=qt(),c=nt(JSON.stringify(Q)),U=nt(JSON.stringify(k)),F=(0,it.randomBytes)(16).toString("base64");return`<!DOCTYPE html>
<html lang="en"${z?' class="vscode-dark"':""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${i.cspSource} data:; style-src ${i.cspSource} 'unsafe-inline'; script-src 'nonce-${F}';">
<link rel="stylesheet" href="${r}">
${V?`<style>
${V}
</style>`:""}
<title>${t.fileName}</title>
<script nonce="${F}">window.__cssFiles=${c};window.__defaultCss=${U};</script>
</head>
<body>
${D}
<script nonce="${F}">${Z}</script>
</body>
</html>`}catch(u){let m=u instanceof Error?u.message:String(u);return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Render Error</h2>
<pre>${Yt(m)}</pre>
</div>
</body>
</html>`}}};function Yt(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function nt(e){return e.replace(/<\/script>/gi,"<\\/script>")}function $e(e){let t=[],i=(0,N.dirname)(e.fsPath),r=Ie(i),s=i;for(;s.length>=r.length;){try{for(let p of(0,O.readdirSync)(s))p.endsWith(".ditamap")&&t.push((0,N.join)(s,p))}catch{}if(t.length>0)return t;let d=(0,N.dirname)(s);if(d===s)break;s=d}return t}function ot(e){return e.type==="text"?e.text||"":(e.children||[]).map(ot).join("")}function jt(e,t){for(let i of t){let r=(e.children||[]).find(s=>s.type==="element"&&s.baseType===i);if(r){let s=ot(r).trim();if(s)return s}}}function Xt(e){let t=(e.children||[]).find(i=>i.type==="element"&&i.baseType==="map/topicmeta");if(t)return jt(t,["map/keyword","map/linktext","map/navtitle","map/shortdesc"])}function Re(e){let t=new Map,i=$e(e);for(let s of i)try{let m=function(f){if(f.type!=="element")return;let g=f.baseType;if((g==="map/topicref"||g==="map/keydef")&&f.attributes?.keys){let w=f.attributes.keys,b=Xt(f);t.set(w,b||w)}for(let w of f.children||[])m(w)};var r=m;let d=(0,O.readFileSync)(s,"utf-8"),u=ce(K(d)).root;for(let f of u.children||[])m(f)}catch{}return t}function Kt(e){let t={},i=new Set,r=f=>{let g=(0,N.basename)(f);if(!i.has(g)&&(0,O.existsSync)(f))try{t[g]=(0,O.readFileSync)(f,"utf-8"),i.add(g)}catch{}},s=(0,N.dirname)(e.fsPath),d=Ie(s),p=Qt(s),u=new Set;u.add(p),d!==p&&u.add(d);try{let g=T.workspace.getConfiguration("dita-viewer").get("cssDirectory");if(g)for(let w of g){let b=Jt(w,s);b&&(0,O.existsSync)(b)&&!u.has(b)&&u.add(b)}}catch{}for(let f of u)try{for(let g of(0,O.readdirSync)(f))g.toLowerCase().endsWith(".css")&&r((0,N.join)(f,g))}catch{}try{let g=T.workspace.getConfiguration("dita-viewer").get("customCss");if(g)for(let w of g){let b=Zt(w,s);b&&r(b)}}catch{}let m=t["custom.css"]?"custom.css":Object.keys(t)[0]||"";return{files:t,defaultName:m}}function Qt(e){let t=Ie(e),i=e;for(;i.length>=t.length;){if((0,O.existsSync)((0,N.join)(i,"custom.css")))return i;let r=(0,N.dirname)(i);if(r===i)break;i=r}return e}function Ie(e){let t=T.workspace.workspaceFolders;if(t&&t.length>0)return t[0].uri.fsPath;let i=e.includes("/")?"/":"\\",r=e.split(/[\\/]/);return i==="/"?"/"+r.slice(1,2).join("/"):r.length>2?r.slice(0,2).join("\\"):e}function Zt(e,t){if((0,N.isAbsolute)(e)&&(0,O.existsSync)(e))return e;let i=(0,N.resolve)(t,e);if((0,O.existsSync)(i))return i;let r=T.workspace.workspaceFolders;if(r)for(let s of r){let d=(0,N.resolve)(s.uri.fsPath,e);if((0,O.existsSync)(d))return d}}function Jt(e,t){if((0,N.isAbsolute)(e))return(0,O.existsSync)(e)?e:void 0;let i=(0,N.resolve)(t,e);if((0,O.existsSync)(i))return i;let r=T.workspace.workspaceFolders;if(r)for(let s of r){let d=(0,N.resolve)(s.uri.fsPath,e);if((0,O.existsSync)(d))return d}}var B=me(require("vscode"));function oe(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function rt(e,t){return t==null?"":` ${e}="${oe(t)}"`}function ne(e,t){return e.attributes?.[t]}function Ee(e){return e.type==="text"?e.text||"":(e.children||[]).map(Ee).join("")}function st(e,t){for(let i of t){let r=(e.children||[]).find(s=>s.type==="element"&&s.baseType===i);if(r){let s=Ee(r).trim();if(s)return s}}}function Le(e){let t=ne(e,"keys"),i=ne(e,"href"),r=(e.children||[]).find(s=>s.type==="element"&&s.baseType==="map/topicmeta");if(r){let s=st(r,["map/navtitle","map/linktext","map/shortdesc"]);if(s)return s;let d=r.children.find(p=>p.type==="element"&&p.baseType==="map/keywords");if(d){let p=st(d,["map/keyword"]);if(p)return p}}if(i){let s=i.replace(/\\/g,"/").split("/"),d=s[s.length-1]||"",p=d.lastIndexOf(".");return p>0?d.substring(0,p):d}return t||"(unnamed)"}function en(e){return!!ne(e,"href")}function de(e,t,i){return(e.children||[]).filter(r=>r.type==="element").map(r=>i(r,t)).join("")}function at(e,t,i){let r=ne(e,"href")||"",s=ne(e,"keys")||"",d=Le(e),p=en(e),u=de(e,t,i),m=p?'<span class="map-tree-icon map-tree-icon--file">\u{1F4C4}</span>':'<span class="map-tree-icon map-tree-icon--key">\u{1F511}</span>',f=oe(d),g=rt("data-keys",s),w=r?rt("data-href",r):"";return p?`<li class="map-tree-item map-tree-item--nav"${g}${w}>
      <a href="#" class="map-tree-link" data-href="${oe(r)}">${m}<span class="map-tree-label">${f}</span></a>
      ${u?`<ul class="map-tree">${u}</ul>`:""}
    </li>`:`<li class="map-tree-item map-tree-item--keydef"${g}${w}>
    ${m}<span class="map-tree-label map-tree-label--keydef">${f}</span>
    ${u?`<ul class="map-tree">${u}</ul>`:""}
  </li>`}var tn={"map/map":(e,t,i)=>{let r=e.children.find(u=>u.type==="element"&&u.baseType==="map/map-title"),s=r?`<h1 class="map-title">${oe(Ee(r))}</h1>`:"",p=e.children.filter(u=>u.type!=="element"||u.baseType!=="map/map-title").filter(u=>u.type==="element").map(u=>i(u,t)).join("");return`<div class="ditamap-container">
      ${s}
      <ul class="map-tree">${p}</ul>
    </div>`},"map/map-title":(e,t,i)=>`<h1 class="map-title">${oe(Ee(e))}</h1>`,"map/topicref":at,"map/topichead":(e,t,i)=>{let r=Le(e),s=de(e,t,i);return`<li class="map-tree-item map-tree-item--head">
      <span class="map-tree-label map-tree-label--head">${oe(r)}</span>
      ${s?`<ul class="map-tree">${s}</ul>`:""}
    </li>`},"map/topicgroup":(e,t,i)=>`<li class="map-tree-item map-tree-item--group">
      <ul class="map-tree">${de(e,t,i)}</ul>
    </li>`,"map/keydef":at,"map/reltable":(e,t,i)=>`<div class="map-reltable"><h2 class="map-reltable-title">Related Information</h2>
      <table class="map-reltable-table"><tbody>${e.children.filter(d=>d.type==="element"&&(d.baseType==="map/relheader"||d.baseType==="map/relrow")).map(d=>i(d,t)).join("")}</tbody></table>
    </div>`,"map/relheader":(e,t,i)=>`<tr class="relheader">${e.children.filter(s=>s.type==="element"&&s.baseType==="map/relcell").map(s=>i(s,t)).map(s=>`<th>${s}</th>`).join("")}</tr>`,"map/relrow":(e,t,i)=>`<tr class="relrow">${e.children.filter(s=>s.type==="element"&&s.baseType==="map/relcell").map(s=>i(s,t)).map(s=>`<td>${s}</td>`).join("")}</tr>`,"map/relcell":(e,t,i)=>`<span class="relcell-content"><ul class="map-tree map-tree--inline">${de(e,t,i)}</ul></span>`,"map/relcolspec":()=>"","map/topicmeta":()=>"","map/linktext":()=>"","map/navtitle":()=>"","map/shortdesc":()=>"","map/keywords":()=>"","map/keyword":()=>"","map/anchor":()=>"","map/navref":()=>"","map/mapref":()=>""};function ye(e,t,i){if(e.type!=="element")return;let r=e.baseType;if(r!=="map/reltable")if(r==="map/topicref"||r==="map/keydef"||r==="map/topichead"){let s=ne(e,"href"),d=ne(e,"keys");i.push({href:s,displayName:Le(e),depth:t,keys:d});for(let p of e.children||[])ye(p,t+1,i)}else if(r==="map/topicgroup")for(let s of e.children||[])ye(s,t,i);else for(let s of e.children||[])ye(s,t,i)}function ct(e){let t=[];for(let i of e.children||[])ye(i,0,t);return t}function lt(e,t){function i(s,d){if(s.type==="text")return"";let p=s.baseType,u=p?tn[p]:void 0;return u?u(s,d,i):de(s,d,i)}let r={docDir:t.docDir};return i(e,r)}var G=require("path"),dt=require("crypto"),pe=require("fs");function nn(){return`
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

  // Font toggle (serif / sans-serif)
  var isSerif = false;
  var fontBtn = document.createElement('button');
  fontBtn.textContent = 'Sans';
  fontBtn.title = 'Current: Sans-serif. Click to switch to Serif';
  fontBtn.style.cssText = btnStyle + 'font-size:11px;';
  fontBtn.addEventListener('click', function() {
    isSerif = !isSerif;
    fontBtn.textContent = isSerif ? 'Serif' : 'Sans';
    fontBtn.title = isSerif ? 'Current: Serif. Click to switch to Sans-serif' : 'Current: Sans-serif. Click to switch to Serif';
    document.body.style.fontFamily = isSerif ? "Georgia,'Times New Roman','Noto Serif SC','Songti SC',STSong,SimSun,serif" : '';
  });
  toolbar.appendChild(fontBtn);

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
`}function pt(e,t,i){if(e.type!=="element")return;let r=e.attributes?.href,s=e.baseType;if(r&&r.endsWith(".ditamap")&&(s==="map/topicref"||s==="map/keydef")){let d=(0,G.resolve)(t,r);if(i||(i=new Set),i.has(d))return;i.add(d);try{let p=(0,pe.readFileSync)(d,"utf-8"),m=(ce(K(p)).root.children||[]).filter(f=>f.type==="element");m.length>0&&(e.children||(e.children=[]),e.children.push(...m))}catch{}}for(let d of e.children||[])pt(d,t,i)}var we=class{constructor(t){this.context=t}async resolveCustomTextEditor(t,i,r){let s=B.Uri.file((0,G.dirname)(t.uri.fsPath)),d="tree";i.webview.options={enableScripts:!0,localResourceRoots:[B.Uri.file(this.context.extensionPath),s,...(B.workspace.workspaceFolders||[]).map(f=>f.uri)]},i.webview.onDidReceiveMessage(f=>{if(f.type==="refresh")m();else if(f.type==="openTopic"){let g=f.href;if(!g)return;let w=(0,G.dirname)(t.uri.fsPath),b=(0,G.resolve)(w,g),A=B.Uri.file(b),h=g.toLowerCase().endsWith(".ditamap")?"ditaViewer.mapPreview":"ditaViewer.preview";B.commands.executeCommand("vscode.openWith",A,h)}else f.type==="switchMode"&&(d=f.mode,m())});let p=B.workspace.onDidChangeTextDocument(f=>{f.document.uri.toString()===t.uri.toString()&&m()}),u=B.window.onDidChangeActiveColorTheme(()=>{m()}),m=()=>{let f=this.generateHtml(t,i.webview,d);i.webview.html=f};m(),i.onDidDispose(()=>{p.dispose(),u.dispose()})}generateHtml(t,i,r){let s=i.asWebviewUri(B.Uri.file((0,G.join)(this.context.extensionPath,"media","styles.css"))),d=(0,G.dirname)(t.uri.fsPath);try{let p=t.getText(),u=K(p),m=ce(u);pt(m.root,d);let f;r==="book"?f=this.renderBookContent(m.root,t,i,d):f=lt(m.root,{docDir:d});let g=nn(),w=(0,dt.randomBytes)(16).toString("base64"),b=B.window.activeColorTheme;return`<!DOCTYPE html>
<html lang="en"${b.kind===B.ColorThemeKind.Dark||b.kind===B.ColorThemeKind.HighContrast?' class="vscode-dark"':""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${i.cspSource} data:; style-src ${i.cspSource} 'unsafe-inline'; script-src 'nonce-${w}';">
<link rel="stylesheet" href="${s}">
<title>${t.fileName}</title>
</head>
<body class="mode-${r}">
${f}
<script nonce="${w}">${g}</script>
</body>
</html>`}catch(p){let u=p instanceof Error?p.message:String(p);return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Map Render Error</h2>
<pre>${le(u)}</pre>
</div>
</body>
</html>`}}renderBookContent(t,i,r,s){let d=ct(t),p=Re(i.uri),u=new Set,m=[];for(let f of d)if(f.href){let g=(0,G.resolve)(s,f.href);if(u.has(g)){m.push(et(f.href));continue}u.add(g);let w=(0,G.dirname)(g),b=y=>{try{let E=(0,G.resolve)(w,y),x=B.Uri.file(E),D=r.asWebviewUri(x);if(D)return D.toString()}catch{}try{let E=(0,G.resolve)(w,y);if((0,pe.existsSync)(E)){let x=(0,pe.readFileSync)(E),D=y.toLowerCase().split(".").pop()||"";return`data:${D==="png"?"image/png":D==="jpg"||D==="jpeg"?"image/jpeg":D==="gif"?"image/gif":D==="svg"?"image/svg+xml":D==="webp"?"image/webp":"image/png"};base64,${x.toString("base64")}`}}catch{}return""},A=Math.min(1+f.depth,6),h=tt({filePath:g,keyMap:p,asWebviewUri:b,headingLevel:A});h.error?m.push(Je(f.displayName,h.error,f.depth)):m.push(`<div class="book-entry">${h.html}</div>`)}else m.push(Ze(f.displayName,f.depth));return`<div class="ditamap-book">${m.join(`
`)}</div>`}};function ut(e){if(e.configuredPath){let t=e.configuredPath.trim();if(e.fileExists(t))return{found:!0,location:{executablePath:t,source:"setting"}};let i=e.platform==="win32"?`${t}\\bin\\dita.bat`:`${t}/bin/dita`;return e.fileExists(i)?{found:!0,location:{executablePath:i,source:"setting"}}:{found:!1,reason:"setting-invalid"}}if(e.ditaHomeEnv){let t=e.platform==="win32"?`${e.ditaHomeEnv}\\bin\\dita.bat`:`${e.ditaHomeEnv}/bin/dita`;if(e.fileExists(t))return{found:!0,location:{executablePath:t,source:"env"}}}if(e.pathEnv){let t=e.platform==="win32"?";":":",i=e.pathEnv.split(t),r=e.platform==="win32"?"dita.bat":"dita";for(let s of i){if(!s)continue;let d=`${s}/${r}`.replace(/\\/g,"/");if(e.fileExists(d))return{found:!0,location:{executablePath:d,source:"path"}}}}return{found:!1,reason:"not-found"}}function ft(e){return["-i",e.mapPath,"-f",e.transtype,"-o",e.outputDir]}var on=/^.*?\[ERROR\]/i,rn=/^.*?\[WARN\]/i;function Oe(e){return on.test(e)?"error":rn.test(e)?"warn":"info"}function mt(){let e="";return{processChunk(t){e+=t;let i=e.split(`
`);return e=i.pop()||"",i},flush(){let t=e;return e="",t?[t]:[]}}}var sn="ditaViewer.transformWithDitaOt";function an(e){e.subscriptions.push(v.window.registerCustomEditorProvider("ditaViewer.preview",new Te(e),{webviewOptions:{retainContextWhenHidden:!0}})),e.subscriptions.push(v.window.registerCustomEditorProvider("ditaViewer.mapPreview",new we(e),{webviewOptions:{retainContextWhenHidden:!0}}));let t=v.commands.registerCommand("ditaViewer.showRendered",()=>{let s=v.window.activeTextEditor;s&&v.commands.executeCommand("vscode.openWith",s.document.uri,"ditaViewer.preview",v.ViewColumn.Beside)});e.subscriptions.push(t);let i=v.commands.registerCommand("ditaViewer.showMapRendered",()=>{let s=v.window.activeTextEditor;s&&v.commands.executeCommand("vscode.openWith",s.document.uri,"ditaViewer.mapPreview",v.ViewColumn.Beside)});e.subscriptions.push(i);let r=v.commands.registerCommand(sn,async()=>{let s=new v.CancellationTokenSource,d=[];try{let p=await cn();if(!p){v.window.showErrorMessage("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A .ditamap \u6587\u4EF6\u3002");return}let u=v.workspace.getConfiguration("dita-viewer").get("ditaOtPath"),m=u&&u.trim()?u.trim():void 0,f=ut({configuredPath:m,ditaHomeEnv:process.env.DITA_HOME,pathEnv:process.env.PATH,platform:process.platform,fileExists:x=>(0,re.existsSync)(x)});if(!f.found){f.reason==="setting-invalid"?await v.window.showErrorMessage(`\u914D\u7F6E\u7684 DITA-OT \u8DEF\u5F84\u65E0\u6548\uFF1A${m} \u4E0B\u672A\u627E\u5230 dita \u53EF\u6267\u884C\u6587\u4EF6\u3002`,"\u6253\u5F00\u8BBE\u7F6E")==="\u6253\u5F00\u8BBE\u7F6E"&&v.commands.executeCommand("workbench.action.openSettings","dita-viewer.ditaOtPath"):await v.window.showErrorMessage("\u672A\u627E\u5230 DITA-OT\u3002\u8BF7\u5B89\u88C5 DITA-OT \u6216\u914D\u7F6E DITA_HOME \u73AF\u5883\u53D8\u91CF\u3002","\u67E5\u770B\u5B89\u88C5\u8BF4\u660E")==="\u67E5\u770B\u5B89\u88C5\u8BF4\u660E"&&v.env.openExternal(v.Uri.parse("https://www.dita-ot.org/documentation/installing"));return}let g=[{label:"html5",description:"HTML5 (\u9ED8\u8BA4)"},{label:"pdf",description:"PDF"},{label:"xhtml",description:"XHTML"},{label:"markdown",description:"Markdown"}],w=await v.window.showQuickPick(g,{placeHolder:"\u9009\u62E9\u8F93\u51FA\u683C\u5F0F\uFF08transtype\uFF09"});if(!w)return;let b=w.label,A=(0,ue.dirname)(p.fsPath),h=(0,ue.join)(A,"out",b);if((0,re.existsSync)(h))try{if((0,re.readdirSync)(h).length>0&&await v.window.showWarningMessage(`\u8F93\u51FA\u76EE\u5F55\u5DF2\u5B58\u5728\u4E14\u975E\u7A7A\uFF1A${h}\u3002\u662F\u5426\u8986\u76D6\uFF1F`,{modal:!0},"\u8986\u76D6")!=="\u8986\u76D6")return}catch{}let y=ft({mapPath:p.fsPath,transtype:b,outputDir:h}),E=v.window.createOutputChannel("DITA-OT Transform");d.push(v.Disposable.from({dispose:()=>E.dispose()},{dispose:()=>s.dispose()})),E.show(!0),await v.window.withProgress({location:v.ProgressLocation.Notification,title:`DITA-OT: \u6B63\u5728\u8F6C\u6362\u4E3A ${b}\uFF08\u9996\u6B21\u8F6C\u6362\u53EF\u80FD\u9700\u8981\u8F83\u957F\u65F6\u95F4\uFF09`,cancellable:!0},async(x,D)=>(D.onCancellationRequested(()=>{s.token.isCancellationRequested||s.cancel()}),new Promise((Q,k)=>{let V=(0,gt.spawn)(f.location.executablePath,y,{shell:!1}),J=!1,z=s.token.onCancellationRequested(()=>{J=!0,V.kill("SIGTERM"),setTimeout(()=>{try{V.kill("SIGKILL")}catch{}},3e3)});d.push(z);let Z=0,c=mt();V.stdout?.on("data",U=>{E.append(U.toString())}),V.stderr?.on("data",U=>{let F=U.toString();E.append(F);let M=c.processChunk(F);for(let Y of M)Oe(Y)==="error"&&Z++}),V.on("error",U=>{E.appendLine(`
[DITA-OT] \u8FDB\u7A0B\u542F\u52A8\u5931\u8D25: ${U.message}`),k(U)}),V.on("close",async U=>{for(let M of c.flush())Oe(M)==="error"&&Z++;if(J){E.appendLine(`
[DITA-OT] \u8F6C\u6362\u5DF2\u88AB\u7528\u6237\u53D6\u6D88\u3002`),Q();return}if(U!==0){E.appendLine(`
[DITA-OT] \u8FDB\u7A0B\u9000\u51FA\uFF0C\u9000\u51FA\u7801: ${U}`),E.appendLine(`
[DITA-OT] \u547D\u4EE4: ${f.location.executablePath} ${y.join(" ")}`),k(new Error(`DITA-OT \u9000\u51FA\u7801: ${U}`));return}E.appendLine(`
[DITA-OT] \u8F6C\u6362\u5B8C\u6210\u3002\u8F93\u51FA\u76EE\u5F55: ${h}`);let F=Z>0?`\uFF08\u68C0\u6D4B\u5230 ${Z} \u4E2A\u9519\u8BEF\uFF09`:"";if(b==="html5"){let M=(0,ue.join)(h,"index.html");(0,re.existsSync)(M)?await v.window.showInformationMessage(`DITA-OT \u8F6C\u6362\u5B8C\u6210${F}`,"\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00")==="\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00"&&v.env.openExternal(v.Uri.file(M)):await v.window.showInformationMessage(`DITA-OT \u8F6C\u6362\u5B8C\u6210${F}`,"\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A")==="\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A"&&v.commands.executeCommand("revealFileInOS",v.Uri.file(h))}else await v.window.showInformationMessage(`DITA-OT \u8F6C\u6362\u5B8C\u6210${F}`,"\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A")==="\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A"&&v.commands.executeCommand("revealFileInOS",v.Uri.file(h));Q()})})))}catch(p){let u=p instanceof Error?p.message:String(p);await v.window.showErrorMessage(`DITA-OT \u8F6C\u6362\u5931\u8D25: ${u}`,"\u67E5\u770B\u8F93\u51FA\u65E5\u5FD7")==="\u67E5\u770B\u8F93\u51FA\u65E5\u5FD7"&&v.commands.executeCommand("workbench.action.output.toggleOutput")}finally{for(let p of d)try{p.dispose()}catch{}}});e.subscriptions.push(r)}async function cn(){let e=v.window.activeTextEditor;if(!e)return;let t=e.document.uri;if(t.fsPath.endsWith(".ditamap"))return t;if(t.fsPath.endsWith(".dita")){let i=$e(t);if(i.length===0)return;if(i.length===1)return v.Uri.file(i[0]);let r=i.map(d=>({label:d,description:"\u9009\u62E9\u5173\u8054\u7684 DITA Map"})),s=await v.window.showQuickPick(r,{placeHolder:"\u627E\u5230\u591A\u4E2A DITA Map \u6587\u4EF6\uFF0C\u8BF7\u9009\u62E9\u8981\u4F7F\u7528\u7684\uFF1A"});return s?v.Uri.file(s.label):void 0}}0&&(module.exports={activate});
/*! Bundled license information:

sax/lib/sax.js:
  (*! http://mths.be/fromcodepoint v0.1.0 by @mathias *)
*/
