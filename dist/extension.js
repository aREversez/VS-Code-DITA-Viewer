"use strict";var _t=Object.create;var be=Object.defineProperty;var Rt=Object.getOwnPropertyDescriptor;var $t=Object.getOwnPropertyNames;var It=Object.getPrototypeOf,Lt=Object.prototype.hasOwnProperty;var Ft=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),Ot=(e,t)=>{for(var i in t)be(e,i,{get:t[i],enumerable:!0})},Ye=(e,t,i,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of $t(t))!Lt.call(e,s)&&s!==i&&be(e,s,{get:()=>t[s],enumerable:!(r=Rt(t,s))||r.enumerable});return e};var Te=(e,t,i)=>(i=e!=null?_t(It(e)):{},Ye(t||!e||!e.__esModule?be(i,"default",{value:e,enumerable:!0}):i,e)),Mt=e=>Ye(be({},"__esModule",{value:!0}),e);var Xe=Ft(ye=>{"use strict";(function(e){e.parser=function(o,n){return new i(o,n)},e.SAXParser=i,e.SAXStream=f,e.createStream=g,e.MAX_BUFFER_LENGTH=64*1024;var t=["comment","sgmlDecl","textNode","tagName","doctype","procInstName","procInstBody","entity","attribName","attribValue","cdata","script"];e.EVENTS=["text","processinginstruction","sgmldeclaration","doctype","comment","opentagstart","attribute","opentag","closetag","opencdata","cdata","closecdata","error","end","ready","script","opennamespace","closenamespace"];function i(o,n){if(!(this instanceof i))return new i(o,n);var d=this;s(d),d.q=d.c="",d.bufferCheckPosition=e.MAX_BUFFER_LENGTH,d.encoding=null,d.opt=n||{},d.opt.lowercase=d.opt.lowercase||d.opt.lowercasetags,d.looseCase=d.opt.lowercase?"toLowerCase":"toUpperCase",d.opt.maxEntityCount=d.opt.maxEntityCount||512,d.opt.maxEntityDepth=d.opt.maxEntityDepth||4,d.entityCount=d.entityDepth=0,d.tags=[],d.closed=d.closedRoot=d.sawRoot=!1,d.tag=d.error=null,d.strict=!!o,d.noscript=!!(o||d.opt.noscript),d.state=c.BEGIN,d.strictEntities=d.opt.strictEntities,d.ENTITIES=d.strictEntities?Object.create(e.XML_ENTITIES):Object.create(e.ENTITIES),d.attribList=[],d.opt.xmlns&&(d.ns=Object.create(D)),d.opt.unquotedAttributeValues===void 0&&(d.opt.unquotedAttributeValues=!o),d.trackPosition=d.opt.position!==!1,d.trackPosition&&(d.position=d.line=d.column=0),O(d,"onready")}Object.create||(Object.create=function(o){function n(){}n.prototype=o;var d=new n;return d}),Object.keys||(Object.keys=function(o){var n=[];for(var d in o)o.hasOwnProperty(d)&&n.push(d);return n});function r(o){for(var n=Math.max(e.MAX_BUFFER_LENGTH,10),d=0,a=0,C=t.length;a<C;a++){var L=o[t[a]].length;if(L>n)switch(t[a]){case"textNode":J(o);break;case"cdata":R(o,"oncdata",o.cdata),o.cdata="";break;case"script":R(o,"onscript",o.script),o.script="";break;default:B(o,"Max buffer length exceeded: "+t[a])}d=Math.max(d,L)}var P=e.MAX_BUFFER_LENGTH-d;o.bufferCheckPosition=P+o.position}function s(o){for(var n=0,d=t.length;n<d;n++)o[t[n]]=""}function l(o){J(o),o.cdata!==""&&(R(o,"oncdata",o.cdata),o.cdata=""),o.script!==""&&(R(o,"onscript",o.script),o.script="")}i.prototype={end:function(){te(this)},write:At,resume:function(){return this.error=null,this},close:function(){return this.write(null)},flush:function(){l(this)}};var p;try{p=require("stream").Stream}catch{p=function(){}}p||(p=function(){});var u=e.EVENTS.filter(function(o){return o!=="error"&&o!=="end"});function g(o,n){return new f(o,n)}function m(o,n){if(o.length>=2){if(o[0]===255&&o[1]===254)return"utf-16le";if(o[0]===254&&o[1]===255)return"utf-16be"}return o.length>=3&&o[0]===239&&o[1]===187&&o[2]===191?"utf8":o.length>=4?o[0]===60&&o[1]===0&&o[2]===63&&o[3]===0?"utf-16le":o[0]===0&&o[1]===60&&o[2]===0&&o[3]===63?"utf-16be":"utf8":n?"utf8":null}function f(o,n){if(!(this instanceof f))return new f(o,n);p.apply(this),this._parser=new i(o,n),this.writable=!0,this.readable=!0;var d=this;this._parser.onend=function(){d.emit("end")},this._parser.onerror=function(a){d.emit("error",a),d._parser.error=null},this._decoder=null,this._decoderBuffer=null,u.forEach(function(a){Object.defineProperty(d,"on"+a,{get:function(){return d._parser["on"+a]},set:function(C){if(!C)return d.removeAllListeners(a),d._parser["on"+a]=C,C;d.on(a,C)},enumerable:!0,configurable:!1})})}f.prototype=Object.create(p.prototype,{constructor:{value:f}}),f.prototype._decodeBuffer=function(o,n){if(this._decoderBuffer&&(o=Buffer.concat([this._decoderBuffer,o]),this._decoderBuffer=null),!this._decoder){var d=m(o,n);if(!d)return this._decoderBuffer=o,"";this._parser.encoding=d,this._decoder=new TextDecoder(d)}return this._decoder.decode(o,{stream:!n})},f.prototype.write=function(o){if(typeof Buffer=="function"&&typeof Buffer.isBuffer=="function"&&Buffer.isBuffer(o))o=this._decodeBuffer(o,!1);else if(this._decoderBuffer){var n=this._decodeBuffer(Buffer.alloc(0),!0);n&&(this._parser.write(n),this.emit("data",n))}return this._parser.write(o.toString()),this.emit("data",o),!0},f.prototype.end=function(o){if(o&&o.length&&this.write(o),this._decoderBuffer){var n=this._decodeBuffer(Buffer.alloc(0),!0);n&&(this._parser.write(n),this.emit("data",n))}else if(this._decoder){var d=this._decoder.decode();d&&(this._parser.write(d),this.emit("data",d))}return this._parser.end(),!0},f.prototype.on=function(o,n){var d=this;return!d._parser["on"+o]&&u.indexOf(o)!==-1&&(d._parser["on"+o]=function(){var a=arguments.length===1?[arguments[0]]:Array.apply(null,arguments);a.splice(0,0,o),d.emit.apply(d,a)}),p.prototype.on.call(d,o,n)};var w="[CDATA[",v="DOCTYPE",N="http://www.w3.org/XML/1998/namespace",_="http://www.w3.org/2000/xmlns/",D={xml:N,xmlns:_},T=/[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,b=/[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/,y=/[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,Z=/[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/;function S(o){return o===" "||o===`
`||o==="\r"||o==="	"}function X(o){return o==='"'||o==="'"}function ee(o){return o===">"||S(o)}function z(o,n){return o.test(n)}function W(o,n){return!z(o,n)}var c=0;e.STATE={BEGIN:c++,BEGIN_WHITESPACE:c++,TEXT:c++,TEXT_ENTITY:c++,OPEN_WAKA:c++,SGML_DECL:c++,SGML_DECL_QUOTED:c++,DOCTYPE:c++,DOCTYPE_QUOTED:c++,DOCTYPE_DTD:c++,DOCTYPE_DTD_QUOTED:c++,COMMENT_STARTING:c++,COMMENT:c++,COMMENT_ENDING:c++,COMMENT_ENDED:c++,CDATA:c++,CDATA_ENDING:c++,CDATA_ENDING_2:c++,PROC_INST:c++,PROC_INST_BODY:c++,PROC_INST_ENDING:c++,OPEN_TAG:c++,OPEN_TAG_SLASH:c++,ATTRIB:c++,ATTRIB_NAME:c++,ATTRIB_NAME_SAW_WHITE:c++,ATTRIB_VALUE:c++,ATTRIB_VALUE_QUOTED:c++,ATTRIB_VALUE_CLOSED:c++,ATTRIB_VALUE_UNQUOTED:c++,ATTRIB_VALUE_ENTITY_Q:c++,ATTRIB_VALUE_ENTITY_U:c++,CLOSE_TAG:c++,CLOSE_TAG_SAW_WHITE:c++,SCRIPT:c++,SCRIPT_ENDING:c++},e.XML_ENTITIES={amp:"&",gt:">",lt:"<",quot:'"',apos:"'"},e.ENTITIES={amp:"&",gt:">",lt:"<",quot:'"',apos:"'",AElig:198,Aacute:193,Acirc:194,Agrave:192,Aring:197,Atilde:195,Auml:196,Ccedil:199,ETH:208,Eacute:201,Ecirc:202,Egrave:200,Euml:203,Iacute:205,Icirc:206,Igrave:204,Iuml:207,Ntilde:209,Oacute:211,Ocirc:212,Ograve:210,Oslash:216,Otilde:213,Ouml:214,THORN:222,Uacute:218,Ucirc:219,Ugrave:217,Uuml:220,Yacute:221,aacute:225,acirc:226,aelig:230,agrave:224,aring:229,atilde:227,auml:228,ccedil:231,eacute:233,ecirc:234,egrave:232,eth:240,euml:235,iacute:237,icirc:238,igrave:236,iuml:239,ntilde:241,oacute:243,ocirc:244,ograve:242,oslash:248,otilde:245,ouml:246,szlig:223,thorn:254,uacute:250,ucirc:251,ugrave:249,uuml:252,yacute:253,yuml:255,copy:169,reg:174,nbsp:160,iexcl:161,cent:162,pound:163,curren:164,yen:165,brvbar:166,sect:167,uml:168,ordf:170,laquo:171,not:172,shy:173,macr:175,deg:176,plusmn:177,sup1:185,sup2:178,sup3:179,acute:180,micro:181,para:182,middot:183,cedil:184,ordm:186,raquo:187,frac14:188,frac12:189,frac34:190,iquest:191,times:215,divide:247,OElig:338,oelig:339,Scaron:352,scaron:353,Yuml:376,fnof:402,circ:710,tilde:732,Alpha:913,Beta:914,Gamma:915,Delta:916,Epsilon:917,Zeta:918,Eta:919,Theta:920,Iota:921,Kappa:922,Lambda:923,Mu:924,Nu:925,Xi:926,Omicron:927,Pi:928,Rho:929,Sigma:931,Tau:932,Upsilon:933,Phi:934,Chi:935,Psi:936,Omega:937,alpha:945,beta:946,gamma:947,delta:948,epsilon:949,zeta:950,eta:951,theta:952,iota:953,kappa:954,lambda:955,mu:956,nu:957,xi:958,omicron:959,pi:960,rho:961,sigmaf:962,sigma:963,tau:964,upsilon:965,phi:966,chi:967,psi:968,omega:969,thetasym:977,upsih:978,piv:982,ensp:8194,emsp:8195,thinsp:8201,zwnj:8204,zwj:8205,lrm:8206,rlm:8207,ndash:8211,mdash:8212,lsquo:8216,rsquo:8217,sbquo:8218,ldquo:8220,rdquo:8221,bdquo:8222,dagger:8224,Dagger:8225,bull:8226,hellip:8230,permil:8240,prime:8242,Prime:8243,lsaquo:8249,rsaquo:8250,oline:8254,frasl:8260,euro:8364,image:8465,weierp:8472,real:8476,trade:8482,alefsym:8501,larr:8592,uarr:8593,rarr:8594,darr:8595,harr:8596,crarr:8629,lArr:8656,uArr:8657,rArr:8658,dArr:8659,hArr:8660,forall:8704,part:8706,exist:8707,empty:8709,nabla:8711,isin:8712,notin:8713,ni:8715,prod:8719,sum:8721,minus:8722,lowast:8727,radic:8730,prop:8733,infin:8734,ang:8736,and:8743,or:8744,cap:8745,cup:8746,int:8747,there4:8756,sim:8764,cong:8773,asymp:8776,ne:8800,equiv:8801,le:8804,ge:8805,sub:8834,sup:8835,nsub:8836,sube:8838,supe:8839,oplus:8853,otimes:8855,perp:8869,sdot:8901,lceil:8968,rceil:8969,lfloor:8970,rfloor:8971,lang:9001,rang:9002,loz:9674,spades:9824,clubs:9827,hearts:9829,diams:9830},Object.keys(e.ENTITIES).forEach(function(o){var n=e.ENTITIES[o],d=typeof n=="number"?String.fromCharCode(n):n;e.ENTITIES[o]=d});for(var q in e.STATE)e.STATE[e.STATE[q]]=q;c=e.STATE;function O(o,n,d){o[n]&&o[n](d)}function M(o){var n=o&&o.match(/(?:^|\s)encoding\s*=\s*(['"])([^'"]+)\1/i);return n?n[2]:null}function se(o){return o?o.toLowerCase().replace(/[^a-z0-9]/g,""):null}function oe(o,n){let d=se(o),a=se(n);return!d||!a?!0:a==="utf16"?d==="utf16le"||d==="utf16be":d===a}function ve(o,n){if(!(!o.strict||!o.encoding||!n||n.name!=="xml")){var d=M(n.body);d&&!oe(o.encoding,d)&&E(o,"XML declaration encoding "+d+" does not match detected stream encoding "+o.encoding.toUpperCase())}}function R(o,n,d){o.textNode&&J(o),O(o,n,d)}function J(o){o.textNode=pe(o.opt,o.textNode),o.textNode&&O(o,"ontext",o.textNode),o.textNode=""}function pe(o,n){return o.trim&&(n=n.trim()),o.normalize&&(n=n.replace(/\s+/g," ")),n}function B(o,n){return J(o),o.trackPosition&&(n+=`
Line: `+o.line+`
Column: `+o.column+`
Char: `+o.c),n=new Error(n),o.error=n,O(o,"onerror",n),o}function te(o){return o.sawRoot&&!o.closedRoot&&E(o,"Unclosed root tag"),o.state!==c.BEGIN&&o.state!==c.BEGIN_WHITESPACE&&o.state!==c.TEXT&&B(o,"Unexpected end"),J(o),o.c="",o.closed=!0,O(o,"onend"),i.call(o,o.strict,o.opt),o}function E(o,n){if(typeof o!="object"||!(o instanceof i))throw new Error("bad call to strictFail");o.strict&&B(o,n)}function ue(o){o.strict||(o.tagName=o.tagName[o.looseCase]());var n=o.tags[o.tags.length-1]||o,d=o.tag={name:o.tagName,attributes:{}};o.opt.xmlns&&(d.ns=n.ns),o.attribList.length=0,R(o,"onopentagstart",d)}function _e(o,n){var d=o.indexOf(":"),a=d<0?["",o]:o.split(":"),C=a[0],L=a[1];return n&&o==="xmlns"&&(C="xmlns",L=""),{prefix:C,local:L}}function Re(o){if(o.strict||(o.attribName=o.attribName[o.looseCase]()),o.attribList.indexOf(o.attribName)!==-1||o.tag.attributes.hasOwnProperty(o.attribName)){o.attribName=o.attribValue="";return}if(o.opt.xmlns){var n=_e(o.attribName,!0),d=n.prefix,a=n.local;if(d==="xmlns")if(a==="xml"&&o.attribValue!==N)E(o,"xml: prefix must be bound to "+N+`
Actual: `+o.attribValue);else if(a==="xmlns"&&o.attribValue!==_)E(o,"xmlns: prefix must be bound to "+_+`
Actual: `+o.attribValue);else{var C=o.tag,L=o.tags[o.tags.length-1]||o;C.ns===L.ns&&(C.ns=Object.create(L.ns)),C.ns[a]=o.attribValue}o.attribList.push([o.attribName,o.attribValue])}else o.tag.attributes[o.attribName]=o.attribValue,R(o,"onattribute",{name:o.attribName,value:o.attribValue});o.attribName=o.attribValue=""}function ae(o,n){if(o.opt.xmlns){var d=o.tag,a=_e(o.tagName);d.prefix=a.prefix,d.local=a.local,d.uri=d.ns[a.prefix]||"",d.prefix&&!d.uri&&(E(o,"Unbound namespace prefix: "+JSON.stringify(o.tagName)),d.uri=a.prefix);var C=o.tags[o.tags.length-1]||o;d.ns&&C.ns!==d.ns&&Object.keys(d.ns).forEach(function(qe){R(o,"onopennamespace",{prefix:qe,uri:d.ns[qe]})});for(var L=0,P=o.attribList.length;L<P;L++){var G=o.attribList[L],j=G[0],ne=G[1],H=_e(j,!0),ie=H.prefix,kt=H.local,je=ie===""?"":d.ns[ie]||"",Le={name:j,value:ne,prefix:ie,local:kt,uri:je};ie&&ie!=="xmlns"&&!je&&(E(o,"Unbound namespace prefix: "+JSON.stringify(ie)),Le.uri=ie),o.tag.attributes[j]=Le,R(o,"onattribute",Le)}o.attribList.length=0}o.tag.isSelfClosing=!!n,o.sawRoot=!0,o.tags.push(o.tag),R(o,"onopentag",o.tag),n||(!o.noscript&&o.tagName.toLowerCase()==="script"?o.state=c.SCRIPT:o.state=c.TEXT,o.tag=null,o.tagName=""),o.attribName=o.attribValue="",o.attribList.length=0}function $e(o){if(!o.tagName){E(o,"Weird empty close tag."),o.textNode+="</>",o.state=c.TEXT;return}if(o.script){if(o.tagName!=="script"){o.script+="</"+o.tagName+">",o.tagName="",o.state=c.SCRIPT;return}R(o,"onscript",o.script),o.script=""}var n=o.tags.length,d=o.tagName;o.strict||(d=d[o.looseCase]());for(var a=d;n--;){var C=o.tags[n];if(C.name!==a)E(o,"Unexpected close tag");else break}if(n<0){E(o,"Unmatched closing tag: "+o.tagName),o.textNode+="</"+o.tagName+">",o.state=c.TEXT;return}o.tagName=d;for(var L=o.tags.length;L-- >n;){var P=o.tag=o.tags.pop();o.tagName=o.tag.name,R(o,"onclosetag",o.tagName);var G={};for(var j in P.ns)G[j]=P.ns[j];var ne=o.tags[o.tags.length-1]||o;o.opt.xmlns&&P.ns!==ne.ns&&Object.keys(P.ns).forEach(function(H){var ie=P.ns[H];R(o,"onclosenamespace",{prefix:H,uri:ie})})}n===0&&(o.closedRoot=!0),o.tagName=o.attribValue=o.attribName="",o.attribList.length=0,o.state=c.TEXT}function Nt(o){var n=o.entity,d=n.toLowerCase(),a,C="";return o.ENTITIES[n]?o.ENTITIES[n]:o.ENTITIES[d]?o.ENTITIES[d]:(n=d,n.charAt(0)==="#"&&(n.charAt(1)==="x"?(n=n.slice(2),a=parseInt(n,16),C=a.toString(16)):(n=n.slice(1),a=parseInt(n,10),C=a.toString(10))),n=n.replace(/^0+/,""),isNaN(a)||C.toLowerCase()!==n||a<0||a>1114111?(E(o,"Invalid character entity"),"&"+o.entity+";"):String.fromCodePoint(a))}function Ge(o,n){n==="<"?(o.state=c.OPEN_WAKA,o.startTagPosition=o.position):S(n)||(E(o,"Non-whitespace before first tag."),o.textNode=n,o.state=c.TEXT)}function Ie(o,n){var d="";return n<o.length&&(d=o.charAt(n)),d}function At(o){var n=this;if(this.error)throw this.error;if(n.closed)return B(n,"Cannot write after close. Assign an onready handler.");if(o===null)return te(n);typeof o=="object"&&(o=o.toString());for(var d=0,a="";a=Ie(o,d++),n.c=a,!!a;)switch(n.trackPosition&&(n.position++,a===`
`?(n.line++,n.column=0):n.column++),n.state){case c.BEGIN:if(n.state=c.BEGIN_WHITESPACE,a==="\uFEFF")continue;Ge(n,a);continue;case c.BEGIN_WHITESPACE:Ge(n,a);continue;case c.TEXT:if(n.sawRoot&&!n.closedRoot){for(var L=d-1;a&&a!=="<"&&a!=="&";)a=Ie(o,d++),a&&n.trackPosition&&(n.position++,a===`
`?(n.line++,n.column=0):n.column++);n.textNode+=o.substring(L,d-1)}a==="<"&&!(n.sawRoot&&n.closedRoot&&!n.strict)?(n.state=c.OPEN_WAKA,n.startTagPosition=n.position):(!S(a)&&(!n.sawRoot||n.closedRoot)&&E(n,"Text data outside of root node."),a==="&"?n.state=c.TEXT_ENTITY:n.textNode+=a);continue;case c.SCRIPT:a==="<"?n.state=c.SCRIPT_ENDING:n.script+=a;continue;case c.SCRIPT_ENDING:a==="/"?n.state=c.CLOSE_TAG:(n.script+="<"+a,n.state=c.SCRIPT);continue;case c.OPEN_WAKA:if(a==="!")n.state=c.SGML_DECL,n.sgmlDecl="";else if(!S(a))if(z(T,a))n.state=c.OPEN_TAG,n.tagName=a;else if(a==="/")n.state=c.CLOSE_TAG,n.tagName="";else if(a==="?")n.state=c.PROC_INST,n.procInstName=n.procInstBody="";else{if(E(n,"Unencoded <"),n.startTagPosition+1<n.position){var C=n.position-n.startTagPosition;a=new Array(C).join(" ")+a}n.textNode+="<"+a,n.state=c.TEXT}continue;case c.SGML_DECL:if(n.sgmlDecl+a==="--"){n.state=c.COMMENT,n.comment="",n.sgmlDecl="";continue}n.doctype&&n.doctype!==!0&&n.sgmlDecl?(n.state=c.DOCTYPE_DTD,n.doctype+="<!"+n.sgmlDecl+a,n.sgmlDecl=""):(n.sgmlDecl+a).toUpperCase()===w?(R(n,"onopencdata"),n.state=c.CDATA,n.sgmlDecl="",n.cdata=""):(n.sgmlDecl+a).toUpperCase()===v?(n.state=c.DOCTYPE,(n.doctype||n.sawRoot)&&E(n,"Inappropriately located doctype declaration"),n.doctype="",n.sgmlDecl=""):a===">"?(R(n,"onsgmldeclaration",n.sgmlDecl),n.sgmlDecl="",n.state=c.TEXT):(X(a)&&(n.state=c.SGML_DECL_QUOTED),n.sgmlDecl+=a);continue;case c.SGML_DECL_QUOTED:a===n.q&&(n.state=c.SGML_DECL,n.q=""),n.sgmlDecl+=a;continue;case c.DOCTYPE:a===">"?(n.state=c.TEXT,R(n,"ondoctype",n.doctype),n.doctype=!0):(n.doctype+=a,a==="["?n.state=c.DOCTYPE_DTD:X(a)&&(n.state=c.DOCTYPE_QUOTED,n.q=a));continue;case c.DOCTYPE_QUOTED:n.doctype+=a,a===n.q&&(n.q="",n.state=c.DOCTYPE);continue;case c.DOCTYPE_DTD:a==="]"?(n.doctype+=a,n.state=c.DOCTYPE):a==="<"?(n.state=c.OPEN_WAKA,n.startTagPosition=n.position):X(a)?(n.doctype+=a,n.state=c.DOCTYPE_DTD_QUOTED,n.q=a):n.doctype+=a;continue;case c.DOCTYPE_DTD_QUOTED:n.doctype+=a,a===n.q&&(n.state=c.DOCTYPE_DTD,n.q="");continue;case c.COMMENT:a==="-"?n.state=c.COMMENT_ENDING:n.comment+=a;continue;case c.COMMENT_ENDING:a==="-"?(n.state=c.COMMENT_ENDED,n.comment=pe(n.opt,n.comment),n.comment&&R(n,"oncomment",n.comment),n.comment=""):(n.comment+="-"+a,n.state=c.COMMENT);continue;case c.COMMENT_ENDED:a!==">"?(E(n,"Malformed comment"),n.comment+="--"+a,n.state=c.COMMENT):n.doctype&&n.doctype!==!0?n.state=c.DOCTYPE_DTD:n.state=c.TEXT;continue;case c.CDATA:for(var L=d-1;a&&a!=="]";)a=Ie(o,d++),a&&n.trackPosition&&(n.position++,a===`
`?(n.line++,n.column=0):n.column++);n.cdata+=o.substring(L,d-1),a==="]"&&(n.state=c.CDATA_ENDING);continue;case c.CDATA_ENDING:a==="]"?n.state=c.CDATA_ENDING_2:(n.cdata+="]"+a,n.state=c.CDATA);continue;case c.CDATA_ENDING_2:a===">"?(n.cdata&&R(n,"oncdata",n.cdata),R(n,"onclosecdata"),n.cdata="",n.state=c.TEXT):a==="]"?n.cdata+="]":(n.cdata+="]]"+a,n.state=c.CDATA);continue;case c.PROC_INST:a==="?"?n.state=c.PROC_INST_ENDING:S(a)?n.state=c.PROC_INST_BODY:n.procInstName+=a;continue;case c.PROC_INST_BODY:if(!n.procInstBody&&S(a))continue;a==="?"?n.state=c.PROC_INST_ENDING:n.procInstBody+=a;continue;case c.PROC_INST_ENDING:if(a===">"){let ne={name:n.procInstName,body:n.procInstBody};ve(n,ne),R(n,"onprocessinginstruction",ne),n.procInstName=n.procInstBody="",n.state=c.TEXT}else n.procInstBody+="?"+a,n.state=c.PROC_INST_BODY;continue;case c.OPEN_TAG:z(b,a)?n.tagName+=a:(ue(n),a===">"?ae(n):a==="/"?n.state=c.OPEN_TAG_SLASH:(S(a)||E(n,"Invalid character in tag name"),n.state=c.ATTRIB));continue;case c.OPEN_TAG_SLASH:a===">"?(ae(n,!0),$e(n)):(E(n,"Forward-slash in opening tag not followed by >"),n.state=c.ATTRIB);continue;case c.ATTRIB:if(S(a))continue;a===">"?ae(n):a==="/"?n.state=c.OPEN_TAG_SLASH:z(T,a)?(n.attribName=a,n.attribValue="",n.state=c.ATTRIB_NAME):E(n,"Invalid attribute name");continue;case c.ATTRIB_NAME:a==="="?n.state=c.ATTRIB_VALUE:a===">"?(E(n,"Attribute without value"),n.attribValue=n.attribName,Re(n),ae(n)):S(a)?n.state=c.ATTRIB_NAME_SAW_WHITE:z(b,a)?n.attribName+=a:E(n,"Invalid attribute name");continue;case c.ATTRIB_NAME_SAW_WHITE:if(a==="=")n.state=c.ATTRIB_VALUE;else{if(S(a))continue;E(n,"Attribute without value"),n.tag.attributes[n.attribName]="",n.attribValue="",R(n,"onattribute",{name:n.attribName,value:""}),n.attribName="",a===">"?ae(n):z(T,a)?(n.attribName=a,n.state=c.ATTRIB_NAME):(E(n,"Invalid attribute name"),n.state=c.ATTRIB)}continue;case c.ATTRIB_VALUE:if(S(a))continue;X(a)?(n.q=a,n.state=c.ATTRIB_VALUE_QUOTED):(n.opt.unquotedAttributeValues||B(n,"Unquoted attribute value"),n.state=c.ATTRIB_VALUE_UNQUOTED,n.attribValue=a);continue;case c.ATTRIB_VALUE_QUOTED:if(a!==n.q){a==="&"?n.state=c.ATTRIB_VALUE_ENTITY_Q:n.attribValue+=a;continue}Re(n),n.q="",n.state=c.ATTRIB_VALUE_CLOSED;continue;case c.ATTRIB_VALUE_CLOSED:S(a)?n.state=c.ATTRIB:a===">"?ae(n):a==="/"?n.state=c.OPEN_TAG_SLASH:z(T,a)?(E(n,"No whitespace between attributes"),n.attribName=a,n.attribValue="",n.state=c.ATTRIB_NAME):E(n,"Invalid attribute name");continue;case c.ATTRIB_VALUE_UNQUOTED:if(!ee(a)){a==="&"?n.state=c.ATTRIB_VALUE_ENTITY_U:n.attribValue+=a;continue}Re(n),a===">"?ae(n):n.state=c.ATTRIB;continue;case c.CLOSE_TAG:if(n.tagName)a===">"?$e(n):z(b,a)?n.tagName+=a:n.script?(n.script+="</"+n.tagName+a,n.tagName="",n.state=c.SCRIPT):(S(a)||E(n,"Invalid tagname in closing tag"),n.state=c.CLOSE_TAG_SAW_WHITE);else{if(S(a))continue;W(T,a)?n.script?(n.script+="</"+a,n.state=c.SCRIPT):E(n,"Invalid tagname in closing tag."):n.tagName=a}continue;case c.CLOSE_TAG_SAW_WHITE:if(S(a))continue;a===">"?$e(n):E(n,"Invalid characters in closing tag");continue;case c.TEXT_ENTITY:case c.ATTRIB_VALUE_ENTITY_Q:case c.ATTRIB_VALUE_ENTITY_U:var P,G;switch(n.state){case c.TEXT_ENTITY:P=c.TEXT,G="textNode";break;case c.ATTRIB_VALUE_ENTITY_Q:P=c.ATTRIB_VALUE_QUOTED,G="attribValue";break;case c.ATTRIB_VALUE_ENTITY_U:P=c.ATTRIB_VALUE_UNQUOTED,G="attribValue";break}if(a===";"){var j=Nt(n);n.opt.unparsedEntities&&!Object.values(e.XML_ENTITIES).includes(j)?((n.entityCount+=1)>n.opt.maxEntityCount&&B(n,"Parsed entity count exceeds max entity count"),(n.entityDepth+=1)>n.opt.maxEntityDepth&&B(n,"Parsed entity depth exceeds max entity depth"),n.entity="",n.state=P,n.write(j),n.entityDepth-=1):(n[G]+=j,n.entity="",n.state=P)}else z(n.entity.length?Z:y,a)?n.entity+=a:(E(n,"Invalid character in entity name"),n[G]+="&"+n.entity+a,n.entity="",n.state=P);continue;default:throw new Error(n,"Unknown state: "+n.state)}return n.position>=n.bufferCheckPosition&&r(n),n}String.fromCodePoint||function(){var o=String.fromCharCode,n=Math.floor,d=function(){var a=16384,C=[],L,P,G=-1,j=arguments.length;if(!j)return"";for(var ne="";++G<j;){var H=Number(arguments[G]);if(!isFinite(H)||H<0||H>1114111||n(H)!==H)throw RangeError("Invalid code point: "+H);H<=65535?C.push(H):(H-=65536,L=(H>>10)+55296,P=H%1024+56320,C.push(L,P)),(G+1===j||C.length>a)&&(ne+=o.apply(null,C),C.length=0)}return ne};Object.defineProperty?Object.defineProperty(String,"fromCodePoint",{value:d,configurable:!0,writable:!0}):String.fromCodePoint=d}()})(typeof ye>"u"?ye.sax={}:ye)});var Tn={};Ot(Tn,{activate:()=>gn});module.exports=Mt(Tn);var h=Te(require("vscode")),Ct=require("child_process"),I=require("fs"),k=require("path");var x=Te(require("vscode"));var Ze=Te(Xe());var Qe={topic:"topic/topic",title:"topic/title",shortdesc:"topic/shortdesc",body:"topic/body",section:"topic/section",example:"topic/example",p:"topic/p",note:"topic/note",ul:"topic/ul",ol:"topic/ol",li:"topic/li",sl:"topic/sl",sli:"topic/sli",dl:"topic/dl",dlentry:"topic/dlentry",dt:"topic/dt",dd:"topic/dd",table:"topic/table",tgroup:"topic/tgroup",colspec:"topic/colspec",thead:"topic/thead",tbody:"topic/tbody",row:"topic/row",entry:"topic/entry",simpletable:"topic/simpletable",sthead:"topic/sthead",strow:"topic/strow",stentry:"topic/stentry",image:"topic/image",fig:"topic/fig",codeblock:"topic/codeblock",pre:"topic/pre",xref:"topic/xref",link:"topic/link",linktext:"topic/linktext",relatedLinks:"topic/related-links",b:"topic/b",i:"topic/i",u:"topic/u",tt:"topic/tt",sup:"topic/sup",sub:"topic/sub",q:"topic/q",lq:"topic/lq",keyword:"topic/keyword",term:"topic/term",uicontrol:"topic/uicontrol",wintitle:"topic/wintitle",menucascade:"topic/menucascade",filepath:"topic/filepath",userinput:"topic/userinput",systemoutput:"topic/systemoutput",apiname:"topic/apiname",option:"topic/option",parmname:"topic/parmname",cmdname:"topic/cmdname",varname:"topic/varname",msgnum:"topic/msgnum",ph:"topic/ph",draftComment:"topic/draft-comment",requiredCleanup:"topic/required-cleanup",data:"topic/data",dataAbout:"topic/data-about",foreign:"topic/foreign",state:"topic/state",codeph:"topic/codeph",coderef:"topic/coderef",synph:"topic/synph",kwd:"topic/kwd",var:"topic/var",oper:"topic/oper",sep:"topic/sep",delim:"topic/delim",fragment:"topic/fragment",fragref:"topic/fragref",synblk:"topic/synblk",synnote:"topic/synnote",synnoteref:"topic/synnoteref",syntaxdiagram:"topic/syntaxdiagram",screen:"topic/screen",msgph:"topic/msgph",msgblock:"topic/msgblock",lines:"topic/lines",fn:"topic/fn",cite:"topic/cite",boolean:"topic/boolean",tm:"topic/tm",indexterm:"topic/indexterm",indextermref:"topic/indextermref","index-see":"topic/index-see","index-see-also":"topic/index-see-also","index-sort-as":"topic/index-sort-as","index-base":"topic/index-base",div:"topic/div",sectiondiv:"topic/sectiondiv",bodydiv:"topic/bodydiv",desc:"topic/desc",alt:"topic/alt",parml:"topic/parml",plentry:"topic/plentry",pt:"topic/pt",pd:"topic/pd","abbreviated-form":"topic/abbreviated-form",glossterm:"topic/glossterm",glossdef:"topic/glossdef",glossentry:"topic/glossentry",glossref:"topic/glossref",glossgroup:"topic/glossgroup",hazardstatement:"topic/hazardstatement",typeofhazard:"topic/typeofhazard",hazardsymbol:"topic/hazardsymbol",howtoavoid:"topic/howtoavoid",consequence:"topic/consequence",object:"topic/object",param:"topic/param",anchor:"topic/anchor",anchorid:"topic/anchorid",anchorkey:"topic/anchorkey",anchorref:"topic/anchorref"};var Ke={map:"map/map",title:"map/map-title",topicmeta:"map/topicmeta",navtitle:"map/navtitle",linktext:"map/linktext",shortdesc:"map/shortdesc",keywords:"map/keywords",keyword:"map/keyword",topicref:"map/topicref",topichead:"map/topichead",topicgroup:"map/topicgroup",keydef:"map/keydef",reltable:"map/reltable",relheader:"map/relheader",relrow:"map/relrow",relcell:"map/relcell",relcolspec:"map/relcolspec",anchor:"map/anchor",navref:"map/navref",mapref:"map/mapref"};var Pt=/^(topic|map)\//;function Bt(e){return function(i,r){let s=e[i];if(s)return s;if(r){let l=r.trim().split(/\s+/);for(let p of l)if(Pt.test(p))return p}}}function Ut(){return{startLine:0,startCol:0,endLine:0,endCol:0}}function Je(e){let t=Bt(e);return function(r){let s=Ze.default.parser(!0,{trim:!1,normalize:!1}),l={type:"element",children:[],sourceRange:Ut()},p=[l],u="",g=0,m=0;function f(){if(u.length>0){let v=p[p.length-1];v&&v.children.push({type:"text",text:u,children:[],sourceRange:{startLine:g,startCol:m,endLine:s.line,endCol:s.column}}),u=""}}s.onopentag=v=>{f();let N=v.name,_=v.attributes.class,D=t(N,_),T=_?_.trim().split(/\s+/).filter(Boolean):void 0,b={type:"element",tagName:N,classTokens:T,baseType:D,attributes:v.attributes,children:[],sourceRange:{startLine:s.line,startCol:s.column,endLine:0,endCol:0}},y=p[p.length-1];y&&y.children.push(b),p.push(b)},s.onclosetag=()=>{f();let v=p.pop();v&&(v.sourceRange.endLine=s.line,v.sourceRange.endCol=s.column)},s.ontext=v=>{u.length===0&&(g=s.line,m=s.column),u+=v},s.onerror=v=>{throw new Error(`SAX parse error at line ${s.line}:${s.column}: ${v.message}`)},s.write(r).close();let w=l.children.find(v=>v.type==="element");if(!w)throw new Error("No root element found in DITA document");return{root:w,sourceRange:w.sourceRange}}}function Q(e){let t=/<!ENTITY\s+(\S+)\s+"((?:[^"\\]|\\.)*)">/g,i,r=[];for(;(i=t.exec(e))!==null;)r.push([i[1],i[2]]);if(r.length===0)return e;let s=e.replace(t,"");for(let[l,p]of r)s=s.replace(new RegExp(`&${l};`,"g"),p);return s}var Ht=Je(Qe),Vt=Je(Ke);function fe(e){return Ht(e)}function re(e){return Vt(e)}function et(e){return e.parentBaseType==="topic/thead"}function $(e,t){return e.attributes?.[t]}function F(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function K(e,t){return t==null?"":` ${e}="${F(t)}"`}var tt={"topic/topic":(e,t,i)=>{let r=$(e,"id");return`<article${K("id",r)} class="topic">${i(e,t)}</article>`},"topic/title":(e,t,i)=>{let r=Math.min(t.headingLevel,6);return`<h${r}>${i(e,t)}</h${r}>`},"topic/shortdesc":(e,t,i)=>`<p class="shortdesc">${i(e,t)}</p>`,"topic/body":(e,t,i)=>`<main class="body">${i(e,t)}</main>`,"topic/section":(e,t,i)=>{let r=$(e,"id");return`<section${K("id",r)}>${i(e,t)}</section>`},"topic/example":(e,t,i)=>{let r=$(e,"id");return`<section${K("id",r)} class="example">${i(e,t)}</section>`},"topic/p":(e,t,i)=>`<p>${i(e,t)}</p>`,"topic/note":(e,t,i)=>{let r=$(e,"type")||"note",l=(t.noteLabels||{note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"})[r]||r;return`<div class="note note--${F(r)}"><span class="note__label">${F(l)}:</span> ${i(e,t)}</div>`},"topic/ul":(e,t,i)=>`<ul>${i(e,t)}</ul>`,"topic/ol":(e,t,i)=>`<ol>${i(e,t)}</ol>`,"topic/li":(e,t,i)=>`<li>${i(e,t)}</li>`,"topic/sl":(e,t,i)=>`<ul class="simple-list">${i(e,t)}</ul>`,"topic/sli":(e,t,i)=>`<li>${i(e,t)}</li>`,"topic/dl":(e,t,i)=>`<dl>${i(e,t)}</dl>`,"topic/dlentry":(e,t,i)=>`<div class="dlentry">${i(e,t)}</div>`,"topic/dt":(e,t,i)=>`<dt>${i(e,t)}</dt>`,"topic/dd":(e,t,i)=>`<dd>${i(e,t)}</dd>`,"topic/table":(e,t,i)=>{let r=$(e,"id");return`<table${K("id",r)} class="cals-table">${i(e,t)}</table>`},"topic/tgroup":(e,t,i)=>i(e,t),"topic/colspec":()=>"","topic/thead":(e,t,i)=>`<thead>${i(e,t)}</thead>`,"topic/tbody":(e,t,i)=>`<tbody>${i(e,t)}</tbody>`,"topic/row":(e,t,i)=>`<tr>${i(e,t)}</tr>`,"topic/entry":(e,t,i)=>{let r=et(t)?"th":"td";return`<${r}>${i(e,t)}</${r}>`},"topic/simpletable":(e,t,i)=>{let r=$(e,"id");return`<table${K("id",r)} class="simple-table">${i(e,t)}</table>`},"topic/sthead":(e,t,i)=>`<thead>${i(e,t)}</thead>`,"topic/strow":(e,t,i)=>`<tr>${i(e,t)}</tr>`,"topic/stentry":(e,t,i)=>{let r=et(t)?"th":"td";return`<${r}>${i(e,t)}</${r}>`},"topic/image":(e,t)=>{let i=$(e,"href")||"",r=$(e,"alt")||"",s=$(e,"placement")||"inline",l=$(e,"width"),p=$(e,"height"),u=`${K("width",l)}${K("height",p)}`,g=i?t.asWebviewUri(i):"",m=s==="break"?' class="image-break"':"";return`<img src="${g||""}"${K("alt",r)}${u}${m} loading="lazy" data-dita-src="${F(i)}">`},"topic/fig":(e,t,i)=>{let r=$(e,"id"),s=(e.children||[]).find(g=>g.type==="element"&&g.baseType==="topic/title"),l=(e.children||[]).filter(g=>!(g.type==="element"&&g.baseType==="topic/title")),p=i({...e,children:l},t),u=s?`<figcaption>${i(s,{...t,headingLevel:t.headingLevel+1})}</figcaption>`:"";return`<figure${K("id",r)}>${p}${u}</figure>`},"topic/codeblock":(e,t,i)=>{let r=$(e,"outputclass")||"",s=r.replace(/^language-/,""),l=s?`<div class="codeblock-lang">${F(s)}</div>`:"";return`<pre class="codeblock ${F(r)}"><code>${i(e,t)}</code>${l}</pre>`},"topic/pre":(e,t,i)=>`<pre class="preformatted">${i(e,t)}</pre>`,"topic/xref":(e,t,i)=>{let r=$(e,"href")||"";if(!r)return"";let s;if(e.children.length>0)s=i(e,t);else if(r.startsWith("#")){let l=r.includes("/")?r.split("/").pop():r.slice(1);s=F(t.resolveTitle?.(l)??"")||F(r)}else r.includes("#")?s=F(t.resolveTitle?.(r)??"")||F(r):s=F(r);if(r.startsWith("#")){let l=r.includes("/")?"#"+r.split("/").pop():r;return`<a href="${F(l)}" class="xref">${s}</a>`}return`<span class="xref-external">\u2192 ${s}</span>`},"topic/link":(e,t,i)=>{let r=$(e,"href"),s=$(e,"keyref"),l=r||s||"";return l?`<a href="${F(l)}" class="link">${i(e,t)}</a>`:i(e,t)},"topic/linktext":(e,t,i)=>i(e,t),"topic/related-links":(e,t,i)=>`<aside class="related-links"><h2>Related links</h2>${i(e,t)}</aside>`,"topic/b":(e,t,i)=>`<strong>${i(e,t)}</strong>`,"topic/i":(e,t,i)=>`<em>${i(e,t)}</em>`,"topic/u":(e,t,i)=>`<u>${i(e,t)}</u>`,"topic/tt":(e,t,i)=>`<code>${i(e,t)}</code>`,"topic/sup":(e,t,i)=>`<sup>${i(e,t)}</sup>`,"topic/sub":(e,t,i)=>`<sub>${i(e,t)}</sub>`,"topic/q":(e,t,i)=>`<q>${i(e,t)}</q>`,"topic/lq":(e,t,i)=>`<blockquote>${i(e,t)}</blockquote>`,"topic/keyword":(e,t,i)=>`<span class="keyword">${i(e,t)}</span>`,"topic/term":(e,t,i)=>`<span class="term">${i(e,t)}</span>`,"topic/ph":(e,t,i)=>{let r=$(e,"keyref");if(r&&t.resolveKey){let s=t.resolveKey(r);return s?`<span class="ph">${F(s)}</span>`:`<span class="ph unresolved-keyref" title="Unresolved key: ${F(r)}">[${F(r)}]</span>`}return`<span class="ph">${i(e,t)}</span>`},"topic/uicontrol":(e,t,i)=>`<span class="uicontrol">${i(e,t)}</span>`,"topic/wintitle":(e,t,i)=>`<span class="wintitle">${i(e,t)}</span>`,"topic/menucascade":(e,t,i)=>`<span class="menucascade">${i(e,t)}</span>`,"topic/filepath":(e,t,i)=>`<span class="filepath">${i(e,t)}</span>`,"topic/userinput":(e,t,i)=>`<span class="userinput">${i(e,t)}</span>`,"topic/systemoutput":(e,t,i)=>`<span class="systemoutput">${i(e,t)}</span>`,"topic/apiname":(e,t,i)=>`<span class="apiname">${i(e,t)}</span>`,"topic/option":(e,t,i)=>`<span class="option">${i(e,t)}</span>`,"topic/parmname":(e,t,i)=>`<span class="parmname">${i(e,t)}</span>`,"topic/cmdname":(e,t,i)=>`<span class="cmdname">${i(e,t)}</span>`,"topic/varname":(e,t,i)=>`<span class="varname">${i(e,t)}</span>`,"topic/msgnum":(e,t,i)=>`<span class="msgnum">${i(e,t)}</span>`,"topic/codeph":(e,t,i)=>`<code class="codeph">${i(e,t)}</code>`,"topic/coderef":(e,t,i)=>`<span class="coderef">${i(e,t)}</span>`,"topic/synph":(e,t,i)=>`<span class="synph">${i(e,t)}</span>`,"topic/kwd":(e,t,i)=>`<span class="kwd">${i(e,t)}</span>`,"topic/var":(e,t,i)=>`<span class="var">${i(e,t)}</span>`,"topic/oper":(e,t,i)=>`<span class="oper">${i(e,t)}</span>`,"topic/sep":(e,t,i)=>`<span class="sep">${i(e,t)}</span>`,"topic/delim":(e,t,i)=>`<span class="delim">${i(e,t)}</span>`,"topic/fragment":(e,t,i)=>`<span class="fragment">${i(e,t)}</span>`,"topic/fragref":(e,t,i)=>`<span class="fragref">${i(e,t)}</span>`,"topic/synblk":(e,t,i)=>`<pre class="synblk">${i(e,t)}</pre>`,"topic/synnote":(e,t,i)=>`<div class="synnote">${i(e,t)}</div>`,"topic/synnoteref":(e,t,i)=>`<span class="synnoteref">${i(e,t)}</span>`,"topic/syntaxdiagram":(e,t,i)=>`<div class="syntaxdiagram">${i(e,t)}</div>`,"topic/screen":(e,t,i)=>`<pre class="screen">${i(e,t)}</pre>`,"topic/msgph":(e,t,i)=>`<span class="msgph">${i(e,t)}</span>`,"topic/msgblock":(e,t,i)=>`<pre class="msgblock">${i(e,t)}</pre>`,"topic/lines":(e,t,i)=>`<pre class="lines">${i(e,t)}</pre>`,"topic/fn":(e,t,i)=>{let r=$(e,"id");return`<sup class="fn${r?` fn-call-${F(r)}`:""}">${i(e,t)}</sup>`},"topic/cite":(e,t,i)=>`<cite>${i(e,t)}</cite>`,"topic/boolean":(e,t,i)=>{let r=$(e,"value")||"";return`<span class="boolean" data-value="${F(r)}">${F(r)||i(e,t)}</span>`},"topic/tm":(e,t,i)=>`<span class="tm">${i(e,t)}</span>`,"topic/indexterm":()=>"","topic/indextermref":()=>"","topic/index-see":()=>"","topic/index-see-also":()=>"","topic/index-sort-as":()=>"","topic/index-base":()=>"","topic/div":(e,t,i)=>`<div class="body-div">${i(e,t)}</div>`,"topic/sectiondiv":(e,t,i)=>`<div class="section-div">${i(e,t)}</div>`,"topic/bodydiv":(e,t,i)=>`<div class="body-div">${i(e,t)}</div>`,"topic/desc":(e,t,i)=>`<span class="desc">${i(e,t)}</span>`,"topic/alt":(e,t,i)=>`<span class="alt">${i(e,t)}</span>`,"topic/parml":(e,t,i)=>`<dl class="parml">${i(e,t)}</dl>`,"topic/plentry":(e,t,i)=>`<div class="plentry">${i(e,t)}</div>`,"topic/pt":(e,t,i)=>`<dt class="pt">${i(e,t)}</dt>`,"topic/pd":(e,t,i)=>`<dd class="pd">${i(e,t)}</dd>`,"topic/abbreviated-form":(e,t,i)=>{let r=$(e,"keyref");return r&&t.resolveKey?`<abbr class="abbreviated-form" title="${F(r)}">${F(t.resolveKey(r)||r)}</abbr>`:`<abbr class="abbreviated-form">${i(e,t)}</abbr>`},"topic/glossterm":(e,t,i)=>`<dfn class="glossterm">${i(e,t)}</dfn>`,"topic/glossdef":(e,t,i)=>`<dd class="glossdef">${i(e,t)}</dd>`,"topic/glossentry":(e,t,i)=>`<dl class="glossentry">${i(e,t)}</dl>`,"topic/glossref":(e,t,i)=>`<span class="glossref">${i(e,t)}</span>`,"topic/glossgroup":(e,t,i)=>`<div class="glossgroup">${i(e,t)}</div>`,"topic/hazardstatement":(e,t,i)=>`<div class="hazardstatement">${i(e,t)}</div>`,"topic/typeofhazard":(e,t,i)=>`<span class="typeofhazard">${i(e,t)}</span>`,"topic/hazardsymbol":()=>"","topic/howtoavoid":(e,t,i)=>`<p class="howtoavoid">${i(e,t)}</p>`,"topic/consequence":(e,t,i)=>`<p class="consequence">${i(e,t)}</p>`,"topic/object":(e,t,i)=>`<object class="dita-object">${i(e,t)}</object>`,"topic/param":()=>"","topic/anchor":e=>{let t=$(e,"id");return t?`<a${K("id",t)}></a>`:""},"topic/anchorid":e=>{let t=$(e,"id");return t?`<span${K("id",t)}></span>`:""},"topic/anchorkey":()=>"","topic/anchorref":()=>""};var Wt=new Set(["topic/section","topic/example","topic/fig","topic/related-links"]),zt=new Set(["topic/tgroup","topic/link","topic/linktext"]);function Gt(e){return Wt.has(e)}function jt(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function qt(e,t,i){return e.replace(/^<([a-zA-Z][a-zA-Z0-9]*)/,`<$1 title="${t}" data-line="${i.startLine}" data-end-line="${i.endLine}" data-start-col="${i.startCol}" data-end-col="${i.endCol}"`)}function Yt(e,t){return{type:"text",text:e,children:[],sourceRange:t}}function Xt(e,t){let i=e.attributes?.conref;if(!i||!t.resolveConref)return e;let r=t.resolveConref(i);if(!r)return e;let s=Object.fromEntries(Object.entries(e.attributes||{}).filter(([l])=>l!=="conref"));return{...e,children:[Yt(r,e.sourceRange)],attributes:s}}function it(e,t){if(e.type==="text")return jt(e.text||"");let i=Xt(e,t),r=i.baseType,s=r?tt[r]:void 0,p=(r?Gt(r):!1)?t.headingLevel+1:t.headingLevel,u={...t,headingLevel:p,parentBaseType:r};if(s){let g=s(i,u,nt);if(r&&!zt.has(r)){let m=i.tagName||r.split("/").pop()||r;g=qt(g,m,i.sourceRange)}return g}return nt(i,u)}function nt(e,t){return(e.children||[]).map(i=>it(i,t)).join("")}function we(e,t){return it(e,t)}var U=require("fs"),A=require("path"),dt=require("crypto");var ce=require("fs"),ge=require("path");function Ee(e){return e.type==="text"?e.text||"":(e.children||[]).map(Ee).join("")}function Fe(e){let t=new Map;function i(r){if(r.type==="element"){let s=r.attributes?.id;if(s){let l=(r.children||[]).find(p=>p.type==="element"&&p.baseType==="topic/title");l&&t.set(s,Ee(l))}for(let l of r.children||[])i(l)}}return i(e),t}function ot(e){let t=new Map;function i(l){let p=(0,ge.resolve)(e,l);if(t.has(p))return t.get(p);if(!(0,ce.existsSync)(p)){t.set(p,void 0);return}try{let u=(0,ce.readFileSync)(p,"utf-8"),g=fe(Q(u));return t.set(p,g.root),g.root}catch{t.set(p,void 0);return}}function r(l,p){if(l.attributes?.id===p)return l;for(let u of l.children||[]){let g=r(u,p);if(g)return g}}function s(l,p){let u=r(l,p);if(!u)return;let g=(u.children||[]).find(m=>m.type==="element"&&m.baseType==="topic/title");if(g)return Ee(g)}return{loadFile:i,findElementById:r,findTitleOfElement:s}}function Oe(e){let t=ot(e);function i(r){let s="";for(let l of r.children||[])l.type==="text"?s+=l.text||"":s+=i(l);return s}return r=>{let s=r.indexOf("#");if(s<0)return;let l=r.substring(0,s),u=r.substring(s+1).split("/"),g=u.length>1?u[1]:u[0],m=t.loadFile(l);if(!m)return;let f=t.findElementById(m,g);if(f)return i(f)}}function Me(e){let t=ot(e);return i=>{let r=i.indexOf("#");if(r<0)return;let s=i.substring(0,r),p=i.substring(r+1).split("/")[0],u=t.loadFile(s);if(u)return t.findTitleOfElement(u,p)}}var Qt={note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"},Kt={note:"\u6CE8",notice:"\u6CE8\u610F",warning:"\u8B66\u544A",danger:"\u5371\u9669",important:"\u91CD\u8981",tip:"\u63D0\u793A",restriction:"\u9650\u5236"};function Zt(e){return(e.attributes?.["xml:lang"]||"").startsWith("zh")?Kt:Qt}function me(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function Jt(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function rt(e,t){let i=Math.min(1+t,6);return`<div class="book-entry book-entry--placeholder">
  <h${i} class="book-section-heading">${Jt(e)}</h${i}>
</div>`}function st(e,t,i){let r=Math.min(1+i,6);return`<div class="book-entry book-entry--error">
  <h${r} class="book-entry-title">${me(e)}</h${r}>
  <p class="book-error">${me(t)}</p>
</div>`}function at(e){return`<p class="book-skip">(Skipped: ${me(e)} already included above)</p>`}function Pe(e,t,i=ce.readFileSync,r){if(e.type!=="element")return;let s=e.attributes?.href,l=e.baseType;if(s&&s.endsWith(".ditamap")&&(l==="map/topicref"||l==="map/keydef")){let p=(0,ge.resolve)(t,s);if(r||(r=new Set),r.has(p))return;r.add(p);try{let u=i(p,"utf-8"),m=(re(Q(u)).root.children||[]).filter(f=>f.type==="element");m.length>0&&(e.children||(e.children=[]),e.children.push(...m))}catch{}}for(let p of e.children||[])Pe(p,t,i,r)}function ct(e){let{filePath:t,keyMap:i,asWebviewUri:r,headingLevel:s}=e;try{if(!(0,ce.existsSync)(t))return{html:"",error:`File not found: ${t}`};let l=(0,ce.readFileSync)(t,"utf-8"),p=Q(l),u=fe(p),g=Fe(u.root),m=Zt(u.root),f=(0,ge.dirname)(t),w=Oe(f),v=Me(f),N=b=>{let y=g.get(b);if(y)return y;if(b.includes("#"))return v(b)},_=we(u.root,{headingLevel:s,asWebviewUri:r,documentDir:f,resolveTitle:N,resolveKey:b=>i.get(b),resolveConref:b=>w(b),noteLabels:m}),D=(u.root.children||[]).find(b=>b.type==="element"&&b.baseType==="topic/title"),T=D?Ee(D):void 0;return{html:_,title:T}}catch(l){let p=l instanceof Error?l.message:String(l);return{html:"",error:`Error rendering ${t}: ${p}`}}}var pt=new Map;function ut(e){return pt.get(e)}function en(){return`
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

  // Finds the smallest (most specific / deepest) element whose full source
  // range actually contains the given (line, col) position, rather than
  // just picking whichever element's *start* line happens to be numerically
  // closest. This correctly distinguishes plain text that is a direct child
  // of a coarse ancestor (e.g. <p>) from an inline tag (e.g. <uicontrol>)
  // that shares the same source line but only covers a narrower column range.
  function findContaining(line, col) {
    var els = document.querySelectorAll('[data-line]');
    var best = null;
    var bestSpan = Infinity;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var sl = parseInt(el.getAttribute('data-line'), 10);
      var el2 = parseInt(el.getAttribute('data-end-line'), 10);
      var sc = parseInt(el.getAttribute('data-start-col'), 10);
      var ec = parseInt(el.getAttribute('data-end-col'), 10);
      if (isNaN(sl) || isNaN(el2) || isNaN(sc) || isNaN(ec)) continue;
      var afterStart = line > sl || (line === sl && col >= sc);
      var beforeEnd = line < el2 || (line === el2 && col <= ec);
      if (!afterStart || !beforeEnd) continue;
      var span = (el2 - sl) * 100000 + (ec - sc);
      if (span < bestSpan) { bestSpan = span; best = el; }
    }
    return best || findClosest(line);
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
    if (targetLine <= 0) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    var best = findClosest(targetLine);
    if (!best) return;
    var rect = best.getBoundingClientRect();
    if (rect.top < -5 || rect.top > 5) {
      best.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
      var best = findContaining(e.data.line, e.data.col || 0);
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
`}var xe=class{constructor(t){this.context=t}async resolveCustomTextEditor(t,i,r){let s=x.Uri.file((0,A.dirname)(t.uri.fsPath));i.webview.options={enableScripts:!0,localResourceRoots:[x.Uri.file(this.context.extensionPath),s,...(x.workspace.workspaceFolders||[]).map(T=>T.uri)]};let l=()=>x.window.visibleTextEditors.find(T=>T.document.uri.toString()===t.uri.toString()),p=T=>{i.webview.postMessage({type:"revealLine",line:T})},u=0;i.webview.onDidReceiveMessage(T=>{if(T.type==="refresh")D(),setTimeout(m,200);else if(T.type==="scrollSync"){let b=l();if(b){let y=b.visibleRanges[0]?.start.line;if(y!==void 0&&Math.abs(T.line-y)>=2){u=Date.now()+250;let S=Math.max(0,Math.min(T.line,t.lineCount-1));b.revealRange(new x.Range(S,0,S,0),x.TextEditorRevealType.AtTop),b.selection=new x.Selection(new x.Position(S,0),new x.Position(S,0))}}}else if(T.type==="navigateToLine"){let b=l();if(b){let y=Math.max(0,Math.min(T.line,t.lineCount-1));b.visibleRanges.some(S=>y>=S.start.line&&y<=S.end.line)||b.revealRange(new x.Range(y,0,y,0),x.TextEditorRevealType.AtTop),b.selection=new x.Selection(new x.Position(y,0),new x.Position(y,0))}}});let g=x.window.onDidChangeTextEditorSelection(T=>{if(T.textEditor.document.uri.toString()!==t.uri.toString()||Date.now()<u)return;let b=T.selections[0];!b||b.start.line!==b.end.line||i.webview.postMessage({type:"highlightLine",line:b.start.line,col:b.start.character})}),m=()=>{let T=l();if(T){let b=T.visibleRanges[0]?.start.line;b!==void 0&&p(b)}},f,w=x.window.onDidChangeTextEditorVisibleRanges(T=>{T.textEditor.document.uri.toString()===t.uri.toString()&&(Date.now()<u||(f&&clearTimeout(f),f=setTimeout(()=>{let b=T.textEditor.visibleRanges[0]?.start.line;b!==void 0&&p(b)},120)))}),v,N=x.workspace.onDidChangeTextDocument(T=>{T.document.uri.toString()===t.uri.toString()&&(v&&clearTimeout(v),v=setTimeout(()=>{D(),setTimeout(m,200)},300))}),_=x.window.onDidChangeActiveColorTheme(()=>{D()}),D=()=>{let T=this.generateHtml(t,i.webview);i.webview.html=T,pt.set(t.uri.toString(),T)};D(),setTimeout(m,300),i.onDidDispose(()=>{f&&clearTimeout(f),v&&clearTimeout(v),N.dispose(),w.dispose(),g.dispose(),_.dispose()})}generateHtml(t,i){let r=i.asWebviewUri(x.Uri.file((0,A.join)(this.context.extensionPath,"media","styles.css"))),s=(0,A.dirname)(t.uri.fsPath),l=x.Uri.file(s),p=u=>{try{let g=(0,A.resolve)(s,u),m=x.Uri.file(g),f=i.asWebviewUri(m);if(f)return f.toString()}catch{}try{let g=(0,A.resolve)(s,u);if((0,U.existsSync)(g)){let m=(0,U.readFileSync)(g),f=(0,A.extname)(u).toLowerCase();return`data:${f===".png"?"image/png":f===".jpg"||f===".jpeg"?"image/jpeg":f===".gif"?"image/gif":f===".svg"?"image/svg+xml":f===".webp"?"image/webp":"image/png"};base64,${m.toString("base64")}`}}catch{}return""};try{let u=t.getText(),g=Q(u),m=fe(g),f=Fe(m.root),N=(m.root.attributes?.["xml:lang"]||"").startsWith("zh")?{note:"\u6CE8",notice:"\u6CE8\u610F",warning:"\u8B66\u544A",danger:"\u5371\u9669",important:"\u91CD\u8981",tip:"\u63D0\u793A",restriction:"\u9650\u5236"}:{note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"},_=Ue(t.uri),D=Oe(s),T=Me(s),b=M=>{let se=f.get(M);if(se)return se;if(M.includes("#"))return T(M)},y=we(m.root,{headingLevel:1,asWebviewUri:p,documentDir:l.fsPath,resolveTitle:b,resolveKey:M=>_.get(M),resolveConref:M=>D(M),noteLabels:N}),{files:Z,defaultName:S}=rn(t.uri),X=Z[S]||"",ee=x.window.activeColorTheme,z=ee.kind===x.ColorThemeKind.Dark||ee.kind===x.ColorThemeKind.HighContrast,W=en(),c=lt(JSON.stringify(Z)),q=lt(JSON.stringify(S)),O=(0,dt.randomBytes)(16).toString("base64");return`<!DOCTYPE html>
<html lang="en"${z?' class="vscode-dark"':""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${i.cspSource} data:; style-src ${i.cspSource} 'unsafe-inline'; script-src 'nonce-${O}';">
<link rel="stylesheet" href="${r}">
${X?`<style>
${X}
</style>`:""}
<title>${t.fileName}</title>
<script nonce="${O}">window.__cssFiles=${c};window.__defaultCss=${q};</script>
</head>
<body>
${y}
<script nonce="${O}">${W}</script>
</body>
</html>`}catch(u){let g=u instanceof Error?u.message:String(u);return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Render Error</h2>
<pre>${tn(g)}</pre>
</div>
</body>
</html>`}}};function tn(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function lt(e){return e.replace(/<\/script>/gi,"<\\/script>")}function Be(e){let t=[],i=(0,A.dirname)(e.fsPath),r=He(i),s=i;for(;s.length>=r.length;){try{for(let p of(0,U.readdirSync)(s))p.endsWith(".ditamap")&&t.push((0,A.join)(s,p))}catch{}if(t.length>0)return t;let l=(0,A.dirname)(s);if(l===s)break;s=l}return t}function ft(e){return e.type==="text"?e.text||"":(e.children||[]).map(ft).join("")}function nn(e,t){for(let i of t){let r=(e.children||[]).find(s=>s.type==="element"&&s.baseType===i);if(r){let s=ft(r).trim();if(s)return s}}}function on(e){let t=(e.children||[]).find(i=>i.type==="element"&&i.baseType==="map/topicmeta");if(t)return nn(t,["map/keyword","map/linktext","map/navtitle","map/shortdesc"])}function Ue(e){let t=new Map,i=Be(e);for(let s of i)try{let g=function(m){if(m.type!=="element")return;let f=m.baseType;if((f==="map/topicref"||f==="map/keydef")&&m.attributes?.keys){let w=m.attributes.keys,v=on(m);t.set(w,v||w)}for(let w of m.children||[])g(w)};var r=g;let l=(0,U.readFileSync)(s,"utf-8"),u=re(Q(l)).root;for(let m of u.children||[])g(m)}catch{}return t}function rn(e){let t={},i=new Set,r=m=>{let f=(0,A.basename)(m);if(!i.has(f)&&(0,U.existsSync)(m))try{t[f]=(0,U.readFileSync)(m,"utf-8"),i.add(f)}catch{}},s=(0,A.dirname)(e.fsPath),l=He(s),p=sn(s),u=new Set;u.add(p),l!==p&&u.add(l);try{let f=x.workspace.getConfiguration("dita-viewer").get("cssDirectory");if(f)for(let w of f){let v=cn(w,s);v&&(0,U.existsSync)(v)&&!u.has(v)&&u.add(v)}}catch{}for(let m of u)try{for(let f of(0,U.readdirSync)(m))f.toLowerCase().endsWith(".css")&&r((0,A.join)(m,f))}catch{}try{let f=x.workspace.getConfiguration("dita-viewer").get("customCss");if(f)for(let w of f){let v=an(w,s);v&&r(v)}}catch{}let g=t["custom.css"]?"custom.css":Object.keys(t)[0]||"";return{files:t,defaultName:g}}function sn(e){let t=He(e),i=e;for(;i.length>=t.length;){if((0,U.existsSync)((0,A.join)(i,"custom.css")))return i;let r=(0,A.dirname)(i);if(r===i)break;i=r}return e}function He(e){let t=x.workspace.workspaceFolders;if(t&&t.length>0)return t[0].uri.fsPath;let i=e.includes("/")?"/":"\\",r=e.split(/[\\/]/);return i==="/"?"/"+r.slice(1,2).join("/"):r.length>2?r.slice(0,2).join("\\"):e}function an(e,t){if((0,A.isAbsolute)(e)&&(0,U.existsSync)(e))return e;let i=(0,A.resolve)(t,e);if((0,U.existsSync)(i))return i;let r=x.workspace.workspaceFolders;if(r)for(let s of r){let l=(0,A.resolve)(s.uri.fsPath,e);if((0,U.existsSync)(l))return l}}function cn(e,t){if((0,A.isAbsolute)(e))return(0,U.existsSync)(e)?e:void 0;let i=(0,A.resolve)(t,e);if((0,U.existsSync)(i))return i;let r=x.workspace.workspaceFolders;if(r)for(let s of r){let l=(0,A.resolve)(s.uri.fsPath,e);if((0,U.existsSync)(l))return l}}var V=Te(require("vscode"));function de(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function mt(e,t){return t==null?"":` ${e}="${de(t)}"`}function le(e,t){return e.attributes?.[t]}function Se(e){return e.type==="text"?e.text||"":(e.children||[]).map(Se).join("")}function gt(e,t){for(let i of t){let r=(e.children||[]).find(s=>s.type==="element"&&s.baseType===i);if(r){let s=Se(r).trim();if(s)return s}}}function Ve(e){let t=le(e,"keys"),i=le(e,"href"),r=(e.children||[]).find(s=>s.type==="element"&&s.baseType==="map/topicmeta");if(r){let s=gt(r,["map/navtitle","map/linktext","map/shortdesc"]);if(s)return s;let l=r.children.find(p=>p.type==="element"&&p.baseType==="map/keywords");if(l){let p=gt(l,["map/keyword"]);if(p)return p}}if(i){let s=i.replace(/\\/g,"/").split("/"),l=s[s.length-1]||"",p=l.lastIndexOf(".");return p>0?l.substring(0,p):l}return t||"(unnamed)"}function ln(e){return!!le(e,"href")}function he(e,t,i){return(e.children||[]).filter(r=>r.type==="element").map(r=>i(r,t)).join("")}function ht(e,t,i){let r=le(e,"href")||"",s=le(e,"keys")||"",l=Ve(e),p=ln(e),u=he(e,t,i),g=p?'<span class="map-tree-icon map-tree-icon--file">\u{1F4C4}</span>':'<span class="map-tree-icon map-tree-icon--key">\u{1F511}</span>',m=de(l),f=mt("data-keys",s),w=r?mt("data-href",r):"";return p?`<li class="map-tree-item map-tree-item--nav"${f}${w}>
      <a href="#" class="map-tree-link" data-href="${de(r)}">${g}<span class="map-tree-label">${m}</span></a>
      ${u?`<ul class="map-tree">${u}</ul>`:""}
    </li>`:`<li class="map-tree-item map-tree-item--keydef"${f}${w}>
    ${g}<span class="map-tree-label map-tree-label--keydef">${m}</span>
    ${u?`<ul class="map-tree">${u}</ul>`:""}
  </li>`}var dn={"map/map":(e,t,i)=>{let r=e.children.find(u=>u.type==="element"&&u.baseType==="map/map-title"),s=r?`<h1 class="map-title">${de(Se(r))}</h1>`:"",p=e.children.filter(u=>u.type!=="element"||u.baseType!=="map/map-title").filter(u=>u.type==="element").map(u=>i(u,t)).join("");return`<div class="ditamap-container">
      ${s}
      <ul class="map-tree">${p}</ul>
    </div>`},"map/map-title":(e,t,i)=>`<h1 class="map-title">${de(Se(e))}</h1>`,"map/topicref":ht,"map/topichead":(e,t,i)=>{let r=Ve(e),s=he(e,t,i);return`<li class="map-tree-item map-tree-item--head">
      <span class="map-tree-label map-tree-label--head">${de(r)}</span>
      ${s?`<ul class="map-tree">${s}</ul>`:""}
    </li>`},"map/topicgroup":(e,t,i)=>`<li class="map-tree-item map-tree-item--group">
      <ul class="map-tree">${he(e,t,i)}</ul>
    </li>`,"map/keydef":ht,"map/reltable":(e,t,i)=>`<div class="map-reltable"><h2 class="map-reltable-title">Related Information</h2>
      <table class="map-reltable-table"><tbody>${e.children.filter(l=>l.type==="element"&&(l.baseType==="map/relheader"||l.baseType==="map/relrow")).map(l=>i(l,t)).join("")}</tbody></table>
    </div>`,"map/relheader":(e,t,i)=>`<tr class="relheader">${e.children.filter(s=>s.type==="element"&&s.baseType==="map/relcell").map(s=>i(s,t)).map(s=>`<th>${s}</th>`).join("")}</tr>`,"map/relrow":(e,t,i)=>`<tr class="relrow">${e.children.filter(s=>s.type==="element"&&s.baseType==="map/relcell").map(s=>i(s,t)).map(s=>`<td>${s}</td>`).join("")}</tr>`,"map/relcell":(e,t,i)=>`<span class="relcell-content"><ul class="map-tree map-tree--inline">${he(e,t,i)}</ul></span>`,"map/relcolspec":()=>"","map/topicmeta":()=>"","map/linktext":()=>"","map/navtitle":()=>"","map/shortdesc":()=>"","map/keywords":()=>"","map/keyword":()=>"","map/anchor":()=>"","map/navref":()=>"","map/mapref":()=>""};function De(e,t,i){if(e.type!=="element")return;let r=e.baseType;if(r!=="map/reltable")if(r==="map/topicref"||r==="map/keydef"||r==="map/topichead"){let s=le(e,"href"),l=le(e,"keys");i.push({href:s,displayName:Ve(e),depth:t,keys:l});for(let p of e.children||[])De(p,t+1,i)}else if(r==="map/topicgroup")for(let s of e.children||[])De(s,t,i);else for(let s of e.children||[])De(s,t,i)}function Ce(e){let t=[];for(let i of e.children||[])De(i,0,t);return t}function vt(e,t){function i(s,l){if(s.type==="text")return"";let p=s.baseType,u=p?dn[p]:void 0;return u?u(s,l,i):he(s,l,i)}let r={docDir:t.docDir};return i(e,r)}var Y=require("path"),bt=require("crypto"),Ae=require("fs"),Tt=new Map;function yt(e){return Tt.get(e)}function pn(){return`
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
`}var Ne=class{constructor(t){this.context=t}async resolveCustomTextEditor(t,i,r){let s=V.Uri.file((0,Y.dirname)(t.uri.fsPath)),l="tree";i.webview.options={enableScripts:!0,localResourceRoots:[V.Uri.file(this.context.extensionPath),s,...(V.workspace.workspaceFolders||[]).map(f=>f.uri)]},i.webview.onDidReceiveMessage(f=>{if(f.type==="refresh")m();else if(f.type==="openTopic"){let w=f.href;if(!w)return;let v=(0,Y.dirname)(t.uri.fsPath),N=(0,Y.resolve)(v,w),_=V.Uri.file(N),D=w.toLowerCase().endsWith(".ditamap")?"ditaViewer.mapPreview":"ditaViewer.preview";V.commands.executeCommand("vscode.openWith",_,D)}else f.type==="switchMode"&&(l=f.mode,m())});let p,u=V.workspace.onDidChangeTextDocument(f=>{f.document.uri.toString()===t.uri.toString()&&(p&&clearTimeout(p),p=setTimeout(m,300))}),g=V.window.onDidChangeActiveColorTheme(()=>{m()}),m=()=>{let f=this.generateHtml(t,i.webview,l);i.webview.html=f,Tt.set(t.uri.toString(),f)};m(),i.onDidDispose(()=>{p&&clearTimeout(p),u.dispose(),g.dispose()})}generateHtml(t,i,r){let s=i.asWebviewUri(V.Uri.file((0,Y.join)(this.context.extensionPath,"media","styles.css"))),l=(0,Y.dirname)(t.uri.fsPath);try{let p=t.getText(),u=Q(p),g=re(u);Pe(g.root,l);let m;r==="book"?m=this.renderBookContent(g.root,t,i,l):m=vt(g.root,{docDir:l});let f=pn(),w=(0,bt.randomBytes)(16).toString("base64"),v=V.window.activeColorTheme;return`<!DOCTYPE html>
<html lang="en"${v.kind===V.ColorThemeKind.Dark||v.kind===V.ColorThemeKind.HighContrast?' class="vscode-dark"':""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${i.cspSource} data:; style-src ${i.cspSource} 'unsafe-inline'; script-src 'nonce-${w}';">
<link rel="stylesheet" href="${s}">
<title>${t.fileName}</title>
</head>
<body class="mode-${r}">
${m}
<script nonce="${w}">${f}</script>
</body>
</html>`}catch(p){let u=p instanceof Error?p.message:String(p);return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Map Render Error</h2>
<pre>${me(u)}</pre>
</div>
</body>
</html>`}}renderBookContent(t,i,r,s){let l=Ce(t),p=Ue(i.uri),u=new Set,g=[];for(let m of l)if(m.href){let f=(0,Y.resolve)(s,m.href);if(u.has(f)){g.push(at(m.href));continue}u.add(f);let w=(0,Y.dirname)(f),v=D=>{try{let T=(0,Y.resolve)(w,D),b=V.Uri.file(T),y=r.asWebviewUri(b);if(y)return y.toString()}catch{}try{let T=(0,Y.resolve)(w,D);if((0,Ae.existsSync)(T)){let b=(0,Ae.readFileSync)(T),y=D.toLowerCase().split(".").pop()||"";return`data:${y==="png"?"image/png":y==="jpg"||y==="jpeg"?"image/jpeg":y==="gif"?"image/gif":y==="svg"?"image/svg+xml":y==="webp"?"image/webp":"image/png"};base64,${b.toString("base64")}`}}catch{}return""},N=Math.min(1+m.depth,6),_=ct({filePath:f,keyMap:p,asWebviewUri:v,headingLevel:N});_.error?g.push(st(m.displayName,_.error,m.depth)):g.push(`<div class="book-entry">${_.html}</div>`)}else g.push(rt(m.displayName,m.depth));return`<div class="ditamap-book">${g.join(`
`)}</div>`}};var wt=require("fs"),ke=require("path");function Et(e){let t=(0,wt.readFileSync)(e,"utf-8"),i=re(Q(t));return Ce(i.root).filter(s=>s.href&&s.href.toLowerCase().endsWith(".dita")).map(s=>({file:(0,ke.basename)(s.href,(0,ke.extname)(s.href))+".html",title:s.displayName}))}function xt(e){if(e.configuredPath){let t=e.configuredPath.trim();if(e.fileExists(t))return{found:!0,location:{executablePath:t,source:"setting"}};let i=e.platform==="win32"?`${t}\\bin\\dita.bat`:`${t}/bin/dita`;return e.fileExists(i)?{found:!0,location:{executablePath:i,source:"setting"}}:{found:!1,reason:"setting-invalid"}}if(e.ditaHomeEnv){let t=e.platform==="win32"?`${e.ditaHomeEnv}\\bin\\dita.bat`:`${e.ditaHomeEnv}/bin/dita`;if(e.fileExists(t))return{found:!0,location:{executablePath:t,source:"env"}}}if(e.pathEnv){let t=e.platform==="win32"?";":":",i=e.pathEnv.split(t),r=e.platform==="win32"?"dita.bat":"dita";for(let s of i){if(!s)continue;let l=`${s}/${r}`.replace(/\\/g,"/");if(e.fileExists(l))return{found:!0,location:{executablePath:l,source:"path"}}}}return{found:!1,reason:"not-found"}}function Dt(e){let t=["-i",e.mapPath,"-f",e.transtype,"-o",e.outputDir,"--nav-toc=full"];return e.cssArg&&(t.push("--args.css",e.cssArg.filename),t.push("--args.cssroot",e.cssArg.root),t.push("--args.copycss","yes"),t.push("--args.csspath","css")),e.ditavalFile&&t.push("--filter",e.ditavalFile),t}var un=/^.*?\[ERROR\]/i,fn=/^.*?\[WARN\]/i;function We(e){return un.test(e)?"error":fn.test(e)?"warn":"info"}function St(){let e="";return{processChunk(t){e+=t;let i=e.split(`
`);return e=i.pop()||"",i},flush(){let t=e;return e="",t?[t]:[]}}}var mn="ditaViewer.transformWithDitaOt";function gn(e){e.subscriptions.push(h.window.registerCustomEditorProvider("ditaViewer.preview",new xe(e),{webviewOptions:{retainContextWhenHidden:!0}})),e.subscriptions.push(h.window.registerCustomEditorProvider("ditaViewer.mapPreview",new Ne(e),{webviewOptions:{retainContextWhenHidden:!0}}));let t=h.commands.registerCommand("ditaViewer.showRendered",()=>{let l=h.window.activeTextEditor;l&&h.commands.executeCommand("vscode.openWith",l.document.uri,"ditaViewer.preview",h.ViewColumn.Beside)});e.subscriptions.push(t);let i=h.commands.registerCommand("ditaViewer.showMapRendered",()=>{let l=h.window.activeTextEditor;l&&h.commands.executeCommand("vscode.openWith",l.document.uri,"ditaViewer.mapPreview",h.ViewColumn.Beside)});e.subscriptions.push(i);let r=e.extensionPath,s=h.commands.registerCommand(mn,async()=>{let l=new h.CancellationTokenSource,p=[];try{let u=await bn();if(!u){h.window.showErrorMessage("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A .ditamap \u6587\u4EF6\u3002");return}let g=ze(u.fsPath),m=(0,k.dirname)(g),f=h.workspace.getConfiguration("dita-viewer").get("ditaOtPath"),w=f&&f.trim()?f.trim():void 0,v=xt({configuredPath:w,ditaHomeEnv:process.env.DITA_HOME,pathEnv:process.env.PATH,platform:process.platform,fileExists:c=>(0,I.existsSync)(c)});if(!v.found){v.reason==="setting-invalid"?await h.window.showErrorMessage(`\u914D\u7F6E\u7684 DITA-OT \u8DEF\u5F84\u65E0\u6548\uFF1A${w} \u4E0B\u672A\u627E\u5230 dita \u53EF\u6267\u884C\u6587\u4EF6\u3002`,"\u6253\u5F00\u8BBE\u7F6E")==="\u6253\u5F00\u8BBE\u7F6E"&&h.commands.executeCommand("workbench.action.openSettings","dita-viewer.ditaOtPath"):await h.window.showErrorMessage("\u672A\u627E\u5230 DITA-OT\u3002\u8BF7\u5B89\u88C5 DITA-OT \u6216\u914D\u7F6E DITA_HOME \u73AF\u5883\u53D8\u91CF\u3002","\u67E5\u770B\u5B89\u88C5\u8BF4\u660E")==="\u67E5\u770B\u5B89\u88C5\u8BF4\u660E"&&h.env.openExternal(h.Uri.parse("https://www.dita-ot.org/documentation/installing"));return}let N=[{label:"html5",description:"HTML5 (\u9ED8\u8BA4)"},{label:"pdf",description:"PDF"},{label:"xhtml",description:"XHTML"},{label:"markdown",description:"Markdown"}],_=await h.window.showQuickPick(N,{placeHolder:"\u9009\u62E9\u8F93\u51FA\u683C\u5F0F\uFF08transtype\uFF09"});if(!_)return;let D=_.label,T=(0,k.join)(m,"out",D),b=await h.window.showOpenDialog({canSelectFolders:!0,canSelectFiles:!1,canSelectMany:!1,defaultUri:h.Uri.file(T),openLabel:"\u9009\u62E9\u8F93\u51FA\u76EE\u5F55"}),y=ze(b&&b.length>0?b[0].fsPath:T);if((0,I.existsSync)(y))try{if((0,I.readdirSync)(y).length>0&&await h.window.showWarningMessage(`\u8F93\u51FA\u76EE\u5F55\u5DF2\u5B58\u5728\u4E14\u975E\u7A7A\uFF1A${y}\u3002\u662F\u5426\u8986\u76D6\uFF1F`,{modal:!0},"\u8986\u76D6")!=="\u8986\u76D6")return}catch{}let Z;if(D==="html5"||D==="xhtml"){let c=vn(m);if(c.length>0){let q=[{label:"$(close) \u4E0D\u6DFB\u52A0\u81EA\u5B9A\u4E49 CSS",description:"\u4F7F\u7528 DITA-OT \u9ED8\u8BA4\u6837\u5F0F",css:void 0},...c.map(M=>({label:`$(file) ${(0,k.basename)(M)}`,description:(0,k.dirname)(M),css:{filename:(0,k.basename)(M),root:(0,k.dirname)(M)}}))],O=await h.window.showQuickPick(q,{placeHolder:"\u9009\u62E9\u81EA\u5B9A\u4E49 CSS \u6587\u4EF6\uFF08\u53EF\u9009\uFF09",ignoreFocusOut:!1});O&&O.css&&(Z=O.css)}}let S,X=await h.window.showOpenDialog({canSelectFiles:!0,canSelectFolders:!1,canSelectMany:!1,filters:{"DITAVAL \u7B5B\u9009\u6587\u4EF6":["ditaval"]},openLabel:"\u9009\u62E9\u7B5B\u9009\u6587\u4EF6"});X&&X.length>0&&(S=ze(X[0].fsPath));let ee;if(D==="html5"||D==="xhtml"){let c=[{label:"\u5BFC\u822A\u5DE5\u5177\u680F",description:"\u4E0A\u4E00\u9875/\u4E0B\u4E00\u9875 + \u6298\u53E0/\u5C55\u5F00\u7AE0\u8282",key:"navToolbar",picked:!0},{label:"\u4FA7\u8FB9\u680F\u76EE\u5F55",description:"\u5DE6\u4FA7\u56FA\u5B9A\u76EE\u5F55\u6811",key:"sidebar",picked:!0},{label:"\u672C\u9875\u76EE\u5F55",description:"\u53F3\u4FA7\u672C\u9875\u6807\u9898\u5BFC\u822A",key:"onPageToc",picked:!0},{label:"\u4EE3\u7801\u590D\u5236\u6309\u94AE",description:"\u4EE3\u7801\u5757\u590D\u5236\u6309\u94AE",key:"copyCode",picked:!0},{label:"\u56DE\u5230\u9876\u90E8",description:"\u53F3\u4E0B\u89D2\u56DE\u5230\u9876\u90E8\u6309\u94AE",key:"backToTop",picked:!0},{label:"\u6697\u8272\u6A21\u5F0F",description:"\u4EAE\u8272/\u6697\u8272\u5207\u6362",key:"darkMode",picked:!0}],q=await h.window.showQuickPick(c,{canPickMany:!0,placeHolder:"\u9009\u62E9\u8981\u542F\u7528\u7684\u7AD9\u70B9\u589E\u5F3A\u529F\u80FD\uFF08\u9ED8\u8BA4\u5168\u90E8\u542F\u7528\uFF09",ignoreFocusOut:!1});if(q){let O={navToolbar:!1,sidebar:!1,onPageToc:!1,copyCode:!1,backToTop:!1,darkMode:!1};for(let M of q)O[M.key]=!0;ee=O}else ee={navToolbar:!0,sidebar:!0,onPageToc:!0,copyCode:!0,backToTop:!0,darkMode:!0}}let z=Dt({mapPath:g,transtype:D,outputDir:y,cssArg:Z,ditavalFile:S}),W=h.window.createOutputChannel("DITA-OT Transform");p.push(h.Disposable.from({dispose:()=>W.dispose()},{dispose:()=>l.dispose()})),W.show(!0),await h.window.withProgress({location:h.ProgressLocation.Notification,title:`DITA-OT: \u6B63\u5728\u8F6C\u6362\u4E3A ${D}\uFF08\u9996\u6B21\u8F6C\u6362\u53EF\u80FD\u9700\u8981\u8F83\u957F\u65F6\u95F4\uFF09`,cancellable:!0},async(c,q)=>(q.onCancellationRequested(()=>{l.token.isCancellationRequested||l.cancel()}),new Promise((O,M)=>{let se=process.platform==="win32",oe=(0,Ct.spawn)(v.location.executablePath,z,{shell:se}),ve=!1,R=l.token.onCancellationRequested(()=>{ve=!0,oe.kill("SIGTERM"),setTimeout(()=>{try{oe.kill("SIGKILL")}catch{}},3e3)});p.push(R);let J=0,pe=St();oe.stdout?.on("data",B=>{W.append(B.toString())}),oe.stderr?.on("data",B=>{let te=B.toString();W.append(te);let E=pe.processChunk(te);for(let ue of E)We(ue)==="error"&&J++}),oe.on("error",B=>{W.appendLine(`
[DITA-OT] \u8FDB\u7A0B\u542F\u52A8\u5931\u8D25: ${B.message}`),M(B)}),oe.on("close",async B=>{for(let E of pe.flush())We(E)==="error"&&J++;if(ve){W.appendLine(`
[DITA-OT] \u8F6C\u6362\u5DF2\u88AB\u7528\u6237\u53D6\u6D88\u3002`),O();return}if(B!==0){W.appendLine(`
[DITA-OT] \u8FDB\u7A0B\u9000\u51FA\uFF0C\u9000\u51FA\u7801: ${B}`),W.appendLine(`
[DITA-OT] \u547D\u4EE4: ${v.location.executablePath} ${z.join(" ")}`),M(new Error(`DITA-OT \u9000\u51FA\u7801: ${B}`));return}if(W.appendLine(`
[DITA-OT] \u8F6C\u6362\u5B8C\u6210\u3002\u8F93\u51FA\u76EE\u5F55: ${y}`),D==="html5"||D==="xhtml")try{ee&&(hn(r,g,y,ee),W.appendLine(`
[DITA-OT] \u7AD9\u70B9\u589E\u5F3A\u5DF2\u6CE8\u5165\u3002`))}catch(E){W.appendLine(`
[DITA-OT] \u7AD9\u70B9\u589E\u5F3A\u6CE8\u5165\u5931\u8D25: ${E}`)}let te=J>0?`\uFF08\u68C0\u6D4B\u5230 ${J} \u4E2A\u9519\u8BEF\uFF09`:"";if(D==="html5"){let E=(0,k.join)(y,"index.html");(0,I.existsSync)(E)?await h.window.showInformationMessage(`DITA-OT \u8F6C\u6362\u5B8C\u6210${te}`,"\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00")==="\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00"&&h.env.openExternal(h.Uri.file(E)):await h.window.showInformationMessage(`DITA-OT \u8F6C\u6362\u5B8C\u6210${te}`,"\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A")==="\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A"&&h.commands.executeCommand("revealFileInOS",h.Uri.file(y))}else await h.window.showInformationMessage(`DITA-OT \u8F6C\u6362\u5B8C\u6210${te}`,"\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A")==="\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A"&&h.commands.executeCommand("revealFileInOS",h.Uri.file(y));O()})})))}catch(u){let g=u instanceof Error?u.message:String(u);await h.window.showErrorMessage(`DITA-OT \u8F6C\u6362\u5931\u8D25: ${g}`,"\u67E5\u770B\u8F93\u51FA\u65E5\u5FD7")==="\u67E5\u770B\u8F93\u51FA\u65E5\u5FD7"&&h.commands.executeCommand("workbench.action.output.toggleOutput")}finally{for(let u of p)try{u.dispose()}catch{}}});return e.subscriptions.push(s),{_test:{getLastRenderedHtml:ut,getLastRenderedMapHtml:yt}}}function hn(e,t,i,r){let s=Et(t),p=(0,I.readFileSync)((0,k.join)(e,"media","transform-assets","site-chrome.js"),"utf-8").replace("/* __DV_MANIFEST__ */",JSON.stringify(s)).replace("/* __DV_FEATURES__ */",JSON.stringify(r));(0,I.writeFileSync)((0,k.join)(i,"dita-viewer-chrome.js"),p,"utf-8");let u=(0,I.readFileSync)((0,k.join)(e,"media","transform-assets","site-chrome.css"),"utf-8");(0,I.writeFileSync)((0,k.join)(i,"dita-viewer-chrome.css"),u,"utf-8");let g=r.darkMode;if(g){let f=(0,I.readFileSync)((0,k.join)(e,"media","transform-assets","dark-mode.css"),"utf-8");(0,I.writeFileSync)((0,k.join)(i,"dita-viewer-dark.css"),f,"utf-8")}function m(f){for(let w of(0,I.readdirSync)(f)){let v=(0,k.join)(f,w);try{if((0,I.statSync)(v).isDirectory()){m(v);continue}}catch{continue}if(!w.toLowerCase().endsWith(".html"))continue;let N=(0,I.readFileSync)(v,"utf-8");if(N.includes("dita-viewer-chrome"))continue;let D=v.substring(i.length).replace(/\\/g,"/").replace(/^\/+/,"").split("/").length-1,T=D>0?"../".repeat(D):"",b='<link rel="stylesheet" type="text/css" href="'+T+'dita-viewer-chrome.css">';if(N=N.replace("</head>",b+"</head>"),g){let y='<link rel="stylesheet" type="text/css" href="'+T+'dita-viewer-dark.css">';N=N.replace("</head>",y+"</head>")}N=N.replace("</body>",'<script src="'+T+'dita-viewer-chrome.js"></script></body>'),(0,I.writeFileSync)(v,N,"utf-8")}}m(i)}function vn(e){let t=new Map,i=new Set;i.add(e);let r=h.workspace.workspaceFolders?.[0]?.uri?.fsPath;r&&r!==e&&i.add(r);try{let s=h.workspace.getConfiguration("dita-viewer").get("cssDirectory");if(s)for(let l of s){let p=(0,k.isAbsolute)(l)?l:(0,k.resolve)(e,l);(0,I.existsSync)(p)&&i.add(p)}}catch{}for(let s of i)try{for(let l of(0,I.readdirSync)(s))l.toLowerCase().endsWith(".css")&&!t.has(l)&&t.set(l,(0,k.join)(s,l))}catch{}try{let s=h.workspace.getConfiguration("dita-viewer").get("customCss");if(s)for(let l of s){let p=(0,k.isAbsolute)(l)?l:(0,k.resolve)(e,l);(0,I.existsSync)(p)&&!t.has((0,k.basename)(p))&&t.set((0,k.basename)(p),p)}}catch{}return[...t.values()]}function ze(e){return process.platform==="win32"&&/^[a-z]:/.test(e)?e[0].toUpperCase()+e.slice(1):e}async function bn(){let e=h.window.activeTextEditor;if(!e)return;let t=e.document.uri;if(t.fsPath.endsWith(".ditamap"))return t;if(t.fsPath.endsWith(".dita")){let i=Be(t);if(i.length===0)return;if(i.length===1)return h.Uri.file(i[0]);let r=i.map(l=>({label:l,description:"\u9009\u62E9\u5173\u8054\u7684 DITA Map"})),s=await h.window.showQuickPick(r,{placeHolder:"\u627E\u5230\u591A\u4E2A DITA Map \u6587\u4EF6\uFF0C\u8BF7\u9009\u62E9\u8981\u4F7F\u7528\u7684\uFF1A"});return s?h.Uri.file(s.label):void 0}}0&&(module.exports={activate});
/*! Bundled license information:

sax/lib/sax.js:
  (*! http://mths.be/fromcodepoint v0.1.0 by @mathias *)
*/
