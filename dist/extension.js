"use strict";var xt=Object.create;var he=Object.defineProperty;var Dt=Object.getOwnPropertyDescriptor;var Ct=Object.getOwnPropertyNames;var St=Object.getPrototypeOf,Nt=Object.prototype.hasOwnProperty;var At=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),_t=(e,t)=>{for(var i in t)he(e,i,{get:t[i],enumerable:!0})},qe=(e,t,i,s)=>{if(t&&typeof t=="object"||typeof t=="function")for(let r of Ct(t))!Nt.call(e,r)&&r!==i&&he(e,r,{get:()=>t[r],enumerable:!(s=Dt(t,r))||s.enumerable});return e};var ve=(e,t,i)=>(i=e!=null?xt(St(e)):{},qe(t||!e||!e.__esModule?he(i,"default",{value:e,enumerable:!0}):i,e)),kt=e=>qe(he({},"__esModule",{value:!0}),e);var je=At(be=>{"use strict";(function(e){e.parser=function(o,n){return new i(o,n)},e.SAXParser=i,e.SAXStream=g,e.createStream=m,e.MAX_BUFFER_LENGTH=64*1024;var t=["comment","sgmlDecl","textNode","tagName","doctype","procInstName","procInstBody","entity","attribName","attribValue","cdata","script"];e.EVENTS=["text","processinginstruction","sgmldeclaration","doctype","comment","opentagstart","attribute","opentag","closetag","opencdata","cdata","closecdata","error","end","ready","script","opennamespace","closenamespace"];function i(o,n){if(!(this instanceof i))return new i(o,n);var l=this;r(l),l.q=l.c="",l.bufferCheckPosition=e.MAX_BUFFER_LENGTH,l.encoding=null,l.opt=n||{},l.opt.lowercase=l.opt.lowercase||l.opt.lowercasetags,l.looseCase=l.opt.lowercase?"toLowerCase":"toUpperCase",l.opt.maxEntityCount=l.opt.maxEntityCount||512,l.opt.maxEntityDepth=l.opt.maxEntityDepth||4,l.entityCount=l.entityDepth=0,l.tags=[],l.closed=l.closedRoot=l.sawRoot=!1,l.tag=l.error=null,l.strict=!!o,l.noscript=!!(o||l.opt.noscript),l.state=c.BEGIN,l.strictEntities=l.opt.strictEntities,l.ENTITIES=l.strictEntities?Object.create(e.XML_ENTITIES):Object.create(e.ENTITIES),l.attribList=[],l.opt.xmlns&&(l.ns=Object.create(w)),l.opt.unquotedAttributeValues===void 0&&(l.opt.unquotedAttributeValues=!o),l.trackPosition=l.opt.position!==!1,l.trackPosition&&(l.position=l.line=l.column=0),X(l,"onready")}Object.create||(Object.create=function(o){function n(){}n.prototype=o;var l=new n;return l}),Object.keys||(Object.keys=function(o){var n=[];for(var l in o)o.hasOwnProperty(l)&&n.push(l);return n});function s(o){for(var n=Math.max(e.MAX_BUFFER_LENGTH,10),l=0,a=0,C=t.length;a<C;a++){var R=o[t[a]].length;if(R>n)switch(t[a]){case"textNode":z(o);break;case"cdata":k(o,"oncdata",o.cdata),o.cdata="";break;case"script":k(o,"onscript",o.script),o.script="";break;default:F(o,"Max buffer length exceeded: "+t[a])}l=Math.max(l,R)}var M=e.MAX_BUFFER_LENGTH-l;o.bufferCheckPosition=M+o.position}function r(o){for(var n=0,l=t.length;n<l;n++)o[t[n]]=""}function d(o){z(o),o.cdata!==""&&(k(o,"oncdata",o.cdata),o.cdata=""),o.script!==""&&(k(o,"onscript",o.script),o.script="")}i.prototype={end:function(){de(this)},write:wt,resume:function(){return this.error=null,this},close:function(){return this.write(null)},flush:function(){d(this)}};var p;try{p=require("stream").Stream}catch{p=function(){}}p||(p=function(){});var u=e.EVENTS.filter(function(o){return o!=="error"&&o!=="end"});function m(o,n){return new g(o,n)}function f(o,n){if(o.length>=2){if(o[0]===255&&o[1]===254)return"utf-16le";if(o[0]===254&&o[1]===255)return"utf-16be"}return o.length>=3&&o[0]===239&&o[1]===187&&o[2]===191?"utf8":o.length>=4?o[0]===60&&o[1]===0&&o[2]===63&&o[3]===0?"utf-16le":o[0]===0&&o[1]===60&&o[2]===0&&o[3]===63?"utf-16be":"utf8":n?"utf8":null}function g(o,n){if(!(this instanceof g))return new g(o,n);p.apply(this),this._parser=new i(o,n),this.writable=!0,this.readable=!0;var l=this;this._parser.onend=function(){l.emit("end")},this._parser.onerror=function(a){l.emit("error",a),l._parser.error=null},this._decoder=null,this._decoderBuffer=null,u.forEach(function(a){Object.defineProperty(l,"on"+a,{get:function(){return l._parser["on"+a]},set:function(C){if(!C)return l.removeAllListeners(a),l._parser["on"+a]=C,C;l.on(a,C)},enumerable:!0,configurable:!1})})}g.prototype=Object.create(p.prototype,{constructor:{value:g}}),g.prototype._decodeBuffer=function(o,n){if(this._decoderBuffer&&(o=Buffer.concat([this._decoderBuffer,o]),this._decoderBuffer=null),!this._decoder){var l=f(o,n);if(!l)return this._decoderBuffer=o,"";this._parser.encoding=l,this._decoder=new TextDecoder(l)}return this._decoder.decode(o,{stream:!n})},g.prototype.write=function(o){if(typeof Buffer=="function"&&typeof Buffer.isBuffer=="function"&&Buffer.isBuffer(o))o=this._decodeBuffer(o,!1);else if(this._decoderBuffer){var n=this._decodeBuffer(Buffer.alloc(0),!0);n&&(this._parser.write(n),this.emit("data",n))}return this._parser.write(o.toString()),this.emit("data",o),!0},g.prototype.end=function(o){if(o&&o.length&&this.write(o),this._decoderBuffer){var n=this._decodeBuffer(Buffer.alloc(0),!0);n&&(this._parser.write(n),this.emit("data",n))}else if(this._decoder){var l=this._decoder.decode();l&&(this._parser.write(l),this.emit("data",l))}return this._parser.end(),!0},g.prototype.on=function(o,n){var l=this;return!l._parser["on"+o]&&u.indexOf(o)!==-1&&(l._parser["on"+o]=function(){var a=arguments.length===1?[arguments[0]]:Array.apply(null,arguments);a.splice(0,0,o),l.emit.apply(l,a)}),p.prototype.on.call(l,o,n)};var y="[CDATA[",b="DOCTYPE",_="http://www.w3.org/XML/1998/namespace",v="http://www.w3.org/2000/xmlns/",w={xml:_,xmlns:v},x=/[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,E=/[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/,D=/[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,ne=/[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/;function $(o){return o===" "||o===`
`||o==="\r"||o==="	"}function Z(o){return o==='"'||o==="'"}function W(o){return o===">"||$(o)}function O(o,n){return o.test(n)}function ie(o,n){return!O(o,n)}var c=0;e.STATE={BEGIN:c++,BEGIN_WHITESPACE:c++,TEXT:c++,TEXT_ENTITY:c++,OPEN_WAKA:c++,SGML_DECL:c++,SGML_DECL_QUOTED:c++,DOCTYPE:c++,DOCTYPE_QUOTED:c++,DOCTYPE_DTD:c++,DOCTYPE_DTD_QUOTED:c++,COMMENT_STARTING:c++,COMMENT:c++,COMMENT_ENDING:c++,COMMENT_ENDED:c++,CDATA:c++,CDATA_ENDING:c++,CDATA_ENDING_2:c++,PROC_INST:c++,PROC_INST_BODY:c++,PROC_INST_ENDING:c++,OPEN_TAG:c++,OPEN_TAG_SLASH:c++,ATTRIB:c++,ATTRIB_NAME:c++,ATTRIB_NAME_SAW_WHITE:c++,ATTRIB_VALUE:c++,ATTRIB_VALUE_QUOTED:c++,ATTRIB_VALUE_CLOSED:c++,ATTRIB_VALUE_UNQUOTED:c++,ATTRIB_VALUE_ENTITY_Q:c++,ATTRIB_VALUE_ENTITY_U:c++,CLOSE_TAG:c++,CLOSE_TAG_SAW_WHITE:c++,SCRIPT:c++,SCRIPT_ENDING:c++},e.XML_ENTITIES={amp:"&",gt:">",lt:"<",quot:'"',apos:"'"},e.ENTITIES={amp:"&",gt:">",lt:"<",quot:'"',apos:"'",AElig:198,Aacute:193,Acirc:194,Agrave:192,Aring:197,Atilde:195,Auml:196,Ccedil:199,ETH:208,Eacute:201,Ecirc:202,Egrave:200,Euml:203,Iacute:205,Icirc:206,Igrave:204,Iuml:207,Ntilde:209,Oacute:211,Ocirc:212,Ograve:210,Oslash:216,Otilde:213,Ouml:214,THORN:222,Uacute:218,Ucirc:219,Ugrave:217,Uuml:220,Yacute:221,aacute:225,acirc:226,aelig:230,agrave:224,aring:229,atilde:227,auml:228,ccedil:231,eacute:233,ecirc:234,egrave:232,eth:240,euml:235,iacute:237,icirc:238,igrave:236,iuml:239,ntilde:241,oacute:243,ocirc:244,ograve:242,oslash:248,otilde:245,ouml:246,szlig:223,thorn:254,uacute:250,ucirc:251,ugrave:249,uuml:252,yacute:253,yuml:255,copy:169,reg:174,nbsp:160,iexcl:161,cent:162,pound:163,curren:164,yen:165,brvbar:166,sect:167,uml:168,ordf:170,laquo:171,not:172,shy:173,macr:175,deg:176,plusmn:177,sup1:185,sup2:178,sup3:179,acute:180,micro:181,para:182,middot:183,cedil:184,ordm:186,raquo:187,frac14:188,frac12:189,frac34:190,iquest:191,times:215,divide:247,OElig:338,oelig:339,Scaron:352,scaron:353,Yuml:376,fnof:402,circ:710,tilde:732,Alpha:913,Beta:914,Gamma:915,Delta:916,Epsilon:917,Zeta:918,Eta:919,Theta:920,Iota:921,Kappa:922,Lambda:923,Mu:924,Nu:925,Xi:926,Omicron:927,Pi:928,Rho:929,Sigma:931,Tau:932,Upsilon:933,Phi:934,Chi:935,Psi:936,Omega:937,alpha:945,beta:946,gamma:947,delta:948,epsilon:949,zeta:950,eta:951,theta:952,iota:953,kappa:954,lambda:955,mu:956,nu:957,xi:958,omicron:959,pi:960,rho:961,sigmaf:962,sigma:963,tau:964,upsilon:965,phi:966,chi:967,psi:968,omega:969,thetasym:977,upsih:978,piv:982,ensp:8194,emsp:8195,thinsp:8201,zwnj:8204,zwj:8205,lrm:8206,rlm:8207,ndash:8211,mdash:8212,lsquo:8216,rsquo:8217,sbquo:8218,ldquo:8220,rdquo:8221,bdquo:8222,dagger:8224,Dagger:8225,bull:8226,hellip:8230,permil:8240,prime:8242,Prime:8243,lsaquo:8249,rsaquo:8250,oline:8254,frasl:8260,euro:8364,image:8465,weierp:8472,real:8476,trade:8482,alefsym:8501,larr:8592,uarr:8593,rarr:8594,darr:8595,harr:8596,crarr:8629,lArr:8656,uArr:8657,rArr:8658,dArr:8659,hArr:8660,forall:8704,part:8706,exist:8707,empty:8709,nabla:8711,isin:8712,notin:8713,ni:8715,prod:8719,sum:8721,minus:8722,lowast:8727,radic:8730,prop:8733,infin:8734,ang:8736,and:8743,or:8744,cap:8745,cup:8746,int:8747,there4:8756,sim:8764,cong:8773,asymp:8776,ne:8800,equiv:8801,le:8804,ge:8805,sub:8834,sup:8835,nsub:8836,sube:8838,supe:8839,oplus:8853,otimes:8855,perp:8869,sdot:8901,lceil:8968,rceil:8969,lfloor:8970,rfloor:8971,lang:9001,rang:9002,loz:9674,spades:9824,clubs:9827,hearts:9829,diams:9830},Object.keys(e.ENTITIES).forEach(function(o){var n=e.ENTITIES[o],l=typeof n=="number"?String.fromCharCode(n):n;e.ENTITIES[o]=l});for(var j in e.STATE)e.STATE[e.STATE[j]]=j;c=e.STATE;function X(o,n,l){o[n]&&o[n](l)}function H(o){var n=o&&o.match(/(?:^|\s)encoding\s*=\s*(['"])([^'"]+)\1/i);return n?n[2]:null}function oe(o){return o?o.toLowerCase().replace(/[^a-z0-9]/g,""):null}function Ne(o,n){let l=oe(o),a=oe(n);return!l||!a?!0:a==="utf16"?l==="utf16le"||l==="utf16be":l===a}function le(o,n){if(!(!o.strict||!o.encoding||!n||n.name!=="xml")){var l=H(n.body);l&&!Ne(o.encoding,l)&&S(o,"XML declaration encoding "+l+" does not match detected stream encoding "+o.encoding.toUpperCase())}}function k(o,n,l){o.textNode&&z(o),X(o,n,l)}function z(o){o.textNode=J(o.opt,o.textNode),o.textNode&&X(o,"ontext",o.textNode),o.textNode=""}function J(o,n){return o.trim&&(n=n.trim()),o.normalize&&(n=n.replace(/\s+/g," ")),n}function F(o,n){return z(o),o.trackPosition&&(n+=`
Line: `+o.line+`
Column: `+o.column+`
Char: `+o.c),n=new Error(n),o.error=n,X(o,"onerror",n),o}function de(o){return o.sawRoot&&!o.closedRoot&&S(o,"Unclosed root tag"),o.state!==c.BEGIN&&o.state!==c.BEGIN_WHITESPACE&&o.state!==c.TEXT&&F(o,"Unexpected end"),z(o),o.c="",o.closed=!0,X(o,"onend"),i.call(o,o.strict,o.opt),o}function S(o,n){if(typeof o!="object"||!(o instanceof i))throw new Error("bad call to strictFail");o.strict&&F(o,n)}function Tt(o){o.strict||(o.tagName=o.tagName[o.looseCase]());var n=o.tags[o.tags.length-1]||o,l=o.tag={name:o.tagName,attributes:{}};o.opt.xmlns&&(l.ns=n.ns),o.attribList.length=0,k(o,"onopentagstart",l)}function Ae(o,n){var l=o.indexOf(":"),a=l<0?["",o]:o.split(":"),C=a[0],R=a[1];return n&&o==="xmlns"&&(C="xmlns",R=""),{prefix:C,local:R}}function _e(o){if(o.strict||(o.attribName=o.attribName[o.looseCase]()),o.attribList.indexOf(o.attribName)!==-1||o.tag.attributes.hasOwnProperty(o.attribName)){o.attribName=o.attribValue="";return}if(o.opt.xmlns){var n=Ae(o.attribName,!0),l=n.prefix,a=n.local;if(l==="xmlns")if(a==="xml"&&o.attribValue!==_)S(o,"xml: prefix must be bound to "+_+`
Actual: `+o.attribValue);else if(a==="xmlns"&&o.attribValue!==v)S(o,"xmlns: prefix must be bound to "+v+`
Actual: `+o.attribValue);else{var C=o.tag,R=o.tags[o.tags.length-1]||o;C.ns===R.ns&&(C.ns=Object.create(R.ns)),C.ns[a]=o.attribValue}o.attribList.push([o.attribName,o.attribValue])}else o.tag.attributes[o.attribName]=o.attribValue,k(o,"onattribute",{name:o.attribName,value:o.attribValue});o.attribName=o.attribValue=""}function se(o,n){if(o.opt.xmlns){var l=o.tag,a=Ae(o.tagName);l.prefix=a.prefix,l.local=a.local,l.uri=l.ns[a.prefix]||"",l.prefix&&!l.uri&&(S(o,"Unbound namespace prefix: "+JSON.stringify(o.tagName)),l.uri=a.prefix);var C=o.tags[o.tags.length-1]||o;l.ns&&C.ns!==l.ns&&Object.keys(l.ns).forEach(function(Ge){k(o,"onopennamespace",{prefix:Ge,uri:l.ns[Ge]})});for(var R=0,M=o.attribList.length;R<M;R++){var G=o.attribList[R],q=G[0],ee=G[1],U=Ae(q,!0),te=U.prefix,Et=U.local,ze=te===""?"":l.ns[te]||"",Ie={name:q,value:ee,prefix:te,local:Et,uri:ze};te&&te!=="xmlns"&&!ze&&(S(o,"Unbound namespace prefix: "+JSON.stringify(te)),Ie.uri=te),o.tag.attributes[q]=Ie,k(o,"onattribute",Ie)}o.attribList.length=0}o.tag.isSelfClosing=!!n,o.sawRoot=!0,o.tags.push(o.tag),k(o,"onopentag",o.tag),n||(!o.noscript&&o.tagName.toLowerCase()==="script"?o.state=c.SCRIPT:o.state=c.TEXT,o.tag=null,o.tagName=""),o.attribName=o.attribValue="",o.attribList.length=0}function ke(o){if(!o.tagName){S(o,"Weird empty close tag."),o.textNode+="</>",o.state=c.TEXT;return}if(o.script){if(o.tagName!=="script"){o.script+="</"+o.tagName+">",o.tagName="",o.state=c.SCRIPT;return}k(o,"onscript",o.script),o.script=""}var n=o.tags.length,l=o.tagName;o.strict||(l=l[o.looseCase]());for(var a=l;n--;){var C=o.tags[n];if(C.name!==a)S(o,"Unexpected close tag");else break}if(n<0){S(o,"Unmatched closing tag: "+o.tagName),o.textNode+="</"+o.tagName+">",o.state=c.TEXT;return}o.tagName=l;for(var R=o.tags.length;R-- >n;){var M=o.tag=o.tags.pop();o.tagName=o.tag.name,k(o,"onclosetag",o.tagName);var G={};for(var q in M.ns)G[q]=M.ns[q];var ee=o.tags[o.tags.length-1]||o;o.opt.xmlns&&M.ns!==ee.ns&&Object.keys(M.ns).forEach(function(U){var te=M.ns[U];k(o,"onclosenamespace",{prefix:U,uri:te})})}n===0&&(o.closedRoot=!0),o.tagName=o.attribValue=o.attribName="",o.attribList.length=0,o.state=c.TEXT}function yt(o){var n=o.entity,l=n.toLowerCase(),a,C="";return o.ENTITIES[n]?o.ENTITIES[n]:o.ENTITIES[l]?o.ENTITIES[l]:(n=l,n.charAt(0)==="#"&&(n.charAt(1)==="x"?(n=n.slice(2),a=parseInt(n,16),C=a.toString(16)):(n=n.slice(1),a=parseInt(n,10),C=a.toString(10))),n=n.replace(/^0+/,""),isNaN(a)||C.toLowerCase()!==n||a<0||a>1114111?(S(o,"Invalid character entity"),"&"+o.entity+";"):String.fromCodePoint(a))}function He(o,n){n==="<"?(o.state=c.OPEN_WAKA,o.startTagPosition=o.position):$(n)||(S(o,"Non-whitespace before first tag."),o.textNode=n,o.state=c.TEXT)}function $e(o,n){var l="";return n<o.length&&(l=o.charAt(n)),l}function wt(o){var n=this;if(this.error)throw this.error;if(n.closed)return F(n,"Cannot write after close. Assign an onready handler.");if(o===null)return de(n);typeof o=="object"&&(o=o.toString());for(var l=0,a="";a=$e(o,l++),n.c=a,!!a;)switch(n.trackPosition&&(n.position++,a===`
`?(n.line++,n.column=0):n.column++),n.state){case c.BEGIN:if(n.state=c.BEGIN_WHITESPACE,a==="\uFEFF")continue;He(n,a);continue;case c.BEGIN_WHITESPACE:He(n,a);continue;case c.TEXT:if(n.sawRoot&&!n.closedRoot){for(var R=l-1;a&&a!=="<"&&a!=="&";)a=$e(o,l++),a&&n.trackPosition&&(n.position++,a===`
`?(n.line++,n.column=0):n.column++);n.textNode+=o.substring(R,l-1)}a==="<"&&!(n.sawRoot&&n.closedRoot&&!n.strict)?(n.state=c.OPEN_WAKA,n.startTagPosition=n.position):(!$(a)&&(!n.sawRoot||n.closedRoot)&&S(n,"Text data outside of root node."),a==="&"?n.state=c.TEXT_ENTITY:n.textNode+=a);continue;case c.SCRIPT:a==="<"?n.state=c.SCRIPT_ENDING:n.script+=a;continue;case c.SCRIPT_ENDING:a==="/"?n.state=c.CLOSE_TAG:(n.script+="<"+a,n.state=c.SCRIPT);continue;case c.OPEN_WAKA:if(a==="!")n.state=c.SGML_DECL,n.sgmlDecl="";else if(!$(a))if(O(x,a))n.state=c.OPEN_TAG,n.tagName=a;else if(a==="/")n.state=c.CLOSE_TAG,n.tagName="";else if(a==="?")n.state=c.PROC_INST,n.procInstName=n.procInstBody="";else{if(S(n,"Unencoded <"),n.startTagPosition+1<n.position){var C=n.position-n.startTagPosition;a=new Array(C).join(" ")+a}n.textNode+="<"+a,n.state=c.TEXT}continue;case c.SGML_DECL:if(n.sgmlDecl+a==="--"){n.state=c.COMMENT,n.comment="",n.sgmlDecl="";continue}n.doctype&&n.doctype!==!0&&n.sgmlDecl?(n.state=c.DOCTYPE_DTD,n.doctype+="<!"+n.sgmlDecl+a,n.sgmlDecl=""):(n.sgmlDecl+a).toUpperCase()===y?(k(n,"onopencdata"),n.state=c.CDATA,n.sgmlDecl="",n.cdata=""):(n.sgmlDecl+a).toUpperCase()===b?(n.state=c.DOCTYPE,(n.doctype||n.sawRoot)&&S(n,"Inappropriately located doctype declaration"),n.doctype="",n.sgmlDecl=""):a===">"?(k(n,"onsgmldeclaration",n.sgmlDecl),n.sgmlDecl="",n.state=c.TEXT):(Z(a)&&(n.state=c.SGML_DECL_QUOTED),n.sgmlDecl+=a);continue;case c.SGML_DECL_QUOTED:a===n.q&&(n.state=c.SGML_DECL,n.q=""),n.sgmlDecl+=a;continue;case c.DOCTYPE:a===">"?(n.state=c.TEXT,k(n,"ondoctype",n.doctype),n.doctype=!0):(n.doctype+=a,a==="["?n.state=c.DOCTYPE_DTD:Z(a)&&(n.state=c.DOCTYPE_QUOTED,n.q=a));continue;case c.DOCTYPE_QUOTED:n.doctype+=a,a===n.q&&(n.q="",n.state=c.DOCTYPE);continue;case c.DOCTYPE_DTD:a==="]"?(n.doctype+=a,n.state=c.DOCTYPE):a==="<"?(n.state=c.OPEN_WAKA,n.startTagPosition=n.position):Z(a)?(n.doctype+=a,n.state=c.DOCTYPE_DTD_QUOTED,n.q=a):n.doctype+=a;continue;case c.DOCTYPE_DTD_QUOTED:n.doctype+=a,a===n.q&&(n.state=c.DOCTYPE_DTD,n.q="");continue;case c.COMMENT:a==="-"?n.state=c.COMMENT_ENDING:n.comment+=a;continue;case c.COMMENT_ENDING:a==="-"?(n.state=c.COMMENT_ENDED,n.comment=J(n.opt,n.comment),n.comment&&k(n,"oncomment",n.comment),n.comment=""):(n.comment+="-"+a,n.state=c.COMMENT);continue;case c.COMMENT_ENDED:a!==">"?(S(n,"Malformed comment"),n.comment+="--"+a,n.state=c.COMMENT):n.doctype&&n.doctype!==!0?n.state=c.DOCTYPE_DTD:n.state=c.TEXT;continue;case c.CDATA:for(var R=l-1;a&&a!=="]";)a=$e(o,l++),a&&n.trackPosition&&(n.position++,a===`
`?(n.line++,n.column=0):n.column++);n.cdata+=o.substring(R,l-1),a==="]"&&(n.state=c.CDATA_ENDING);continue;case c.CDATA_ENDING:a==="]"?n.state=c.CDATA_ENDING_2:(n.cdata+="]"+a,n.state=c.CDATA);continue;case c.CDATA_ENDING_2:a===">"?(n.cdata&&k(n,"oncdata",n.cdata),k(n,"onclosecdata"),n.cdata="",n.state=c.TEXT):a==="]"?n.cdata+="]":(n.cdata+="]]"+a,n.state=c.CDATA);continue;case c.PROC_INST:a==="?"?n.state=c.PROC_INST_ENDING:$(a)?n.state=c.PROC_INST_BODY:n.procInstName+=a;continue;case c.PROC_INST_BODY:if(!n.procInstBody&&$(a))continue;a==="?"?n.state=c.PROC_INST_ENDING:n.procInstBody+=a;continue;case c.PROC_INST_ENDING:if(a===">"){let ee={name:n.procInstName,body:n.procInstBody};le(n,ee),k(n,"onprocessinginstruction",ee),n.procInstName=n.procInstBody="",n.state=c.TEXT}else n.procInstBody+="?"+a,n.state=c.PROC_INST_BODY;continue;case c.OPEN_TAG:O(E,a)?n.tagName+=a:(Tt(n),a===">"?se(n):a==="/"?n.state=c.OPEN_TAG_SLASH:($(a)||S(n,"Invalid character in tag name"),n.state=c.ATTRIB));continue;case c.OPEN_TAG_SLASH:a===">"?(se(n,!0),ke(n)):(S(n,"Forward-slash in opening tag not followed by >"),n.state=c.ATTRIB);continue;case c.ATTRIB:if($(a))continue;a===">"?se(n):a==="/"?n.state=c.OPEN_TAG_SLASH:O(x,a)?(n.attribName=a,n.attribValue="",n.state=c.ATTRIB_NAME):S(n,"Invalid attribute name");continue;case c.ATTRIB_NAME:a==="="?n.state=c.ATTRIB_VALUE:a===">"?(S(n,"Attribute without value"),n.attribValue=n.attribName,_e(n),se(n)):$(a)?n.state=c.ATTRIB_NAME_SAW_WHITE:O(E,a)?n.attribName+=a:S(n,"Invalid attribute name");continue;case c.ATTRIB_NAME_SAW_WHITE:if(a==="=")n.state=c.ATTRIB_VALUE;else{if($(a))continue;S(n,"Attribute without value"),n.tag.attributes[n.attribName]="",n.attribValue="",k(n,"onattribute",{name:n.attribName,value:""}),n.attribName="",a===">"?se(n):O(x,a)?(n.attribName=a,n.state=c.ATTRIB_NAME):(S(n,"Invalid attribute name"),n.state=c.ATTRIB)}continue;case c.ATTRIB_VALUE:if($(a))continue;Z(a)?(n.q=a,n.state=c.ATTRIB_VALUE_QUOTED):(n.opt.unquotedAttributeValues||F(n,"Unquoted attribute value"),n.state=c.ATTRIB_VALUE_UNQUOTED,n.attribValue=a);continue;case c.ATTRIB_VALUE_QUOTED:if(a!==n.q){a==="&"?n.state=c.ATTRIB_VALUE_ENTITY_Q:n.attribValue+=a;continue}_e(n),n.q="",n.state=c.ATTRIB_VALUE_CLOSED;continue;case c.ATTRIB_VALUE_CLOSED:$(a)?n.state=c.ATTRIB:a===">"?se(n):a==="/"?n.state=c.OPEN_TAG_SLASH:O(x,a)?(S(n,"No whitespace between attributes"),n.attribName=a,n.attribValue="",n.state=c.ATTRIB_NAME):S(n,"Invalid attribute name");continue;case c.ATTRIB_VALUE_UNQUOTED:if(!W(a)){a==="&"?n.state=c.ATTRIB_VALUE_ENTITY_U:n.attribValue+=a;continue}_e(n),a===">"?se(n):n.state=c.ATTRIB;continue;case c.CLOSE_TAG:if(n.tagName)a===">"?ke(n):O(E,a)?n.tagName+=a:n.script?(n.script+="</"+n.tagName+a,n.tagName="",n.state=c.SCRIPT):($(a)||S(n,"Invalid tagname in closing tag"),n.state=c.CLOSE_TAG_SAW_WHITE);else{if($(a))continue;ie(x,a)?n.script?(n.script+="</"+a,n.state=c.SCRIPT):S(n,"Invalid tagname in closing tag."):n.tagName=a}continue;case c.CLOSE_TAG_SAW_WHITE:if($(a))continue;a===">"?ke(n):S(n,"Invalid characters in closing tag");continue;case c.TEXT_ENTITY:case c.ATTRIB_VALUE_ENTITY_Q:case c.ATTRIB_VALUE_ENTITY_U:var M,G;switch(n.state){case c.TEXT_ENTITY:M=c.TEXT,G="textNode";break;case c.ATTRIB_VALUE_ENTITY_Q:M=c.ATTRIB_VALUE_QUOTED,G="attribValue";break;case c.ATTRIB_VALUE_ENTITY_U:M=c.ATTRIB_VALUE_UNQUOTED,G="attribValue";break}if(a===";"){var q=yt(n);n.opt.unparsedEntities&&!Object.values(e.XML_ENTITIES).includes(q)?((n.entityCount+=1)>n.opt.maxEntityCount&&F(n,"Parsed entity count exceeds max entity count"),(n.entityDepth+=1)>n.opt.maxEntityDepth&&F(n,"Parsed entity depth exceeds max entity depth"),n.entity="",n.state=M,n.write(q),n.entityDepth-=1):(n[G]+=q,n.entity="",n.state=M)}else O(n.entity.length?ne:D,a)?n.entity+=a:(S(n,"Invalid character in entity name"),n[G]+="&"+n.entity+a,n.entity="",n.state=M);continue;default:throw new Error(n,"Unknown state: "+n.state)}return n.position>=n.bufferCheckPosition&&s(n),n}String.fromCodePoint||function(){var o=String.fromCharCode,n=Math.floor,l=function(){var a=16384,C=[],R,M,G=-1,q=arguments.length;if(!q)return"";for(var ee="";++G<q;){var U=Number(arguments[G]);if(!isFinite(U)||U<0||U>1114111||n(U)!==U)throw RangeError("Invalid code point: "+U);U<=65535?C.push(U):(U-=65536,R=(U>>10)+55296,M=U%1024+56320,C.push(R,M)),(G+1===q||C.length>a)&&(ee+=o.apply(null,C),C.length=0)}return ee};Object.defineProperty?Object.defineProperty(String,"fromCodePoint",{value:l,configurable:!0,writable:!0}):String.fromCodePoint=l}()})(typeof be>"u"?be.sax={}:be)});var mn={};_t(mn,{activate:()=>cn});module.exports=kt(mn);var h=ve(require("vscode")),bt=require("child_process"),B=require("fs"),A=require("path");var T=ve(require("vscode"));var Ke=ve(je());var Ye={topic:"topic/topic",title:"topic/title",shortdesc:"topic/shortdesc",body:"topic/body",section:"topic/section",example:"topic/example",p:"topic/p",note:"topic/note",ul:"topic/ul",ol:"topic/ol",li:"topic/li",sl:"topic/sl",sli:"topic/sli",dl:"topic/dl",dlentry:"topic/dlentry",dt:"topic/dt",dd:"topic/dd",table:"topic/table",tgroup:"topic/tgroup",colspec:"topic/colspec",thead:"topic/thead",tbody:"topic/tbody",row:"topic/row",entry:"topic/entry",simpletable:"topic/simpletable",sthead:"topic/sthead",strow:"topic/strow",stentry:"topic/stentry",image:"topic/image",fig:"topic/fig",codeblock:"topic/codeblock",pre:"topic/pre",xref:"topic/xref",link:"topic/link",linktext:"topic/linktext",relatedLinks:"topic/related-links",b:"topic/b",i:"topic/i",u:"topic/u",tt:"topic/tt",sup:"topic/sup",sub:"topic/sub",q:"topic/q",lq:"topic/lq",keyword:"topic/keyword",term:"topic/term",uicontrol:"topic/uicontrol",wintitle:"topic/wintitle",menucascade:"topic/menucascade",filepath:"topic/filepath",userinput:"topic/userinput",systemoutput:"topic/systemoutput",apiname:"topic/apiname",option:"topic/option",parmname:"topic/parmname",cmdname:"topic/cmdname",varname:"topic/varname",msgnum:"topic/msgnum",ph:"topic/ph",draftComment:"topic/draft-comment",requiredCleanup:"topic/required-cleanup",data:"topic/data",dataAbout:"topic/data-about",foreign:"topic/foreign",state:"topic/state",codeph:"topic/codeph",coderef:"topic/coderef",synph:"topic/synph",kwd:"topic/kwd",var:"topic/var",oper:"topic/oper",sep:"topic/sep",delim:"topic/delim",fragment:"topic/fragment",fragref:"topic/fragref",synblk:"topic/synblk",synnote:"topic/synnote",synnoteref:"topic/synnoteref",syntaxdiagram:"topic/syntaxdiagram",screen:"topic/screen",msgph:"topic/msgph",msgblock:"topic/msgblock",lines:"topic/lines",fn:"topic/fn",cite:"topic/cite",boolean:"topic/boolean",tm:"topic/tm",indexterm:"topic/indexterm",indextermref:"topic/indextermref","index-see":"topic/index-see","index-see-also":"topic/index-see-also","index-sort-as":"topic/index-sort-as","index-base":"topic/index-base",div:"topic/div",sectiondiv:"topic/sectiondiv",bodydiv:"topic/bodydiv",desc:"topic/desc",alt:"topic/alt",parml:"topic/parml",plentry:"topic/plentry",pt:"topic/pt",pd:"topic/pd","abbreviated-form":"topic/abbreviated-form",glossterm:"topic/glossterm",glossdef:"topic/glossdef",glossentry:"topic/glossentry",glossref:"topic/glossref",glossgroup:"topic/glossgroup",hazardstatement:"topic/hazardstatement",typeofhazard:"topic/typeofhazard",hazardsymbol:"topic/hazardsymbol",howtoavoid:"topic/howtoavoid",consequence:"topic/consequence",object:"topic/object",param:"topic/param",anchor:"topic/anchor",anchorid:"topic/anchorid",anchorkey:"topic/anchorkey",anchorref:"topic/anchorref"};var Xe={map:"map/map",title:"map/map-title",topicmeta:"map/topicmeta",navtitle:"map/navtitle",linktext:"map/linktext",shortdesc:"map/shortdesc",keywords:"map/keywords",keyword:"map/keyword",topicref:"map/topicref",topichead:"map/topichead",topicgroup:"map/topicgroup",keydef:"map/keydef",reltable:"map/reltable",relheader:"map/relheader",relrow:"map/relrow",relcell:"map/relcell",relcolspec:"map/relcolspec",anchor:"map/anchor",navref:"map/navref",mapref:"map/mapref"};var $t=/^(topic|map)\//;function It(e){return function(i,s){let r=e[i];if(r)return r;if(s){let d=s.trim().split(/\s+/);for(let p of d)if($t.test(p))return p}}}function Rt(){return{startLine:0,startCol:0,endLine:0,endCol:0}}function Qe(e){let t=It(e);return function(s){let r=Ke.default.parser(!0,{trim:!1,normalize:!1}),d={type:"element",children:[],sourceRange:Rt()},p=[d],u="",m=0,f=0;function g(){if(u.length>0){let b=p[p.length-1];b&&b.children.push({type:"text",text:u,children:[],sourceRange:{startLine:m,startCol:f,endLine:r.line,endCol:r.column}}),u=""}}r.onopentag=b=>{g();let _=b.name,v=b.attributes.class,w=t(_,v),x=v?v.trim().split(/\s+/).filter(Boolean):void 0,E={type:"element",tagName:_,classTokens:x,baseType:w,attributes:b.attributes,children:[],sourceRange:{startLine:r.line,startCol:r.column,endLine:0,endCol:0}},D=p[p.length-1];D&&D.children.push(E),p.push(E)},r.onclosetag=()=>{g();let b=p.pop();b&&(b.sourceRange.endLine=r.line,b.sourceRange.endCol=r.column)},r.ontext=b=>{u.length===0&&(m=r.line,f=r.column),u+=b},r.onerror=b=>{throw new Error(`SAX parse error at line ${r.line}:${r.column}: ${b.message}`)},r.write(s).close();let y=d.children.find(b=>b.type==="element");if(!y)throw new Error("No root element found in DITA document");return{root:y,sourceRange:y.sourceRange}}}function K(e){let t=/<!ENTITY\s+(\S+)\s+"((?:[^"\\]|\\.)*)">/g,i,s=[];for(;(i=t.exec(e))!==null;)s.push([i[1],i[2]]);if(s.length===0)return e;let r=e.replace(t,"");for(let[d,p]of s)r=r.replace(new RegExp(`&${d};`,"g"),p);return r}var Lt=Qe(Ye),Ot=Qe(Xe);function ue(e){return Lt(e)}function re(e){return Ot(e)}function Ze(e){return e.parentBaseType==="topic/thead"}function I(e,t){return e.attributes?.[t]}function L(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Q(e,t){return t==null?"":` ${e}="${L(t)}"`}var Je={"topic/topic":(e,t,i)=>{let s=I(e,"id");return`<article${Q("id",s)} class="topic">${i(e,t)}</article>`},"topic/title":(e,t,i)=>{let s=Math.min(t.headingLevel,6);return`<h${s}>${i(e,t)}</h${s}>`},"topic/shortdesc":(e,t,i)=>`<p class="shortdesc">${i(e,t)}</p>`,"topic/body":(e,t,i)=>`<main class="body">${i(e,t)}</main>`,"topic/section":(e,t,i)=>{let s=I(e,"id");return`<section${Q("id",s)}>${i(e,t)}</section>`},"topic/example":(e,t,i)=>{let s=I(e,"id");return`<section${Q("id",s)} class="example">${i(e,t)}</section>`},"topic/p":(e,t,i)=>`<p>${i(e,t)}</p>`,"topic/note":(e,t,i)=>{let s=I(e,"type")||"note",d=(t.noteLabels||{note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"})[s]||s;return`<div class="note note--${L(s)}"><span class="note__label">${L(d)}:</span> ${i(e,t)}</div>`},"topic/ul":(e,t,i)=>`<ul>${i(e,t)}</ul>`,"topic/ol":(e,t,i)=>`<ol>${i(e,t)}</ol>`,"topic/li":(e,t,i)=>`<li>${i(e,t)}</li>`,"topic/sl":(e,t,i)=>`<ul class="simple-list">${i(e,t)}</ul>`,"topic/sli":(e,t,i)=>`<li>${i(e,t)}</li>`,"topic/dl":(e,t,i)=>`<dl>${i(e,t)}</dl>`,"topic/dlentry":(e,t,i)=>`<div class="dlentry">${i(e,t)}</div>`,"topic/dt":(e,t,i)=>`<dt>${i(e,t)}</dt>`,"topic/dd":(e,t,i)=>`<dd>${i(e,t)}</dd>`,"topic/table":(e,t,i)=>{let s=I(e,"id");return`<table${Q("id",s)} class="cals-table">${i(e,t)}</table>`},"topic/tgroup":(e,t,i)=>i(e,t),"topic/colspec":()=>"","topic/thead":(e,t,i)=>`<thead>${i(e,t)}</thead>`,"topic/tbody":(e,t,i)=>`<tbody>${i(e,t)}</tbody>`,"topic/row":(e,t,i)=>`<tr>${i(e,t)}</tr>`,"topic/entry":(e,t,i)=>{let s=Ze(t)?"th":"td";return`<${s}>${i(e,t)}</${s}>`},"topic/simpletable":(e,t,i)=>{let s=I(e,"id");return`<table${Q("id",s)} class="simple-table">${i(e,t)}</table>`},"topic/sthead":(e,t,i)=>`<thead>${i(e,t)}</thead>`,"topic/strow":(e,t,i)=>`<tr>${i(e,t)}</tr>`,"topic/stentry":(e,t,i)=>{let s=Ze(t)?"th":"td";return`<${s}>${i(e,t)}</${s}>`},"topic/image":(e,t)=>{let i=I(e,"href")||"",s=I(e,"alt")||"",r=I(e,"placement")||"inline",d=I(e,"width"),p=I(e,"height"),u=`${Q("width",d)}${Q("height",p)}`,m=i?t.asWebviewUri(i):"",f=r==="break"?' class="image-break"':"";return`<img src="${m||""}"${Q("alt",s)}${u}${f} loading="lazy" data-dita-src="${L(i)}">`},"topic/fig":(e,t,i)=>{let s=I(e,"id"),r=(e.children||[]).find(m=>m.type==="element"&&m.baseType==="topic/title"),d=(e.children||[]).filter(m=>!(m.type==="element"&&m.baseType==="topic/title")),p=i({...e,children:d},t),u=r?`<figcaption>${i(r,{...t,headingLevel:t.headingLevel+1})}</figcaption>`:"";return`<figure${Q("id",s)}>${p}${u}</figure>`},"topic/codeblock":(e,t,i)=>{let s=I(e,"outputclass")||"",r=s.replace(/^language-/,""),d=r?`<div class="codeblock-lang">${L(r)}</div>`:"";return`<pre class="codeblock ${L(s)}"><code>${i(e,t)}</code>${d}</pre>`},"topic/pre":(e,t,i)=>`<pre class="preformatted">${i(e,t)}</pre>`,"topic/xref":(e,t,i)=>{let s=I(e,"href")||"";if(!s)return"";let r;if(e.children.length>0)r=i(e,t);else if(s.startsWith("#")){let d=s.includes("/")?s.split("/").pop():s.slice(1);r=L(t.resolveTitle?.(d)??"")||L(s)}else s.includes("#")?r=L(t.resolveTitle?.(s)??"")||L(s):r=L(s);if(s.startsWith("#")){let d=s.includes("/")?"#"+s.split("/").pop():s;return`<a href="${L(d)}" class="xref">${r}</a>`}return`<span class="xref-external">\u2192 ${r}</span>`},"topic/link":(e,t,i)=>{let s=I(e,"href"),r=I(e,"keyref"),d=s||r||"";return d?`<a href="${L(d)}" class="link">${i(e,t)}</a>`:i(e,t)},"topic/linktext":(e,t,i)=>i(e,t),"topic/related-links":(e,t,i)=>`<aside class="related-links"><h2>Related links</h2>${i(e,t)}</aside>`,"topic/b":(e,t,i)=>`<strong>${i(e,t)}</strong>`,"topic/i":(e,t,i)=>`<em>${i(e,t)}</em>`,"topic/u":(e,t,i)=>`<u>${i(e,t)}</u>`,"topic/tt":(e,t,i)=>`<code>${i(e,t)}</code>`,"topic/sup":(e,t,i)=>`<sup>${i(e,t)}</sup>`,"topic/sub":(e,t,i)=>`<sub>${i(e,t)}</sub>`,"topic/q":(e,t,i)=>`<q>${i(e,t)}</q>`,"topic/lq":(e,t,i)=>`<blockquote>${i(e,t)}</blockquote>`,"topic/keyword":(e,t,i)=>`<span class="keyword">${i(e,t)}</span>`,"topic/term":(e,t,i)=>`<span class="term">${i(e,t)}</span>`,"topic/ph":(e,t,i)=>{let s=I(e,"keyref");if(s&&t.resolveKey){let r=t.resolveKey(s);return r?`<span class="ph">${L(r)}</span>`:`<span class="ph unresolved-keyref" title="Unresolved key: ${L(s)}">[${L(s)}]</span>`}return`<span class="ph">${i(e,t)}</span>`},"topic/uicontrol":(e,t,i)=>`<span class="uicontrol">${i(e,t)}</span>`,"topic/wintitle":(e,t,i)=>`<span class="wintitle">${i(e,t)}</span>`,"topic/menucascade":(e,t,i)=>`<span class="menucascade">${i(e,t)}</span>`,"topic/filepath":(e,t,i)=>`<span class="filepath">${i(e,t)}</span>`,"topic/userinput":(e,t,i)=>`<span class="userinput">${i(e,t)}</span>`,"topic/systemoutput":(e,t,i)=>`<span class="systemoutput">${i(e,t)}</span>`,"topic/apiname":(e,t,i)=>`<span class="apiname">${i(e,t)}</span>`,"topic/option":(e,t,i)=>`<span class="option">${i(e,t)}</span>`,"topic/parmname":(e,t,i)=>`<span class="parmname">${i(e,t)}</span>`,"topic/cmdname":(e,t,i)=>`<span class="cmdname">${i(e,t)}</span>`,"topic/varname":(e,t,i)=>`<span class="varname">${i(e,t)}</span>`,"topic/msgnum":(e,t,i)=>`<span class="msgnum">${i(e,t)}</span>`,"topic/codeph":(e,t,i)=>`<code class="codeph">${i(e,t)}</code>`,"topic/coderef":(e,t,i)=>`<span class="coderef">${i(e,t)}</span>`,"topic/synph":(e,t,i)=>`<span class="synph">${i(e,t)}</span>`,"topic/kwd":(e,t,i)=>`<span class="kwd">${i(e,t)}</span>`,"topic/var":(e,t,i)=>`<span class="var">${i(e,t)}</span>`,"topic/oper":(e,t,i)=>`<span class="oper">${i(e,t)}</span>`,"topic/sep":(e,t,i)=>`<span class="sep">${i(e,t)}</span>`,"topic/delim":(e,t,i)=>`<span class="delim">${i(e,t)}</span>`,"topic/fragment":(e,t,i)=>`<span class="fragment">${i(e,t)}</span>`,"topic/fragref":(e,t,i)=>`<span class="fragref">${i(e,t)}</span>`,"topic/synblk":(e,t,i)=>`<pre class="synblk">${i(e,t)}</pre>`,"topic/synnote":(e,t,i)=>`<div class="synnote">${i(e,t)}</div>`,"topic/synnoteref":(e,t,i)=>`<span class="synnoteref">${i(e,t)}</span>`,"topic/syntaxdiagram":(e,t,i)=>`<div class="syntaxdiagram">${i(e,t)}</div>`,"topic/screen":(e,t,i)=>`<pre class="screen">${i(e,t)}</pre>`,"topic/msgph":(e,t,i)=>`<span class="msgph">${i(e,t)}</span>`,"topic/msgblock":(e,t,i)=>`<pre class="msgblock">${i(e,t)}</pre>`,"topic/lines":(e,t,i)=>`<pre class="lines">${i(e,t)}</pre>`,"topic/fn":(e,t,i)=>{let s=I(e,"id");return`<sup class="fn${s?` fn-call-${L(s)}`:""}">${i(e,t)}</sup>`},"topic/cite":(e,t,i)=>`<cite>${i(e,t)}</cite>`,"topic/boolean":(e,t,i)=>{let s=I(e,"value")||"";return`<span class="boolean" data-value="${L(s)}">${L(s)||i(e,t)}</span>`},"topic/tm":(e,t,i)=>`<span class="tm">${i(e,t)}</span>`,"topic/indexterm":()=>"","topic/indextermref":()=>"","topic/index-see":()=>"","topic/index-see-also":()=>"","topic/index-sort-as":()=>"","topic/index-base":()=>"","topic/div":(e,t,i)=>`<div class="body-div">${i(e,t)}</div>`,"topic/sectiondiv":(e,t,i)=>`<div class="section-div">${i(e,t)}</div>`,"topic/bodydiv":(e,t,i)=>`<div class="body-div">${i(e,t)}</div>`,"topic/desc":(e,t,i)=>`<span class="desc">${i(e,t)}</span>`,"topic/alt":(e,t,i)=>`<span class="alt">${i(e,t)}</span>`,"topic/parml":(e,t,i)=>`<dl class="parml">${i(e,t)}</dl>`,"topic/plentry":(e,t,i)=>`<div class="plentry">${i(e,t)}</div>`,"topic/pt":(e,t,i)=>`<dt class="pt">${i(e,t)}</dt>`,"topic/pd":(e,t,i)=>`<dd class="pd">${i(e,t)}</dd>`,"topic/abbreviated-form":(e,t,i)=>{let s=I(e,"keyref");return s&&t.resolveKey?`<abbr class="abbreviated-form" title="${L(s)}">${L(t.resolveKey(s)||s)}</abbr>`:`<abbr class="abbreviated-form">${i(e,t)}</abbr>`},"topic/glossterm":(e,t,i)=>`<dfn class="glossterm">${i(e,t)}</dfn>`,"topic/glossdef":(e,t,i)=>`<dd class="glossdef">${i(e,t)}</dd>`,"topic/glossentry":(e,t,i)=>`<dl class="glossentry">${i(e,t)}</dl>`,"topic/glossref":(e,t,i)=>`<span class="glossref">${i(e,t)}</span>`,"topic/glossgroup":(e,t,i)=>`<div class="glossgroup">${i(e,t)}</div>`,"topic/hazardstatement":(e,t,i)=>`<div class="hazardstatement">${i(e,t)}</div>`,"topic/typeofhazard":(e,t,i)=>`<span class="typeofhazard">${i(e,t)}</span>`,"topic/hazardsymbol":()=>"","topic/howtoavoid":(e,t,i)=>`<p class="howtoavoid">${i(e,t)}</p>`,"topic/consequence":(e,t,i)=>`<p class="consequence">${i(e,t)}</p>`,"topic/object":(e,t,i)=>`<object class="dita-object">${i(e,t)}</object>`,"topic/param":()=>"","topic/anchor":e=>{let t=I(e,"id");return t?`<a${Q("id",t)}></a>`:""},"topic/anchorid":e=>{let t=I(e,"id");return t?`<span${Q("id",t)}></span>`:""},"topic/anchorkey":()=>"","topic/anchorref":()=>""};var Mt=new Set(["topic/section","topic/example","topic/fig","topic/related-links"]),Ft=new Set(["topic/tgroup","topic/link","topic/linktext"]);function Pt(e){return Mt.has(e)}function Bt(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function Ut(e,t,i){return e.replace(/^<([a-zA-Z][a-zA-Z0-9]*)/,`<$1 title="${t}" data-line="${i}"`)}function Vt(e,t){return{type:"text",text:e,children:[],sourceRange:t}}function Wt(e,t){let i=e.attributes?.conref;if(!i||!t.resolveConref)return e;let s=t.resolveConref(i);if(!s)return e;let{conref:r,...d}=e.attributes||{};return{...e,children:[Vt(s,e.sourceRange)],attributes:d}}function tt(e,t){if(e.type==="text")return Bt(e.text||"");let i=Wt(e,t),s=i.baseType,r=s?Je[s]:void 0,p=(s?Pt(s):!1)?t.headingLevel+1:t.headingLevel,u={...t,headingLevel:p,parentBaseType:s};if(r){let m=r(i,u,et);if(s&&!Ft.has(s)){let f=i.tagName||s.split("/").pop()||s;m=Ut(m,f,i.sourceRange.startLine)}return m}return et(i,u)}function et(e,t){return(e.children||[]).map(i=>tt(i,t)).join("")}function Te(e,t){return tt(e,t)}var P=require("fs"),N=require("path"),ct=require("crypto");var ae=require("fs"),me=require("path");function ye(e){return e.type==="text"?e.text||"":(e.children||[]).map(ye).join("")}function Re(e){let t=new Map;function i(s){if(s.type==="element"){let r=s.attributes?.id;if(r){let d=(s.children||[]).find(p=>p.type==="element"&&p.baseType==="topic/title");d&&t.set(r,ye(d))}for(let d of s.children||[])i(d)}}return i(e),t}function nt(e){let t=new Map;function i(d){let p=(0,me.resolve)(e,d);if(t.has(p))return t.get(p);if(!(0,ae.existsSync)(p)){t.set(p,void 0);return}try{let u=(0,ae.readFileSync)(p,"utf-8"),m=ue(K(u));return t.set(p,m.root),m.root}catch{t.set(p,void 0);return}}function s(d,p){if(d.attributes?.id===p)return d;for(let u of d.children||[]){let m=s(u,p);if(m)return m}}function r(d,p){let u=s(d,p);if(!u)return;let m=(u.children||[]).find(f=>f.type==="element"&&f.baseType==="topic/title");if(m)return ye(m)}return{loadFile:i,findElementById:s,findTitleOfElement:r}}function Le(e){let t=nt(e);function i(s){let r="";for(let d of s.children||[])d.type==="text"?r+=d.text||"":r+=i(d);return r}return s=>{let r=s.indexOf("#");if(r<0)return;let d=s.substring(0,r),u=s.substring(r+1).split("/"),m=u.length>1?u[1]:u[0],f=t.loadFile(d);if(!f)return;let g=t.findElementById(f,m);if(g)return i(g)}}function Oe(e){let t=nt(e);return i=>{let s=i.indexOf("#");if(s<0)return;let r=i.substring(0,s),p=i.substring(s+1).split("/")[0],u=t.loadFile(r);if(u)return t.findTitleOfElement(u,p)}}var Ht={note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"},zt={note:"\u6CE8",notice:"\u6CE8\u610F",warning:"\u8B66\u544A",danger:"\u5371\u9669",important:"\u91CD\u8981",tip:"\u63D0\u793A",restriction:"\u9650\u5236"};function Gt(e){return(e.attributes?.["xml:lang"]||"").startsWith("zh")?zt:Ht}function fe(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function qt(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function it(e,t){let i=Math.min(1+t,6);return`<div class="book-entry book-entry--placeholder">
  <h${i} class="book-section-heading">${qt(e)}</h${i}>
</div>`}function ot(e,t,i){let s=Math.min(1+i,6);return`<div class="book-entry book-entry--error">
  <h${s} class="book-entry-title">${fe(e)}</h${s}>
  <p class="book-error">${fe(t)}</p>
</div>`}function rt(e){return`<p class="book-skip">(Skipped: ${fe(e)} already included above)</p>`}function Me(e,t,i=ae.readFileSync,s){if(e.type!=="element")return;let r=e.attributes?.href,d=e.baseType;if(r&&r.endsWith(".ditamap")&&(d==="map/topicref"||d==="map/keydef")){let p=(0,me.resolve)(t,r);if(s||(s=new Set),s.has(p))return;s.add(p);try{let u=i(p,"utf-8"),f=(re(K(u)).root.children||[]).filter(g=>g.type==="element");f.length>0&&(e.children||(e.children=[]),e.children.push(...f))}catch{}}for(let p of e.children||[])Me(p,t,i,s)}function st(e){let{filePath:t,keyMap:i,asWebviewUri:s,headingLevel:r}=e;try{if(!(0,ae.existsSync)(t))return{html:"",error:`File not found: ${t}`};let d=(0,ae.readFileSync)(t,"utf-8"),p=K(d),u=ue(p),m=Re(u.root),f=Gt(u.root),g=(0,me.dirname)(t),y=Le(g),b=Oe(g),_=E=>{let D=m.get(E);if(D)return D;if(E.includes("#"))return b(E)},v=Te(u.root,{headingLevel:r,asWebviewUri:s,documentDir:g,resolveTitle:_,resolveKey:E=>i.get(E),resolveConref:E=>y(E),noteLabels:f}),w=(u.root.children||[]).find(E=>E.type==="element"&&E.baseType==="topic/title"),x=w?ye(w):void 0;return{html:v,title:x}}catch(d){let p=d instanceof Error?d.message:String(d);return{html:"",error:`Error rendering ${t}: ${p}`}}}function jt(){return`
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
`}var we=class{constructor(t){this.context=t}async resolveCustomTextEditor(t,i,s){let r=T.Uri.file((0,N.dirname)(t.uri.fsPath));i.webview.options={enableScripts:!0,localResourceRoots:[T.Uri.file(this.context.extensionPath),r,...(T.workspace.workspaceFolders||[]).map(v=>v.uri)]};let d=()=>T.window.visibleTextEditors.find(v=>v.document.uri.toString()===t.uri.toString()),p=v=>{i.webview.postMessage({type:"revealLine",line:v})},u=0;i.webview.onDidReceiveMessage(v=>{if(v.type==="refresh")_(),setTimeout(f,200);else if(v.type==="scrollSync"){let w=d();if(w){let x=w.visibleRanges[0]?.start.line;if(x!==void 0&&Math.abs(v.line-x)>=2){u=Date.now()+250;let D=Math.max(0,Math.min(v.line,t.lineCount-1));w.revealRange(new T.Range(D,0,D,0),T.TextEditorRevealType.AtTop),w.selection=new T.Selection(new T.Position(D,0),new T.Position(D,0))}}}else if(v.type==="navigateToLine"){let w=d();if(w){let x=Math.max(0,Math.min(v.line,t.lineCount-1));w.visibleRanges.some(D=>x>=D.start.line&&x<=D.end.line)||w.revealRange(new T.Range(x,0,x,0),T.TextEditorRevealType.AtTop),w.selection=new T.Selection(new T.Position(x,0),new T.Position(x,0))}}});let m=T.window.onDidChangeTextEditorSelection(v=>{if(v.textEditor.document.uri.toString()!==t.uri.toString()||Date.now()<u)return;let w=v.selections[0];!w||w.start.line!==w.end.line||i.webview.postMessage({type:"highlightLine",line:w.start.line})}),f=()=>{let v=d();if(v){let w=v.visibleRanges[0]?.start.line;w!==void 0&&p(w)}},g=T.window.onDidChangeTextEditorVisibleRanges(v=>{if(v.textEditor.document.uri.toString()===t.uri.toString()){if(Date.now()<u)return;let w=v.textEditor.visibleRanges[0]?.start.line;w!==void 0&&p(w)}}),y=T.workspace.onDidChangeTextDocument(v=>{v.document.uri.toString()===t.uri.toString()&&(_(),setTimeout(f,200))}),b=T.window.onDidChangeActiveColorTheme(()=>{_()}),_=()=>{let v=this.generateHtml(t,i.webview);i.webview.html=v};_(),setTimeout(f,300),i.onDidDispose(()=>{y.dispose(),g.dispose(),m.dispose(),b.dispose()})}generateHtml(t,i){let s=i.asWebviewUri(T.Uri.file((0,N.join)(this.context.extensionPath,"media","styles.css"))),r=(0,N.dirname)(t.uri.fsPath),d=T.Uri.file(r),p=u=>{try{let m=(0,N.resolve)(r,u),f=T.Uri.file(m),g=i.asWebviewUri(f);if(g)return g.toString()}catch{}try{let m=(0,N.resolve)(r,u);if((0,P.existsSync)(m)){let f=(0,P.readFileSync)(m),g=(0,N.extname)(u).toLowerCase();return`data:${g===".png"?"image/png":g===".jpg"||g===".jpeg"?"image/jpeg":g===".gif"?"image/gif":g===".svg"?"image/svg+xml":g===".webp"?"image/webp":"image/png"};base64,${f.toString("base64")}`}}catch{}return""};try{let u=t.getText(),m=K(u),f=ue(m),g=Re(f.root),_=(f.root.attributes?.["xml:lang"]||"").startsWith("zh")?{note:"\u6CE8",notice:"\u6CE8\u610F",warning:"\u8B66\u544A",danger:"\u5371\u9669",important:"\u91CD\u8981",tip:"\u63D0\u793A",restriction:"\u9650\u5236"}:{note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"},v=Pe(t.uri),w=Le(r),x=Oe(r),E=H=>{let oe=g.get(H);if(oe)return oe;if(H.includes("#"))return x(H)},D=Te(f.root,{headingLevel:1,asWebviewUri:p,documentDir:d.fsPath,resolveTitle:E,resolveKey:H=>v.get(H),resolveConref:H=>w(H),noteLabels:_}),{files:ne,defaultName:$}=Qt(t.uri),Z=ne[$]||"",W=T.window.activeColorTheme,O=W.kind===T.ColorThemeKind.Dark||W.kind===T.ColorThemeKind.HighContrast,ie=jt(),c=at(JSON.stringify(ne)),j=at(JSON.stringify($)),X=(0,ct.randomBytes)(16).toString("base64");return`<!DOCTYPE html>
<html lang="en"${O?' class="vscode-dark"':""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${i.cspSource} data:; style-src ${i.cspSource} 'unsafe-inline'; script-src 'nonce-${X}';">
<link rel="stylesheet" href="${s}">
${Z?`<style>
${Z}
</style>`:""}
<title>${t.fileName}</title>
<script nonce="${X}">window.__cssFiles=${c};window.__defaultCss=${j};</script>
</head>
<body>
${D}
<script nonce="${X}">${ie}</script>
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
</html>`}}};function Yt(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function at(e){return e.replace(/<\/script>/gi,"<\\/script>")}function Fe(e){let t=[],i=(0,N.dirname)(e.fsPath),s=Be(i),r=i;for(;r.length>=s.length;){try{for(let p of(0,P.readdirSync)(r))p.endsWith(".ditamap")&&t.push((0,N.join)(r,p))}catch{}if(t.length>0)return t;let d=(0,N.dirname)(r);if(d===r)break;r=d}return t}function lt(e){return e.type==="text"?e.text||"":(e.children||[]).map(lt).join("")}function Xt(e,t){for(let i of t){let s=(e.children||[]).find(r=>r.type==="element"&&r.baseType===i);if(s){let r=lt(s).trim();if(r)return r}}}function Kt(e){let t=(e.children||[]).find(i=>i.type==="element"&&i.baseType==="map/topicmeta");if(t)return Xt(t,["map/keyword","map/linktext","map/navtitle","map/shortdesc"])}function Pe(e){let t=new Map,i=Fe(e);for(let r of i)try{let m=function(f){if(f.type!=="element")return;let g=f.baseType;if((g==="map/topicref"||g==="map/keydef")&&f.attributes?.keys){let y=f.attributes.keys,b=Kt(f);t.set(y,b||y)}for(let y of f.children||[])m(y)};var s=m;let d=(0,P.readFileSync)(r,"utf-8"),u=re(K(d)).root;for(let f of u.children||[])m(f)}catch{}return t}function Qt(e){let t={},i=new Set,s=f=>{let g=(0,N.basename)(f);if(!i.has(g)&&(0,P.existsSync)(f))try{t[g]=(0,P.readFileSync)(f,"utf-8"),i.add(g)}catch{}},r=(0,N.dirname)(e.fsPath),d=Be(r),p=Zt(r),u=new Set;u.add(p),d!==p&&u.add(d);try{let g=T.workspace.getConfiguration("dita-viewer").get("cssDirectory");if(g)for(let y of g){let b=en(y,r);b&&(0,P.existsSync)(b)&&!u.has(b)&&u.add(b)}}catch{}for(let f of u)try{for(let g of(0,P.readdirSync)(f))g.toLowerCase().endsWith(".css")&&s((0,N.join)(f,g))}catch{}try{let g=T.workspace.getConfiguration("dita-viewer").get("customCss");if(g)for(let y of g){let b=Jt(y,r);b&&s(b)}}catch{}let m=t["custom.css"]?"custom.css":Object.keys(t)[0]||"";return{files:t,defaultName:m}}function Zt(e){let t=Be(e),i=e;for(;i.length>=t.length;){if((0,P.existsSync)((0,N.join)(i,"custom.css")))return i;let s=(0,N.dirname)(i);if(s===i)break;i=s}return e}function Be(e){let t=T.workspace.workspaceFolders;if(t&&t.length>0)return t[0].uri.fsPath;let i=e.includes("/")?"/":"\\",s=e.split(/[\\/]/);return i==="/"?"/"+s.slice(1,2).join("/"):s.length>2?s.slice(0,2).join("\\"):e}function Jt(e,t){if((0,N.isAbsolute)(e)&&(0,P.existsSync)(e))return e;let i=(0,N.resolve)(t,e);if((0,P.existsSync)(i))return i;let s=T.workspace.workspaceFolders;if(s)for(let r of s){let d=(0,N.resolve)(r.uri.fsPath,e);if((0,P.existsSync)(d))return d}}function en(e,t){if((0,N.isAbsolute)(e))return(0,P.existsSync)(e)?e:void 0;let i=(0,N.resolve)(t,e);if((0,P.existsSync)(i))return i;let s=T.workspace.workspaceFolders;if(s)for(let r of s){let d=(0,N.resolve)(r.uri.fsPath,e);if((0,P.existsSync)(d))return d}}var V=ve(require("vscode"));function pe(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function dt(e,t){return t==null?"":` ${e}="${pe(t)}"`}function ce(e,t){return e.attributes?.[t]}function xe(e){return e.type==="text"?e.text||"":(e.children||[]).map(xe).join("")}function pt(e,t){for(let i of t){let s=(e.children||[]).find(r=>r.type==="element"&&r.baseType===i);if(s){let r=xe(s).trim();if(r)return r}}}function Ue(e){let t=ce(e,"keys"),i=ce(e,"href"),s=(e.children||[]).find(r=>r.type==="element"&&r.baseType==="map/topicmeta");if(s){let r=pt(s,["map/navtitle","map/linktext","map/shortdesc"]);if(r)return r;let d=s.children.find(p=>p.type==="element"&&p.baseType==="map/keywords");if(d){let p=pt(d,["map/keyword"]);if(p)return p}}if(i){let r=i.replace(/\\/g,"/").split("/"),d=r[r.length-1]||"",p=d.lastIndexOf(".");return p>0?d.substring(0,p):d}return t||"(unnamed)"}function tn(e){return!!ce(e,"href")}function ge(e,t,i){return(e.children||[]).filter(s=>s.type==="element").map(s=>i(s,t)).join("")}function ut(e,t,i){let s=ce(e,"href")||"",r=ce(e,"keys")||"",d=Ue(e),p=tn(e),u=ge(e,t,i),m=p?'<span class="map-tree-icon map-tree-icon--file">\u{1F4C4}</span>':'<span class="map-tree-icon map-tree-icon--key">\u{1F511}</span>',f=pe(d),g=dt("data-keys",r),y=s?dt("data-href",s):"";return p?`<li class="map-tree-item map-tree-item--nav"${g}${y}>
      <a href="#" class="map-tree-link" data-href="${pe(s)}">${m}<span class="map-tree-label">${f}</span></a>
      ${u?`<ul class="map-tree">${u}</ul>`:""}
    </li>`:`<li class="map-tree-item map-tree-item--keydef"${g}${y}>
    ${m}<span class="map-tree-label map-tree-label--keydef">${f}</span>
    ${u?`<ul class="map-tree">${u}</ul>`:""}
  </li>`}var nn={"map/map":(e,t,i)=>{let s=e.children.find(u=>u.type==="element"&&u.baseType==="map/map-title"),r=s?`<h1 class="map-title">${pe(xe(s))}</h1>`:"",p=e.children.filter(u=>u.type!=="element"||u.baseType!=="map/map-title").filter(u=>u.type==="element").map(u=>i(u,t)).join("");return`<div class="ditamap-container">
      ${r}
      <ul class="map-tree">${p}</ul>
    </div>`},"map/map-title":(e,t,i)=>`<h1 class="map-title">${pe(xe(e))}</h1>`,"map/topicref":ut,"map/topichead":(e,t,i)=>{let s=Ue(e),r=ge(e,t,i);return`<li class="map-tree-item map-tree-item--head">
      <span class="map-tree-label map-tree-label--head">${pe(s)}</span>
      ${r?`<ul class="map-tree">${r}</ul>`:""}
    </li>`},"map/topicgroup":(e,t,i)=>`<li class="map-tree-item map-tree-item--group">
      <ul class="map-tree">${ge(e,t,i)}</ul>
    </li>`,"map/keydef":ut,"map/reltable":(e,t,i)=>`<div class="map-reltable"><h2 class="map-reltable-title">Related Information</h2>
      <table class="map-reltable-table"><tbody>${e.children.filter(d=>d.type==="element"&&(d.baseType==="map/relheader"||d.baseType==="map/relrow")).map(d=>i(d,t)).join("")}</tbody></table>
    </div>`,"map/relheader":(e,t,i)=>`<tr class="relheader">${e.children.filter(r=>r.type==="element"&&r.baseType==="map/relcell").map(r=>i(r,t)).map(r=>`<th>${r}</th>`).join("")}</tr>`,"map/relrow":(e,t,i)=>`<tr class="relrow">${e.children.filter(r=>r.type==="element"&&r.baseType==="map/relcell").map(r=>i(r,t)).map(r=>`<td>${r}</td>`).join("")}</tr>`,"map/relcell":(e,t,i)=>`<span class="relcell-content"><ul class="map-tree map-tree--inline">${ge(e,t,i)}</ul></span>`,"map/relcolspec":()=>"","map/topicmeta":()=>"","map/linktext":()=>"","map/navtitle":()=>"","map/shortdesc":()=>"","map/keywords":()=>"","map/keyword":()=>"","map/anchor":()=>"","map/navref":()=>"","map/mapref":()=>""};function Ee(e,t,i){if(e.type!=="element")return;let s=e.baseType;if(s!=="map/reltable")if(s==="map/topicref"||s==="map/keydef"||s==="map/topichead"){let r=ce(e,"href"),d=ce(e,"keys");i.push({href:r,displayName:Ue(e),depth:t,keys:d});for(let p of e.children||[])Ee(p,t+1,i)}else if(s==="map/topicgroup")for(let r of e.children||[])Ee(r,t,i);else for(let r of e.children||[])Ee(r,t,i)}function De(e){let t=[];for(let i of e.children||[])Ee(i,0,t);return t}function ft(e,t){function i(r,d){if(r.type==="text")return"";let p=r.baseType,u=p?nn[p]:void 0;return u?u(r,d,i):ge(r,d,i)}let s={docDir:t.docDir};return i(e,s)}var Y=require("path"),mt=require("crypto"),Se=require("fs");function on(){return`
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
`}var Ce=class{constructor(t){this.context=t}async resolveCustomTextEditor(t,i,s){let r=V.Uri.file((0,Y.dirname)(t.uri.fsPath)),d="tree";i.webview.options={enableScripts:!0,localResourceRoots:[V.Uri.file(this.context.extensionPath),r,...(V.workspace.workspaceFolders||[]).map(f=>f.uri)]},i.webview.onDidReceiveMessage(f=>{if(f.type==="refresh")m();else if(f.type==="openTopic"){let g=f.href;if(!g)return;let y=(0,Y.dirname)(t.uri.fsPath),b=(0,Y.resolve)(y,g),_=V.Uri.file(b),v=g.toLowerCase().endsWith(".ditamap")?"ditaViewer.mapPreview":"ditaViewer.preview";V.commands.executeCommand("vscode.openWith",_,v)}else f.type==="switchMode"&&(d=f.mode,m())});let p=V.workspace.onDidChangeTextDocument(f=>{f.document.uri.toString()===t.uri.toString()&&m()}),u=V.window.onDidChangeActiveColorTheme(()=>{m()}),m=()=>{let f=this.generateHtml(t,i.webview,d);i.webview.html=f};m(),i.onDidDispose(()=>{p.dispose(),u.dispose()})}generateHtml(t,i,s){let r=i.asWebviewUri(V.Uri.file((0,Y.join)(this.context.extensionPath,"media","styles.css"))),d=(0,Y.dirname)(t.uri.fsPath);try{let p=t.getText(),u=K(p),m=re(u);Me(m.root,d);let f;s==="book"?f=this.renderBookContent(m.root,t,i,d):f=ft(m.root,{docDir:d});let g=on(),y=(0,mt.randomBytes)(16).toString("base64"),b=V.window.activeColorTheme;return`<!DOCTYPE html>
<html lang="en"${b.kind===V.ColorThemeKind.Dark||b.kind===V.ColorThemeKind.HighContrast?' class="vscode-dark"':""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${i.cspSource} data:; style-src ${i.cspSource} 'unsafe-inline'; script-src 'nonce-${y}';">
<link rel="stylesheet" href="${r}">
<title>${t.fileName}</title>
</head>
<body class="mode-${s}">
${f}
<script nonce="${y}">${g}</script>
</body>
</html>`}catch(p){let u=p instanceof Error?p.message:String(p);return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Map Render Error</h2>
<pre>${fe(u)}</pre>
</div>
</body>
</html>`}}renderBookContent(t,i,s,r){let d=De(t),p=Pe(i.uri),u=new Set,m=[];for(let f of d)if(f.href){let g=(0,Y.resolve)(r,f.href);if(u.has(g)){m.push(rt(f.href));continue}u.add(g);let y=(0,Y.dirname)(g),b=w=>{try{let x=(0,Y.resolve)(y,w),E=V.Uri.file(x),D=s.asWebviewUri(E);if(D)return D.toString()}catch{}try{let x=(0,Y.resolve)(y,w);if((0,Se.existsSync)(x)){let E=(0,Se.readFileSync)(x),D=w.toLowerCase().split(".").pop()||"";return`data:${D==="png"?"image/png":D==="jpg"||D==="jpeg"?"image/jpeg":D==="gif"?"image/gif":D==="svg"?"image/svg+xml":D==="webp"?"image/webp":"image/png"};base64,${E.toString("base64")}`}}catch{}return""},_=Math.min(1+f.depth,6),v=st({filePath:g,keyMap:p,asWebviewUri:b,headingLevel:_});v.error?m.push(ot(f.displayName,v.error,f.depth)):m.push(`<div class="book-entry">${v.html}</div>`)}else m.push(it(f.displayName,f.depth));return`<div class="ditamap-book">${m.join(`
`)}</div>`}};function gt(e){if(e.configuredPath){let t=e.configuredPath.trim();if(e.fileExists(t))return{found:!0,location:{executablePath:t,source:"setting"}};let i=e.platform==="win32"?`${t}\\bin\\dita.bat`:`${t}/bin/dita`;return e.fileExists(i)?{found:!0,location:{executablePath:i,source:"setting"}}:{found:!1,reason:"setting-invalid"}}if(e.ditaHomeEnv){let t=e.platform==="win32"?`${e.ditaHomeEnv}\\bin\\dita.bat`:`${e.ditaHomeEnv}/bin/dita`;if(e.fileExists(t))return{found:!0,location:{executablePath:t,source:"env"}}}if(e.pathEnv){let t=e.platform==="win32"?";":":",i=e.pathEnv.split(t),s=e.platform==="win32"?"dita.bat":"dita";for(let r of i){if(!r)continue;let d=`${r}/${s}`.replace(/\\/g,"/");if(e.fileExists(d))return{found:!0,location:{executablePath:d,source:"path"}}}}return{found:!1,reason:"not-found"}}function ht(e){let t=["-i",e.mapPath,"-f",e.transtype,"-o",e.outputDir];return e.cssArg&&(t.push("--args.css",e.cssArg.filename),t.push("--args.cssroot",e.cssArg.root),t.push("--args.copycss","yes"),t.push("--args.csspath","css")),e.ditavalFile&&t.push("--filter",e.ditavalFile),t}var rn=/^.*?\[ERROR\]/i,sn=/^.*?\[WARN\]/i;function Ve(e){return rn.test(e)?"error":sn.test(e)?"warn":"info"}function vt(){let e="";return{processChunk(t){e+=t;let i=e.split(`
`);return e=i.pop()||"",i},flush(){let t=e;return e="",t?[t]:[]}}}var an="ditaViewer.transformWithDitaOt";function cn(e){e.subscriptions.push(h.window.registerCustomEditorProvider("ditaViewer.preview",new we(e),{webviewOptions:{retainContextWhenHidden:!0}})),e.subscriptions.push(h.window.registerCustomEditorProvider("ditaViewer.mapPreview",new Ce(e),{webviewOptions:{retainContextWhenHidden:!0}}));let t=h.commands.registerCommand("ditaViewer.showRendered",()=>{let r=h.window.activeTextEditor;r&&h.commands.executeCommand("vscode.openWith",r.document.uri,"ditaViewer.preview",h.ViewColumn.Beside)});e.subscriptions.push(t);let i=h.commands.registerCommand("ditaViewer.showMapRendered",()=>{let r=h.window.activeTextEditor;r&&h.commands.executeCommand("vscode.openWith",r.document.uri,"ditaViewer.mapPreview",h.ViewColumn.Beside)});e.subscriptions.push(i);let s=h.commands.registerCommand(an,async()=>{let r=new h.CancellationTokenSource,d=[];try{let p=await fn();if(!p){h.window.showErrorMessage("\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A .ditamap \u6587\u4EF6\u3002");return}let u=We(p.fsPath),m=(0,A.dirname)(u),f=h.workspace.getConfiguration("dita-viewer").get("ditaOtPath"),g=f&&f.trim()?f.trim():void 0,y=gt({configuredPath:g,ditaHomeEnv:process.env.DITA_HOME,pathEnv:process.env.PATH,platform:process.platform,fileExists:O=>(0,B.existsSync)(O)});if(!y.found){y.reason==="setting-invalid"?await h.window.showErrorMessage(`\u914D\u7F6E\u7684 DITA-OT \u8DEF\u5F84\u65E0\u6548\uFF1A${g} \u4E0B\u672A\u627E\u5230 dita \u53EF\u6267\u884C\u6587\u4EF6\u3002`,"\u6253\u5F00\u8BBE\u7F6E")==="\u6253\u5F00\u8BBE\u7F6E"&&h.commands.executeCommand("workbench.action.openSettings","dita-viewer.ditaOtPath"):await h.window.showErrorMessage("\u672A\u627E\u5230 DITA-OT\u3002\u8BF7\u5B89\u88C5 DITA-OT \u6216\u914D\u7F6E DITA_HOME \u73AF\u5883\u53D8\u91CF\u3002","\u67E5\u770B\u5B89\u88C5\u8BF4\u660E")==="\u67E5\u770B\u5B89\u88C5\u8BF4\u660E"&&h.env.openExternal(h.Uri.parse("https://www.dita-ot.org/documentation/installing"));return}let b=[{label:"html5",description:"HTML5 (\u9ED8\u8BA4)"},{label:"pdf",description:"PDF"},{label:"xhtml",description:"XHTML"},{label:"markdown",description:"Markdown"}],_=await h.window.showQuickPick(b,{placeHolder:"\u9009\u62E9\u8F93\u51FA\u683C\u5F0F\uFF08transtype\uFF09"});if(!_)return;let v=_.label,w=(0,A.join)(m,"out",v),x=await h.window.showOpenDialog({canSelectFolders:!0,canSelectFiles:!1,canSelectMany:!1,defaultUri:h.Uri.file(w),openLabel:"\u9009\u62E9\u8F93\u51FA\u76EE\u5F55"}),E=We(x&&x.length>0?x[0].fsPath:w);if((0,B.existsSync)(E))try{if((0,B.readdirSync)(E).length>0&&await h.window.showWarningMessage(`\u8F93\u51FA\u76EE\u5F55\u5DF2\u5B58\u5728\u4E14\u975E\u7A7A\uFF1A${E}\u3002\u662F\u5426\u8986\u76D6\uFF1F`,{modal:!0},"\u8986\u76D6")!=="\u8986\u76D6")return}catch{}let D;if(v==="html5"||v==="xhtml"){let O=un(m);if(O.length>0){let ie=[{label:"$(close) \u4E0D\u6DFB\u52A0\u81EA\u5B9A\u4E49 CSS",description:"\u4F7F\u7528 DITA-OT \u9ED8\u8BA4\u6837\u5F0F",css:void 0},...O.map(j=>({label:`$(file) ${(0,A.basename)(j)}`,description:(0,A.dirname)(j),css:{filename:(0,A.basename)(j),root:(0,A.dirname)(j)}}))],c=await h.window.showQuickPick(ie,{placeHolder:"\u9009\u62E9\u81EA\u5B9A\u4E49 CSS \u6587\u4EF6\uFF08\u53EF\u9009\uFF09",ignoreFocusOut:!1});c&&c.css&&(D=c.css)}}let ne,$=await h.window.showOpenDialog({canSelectFiles:!0,canSelectFolders:!1,canSelectMany:!1,filters:{"DITAVAL \u7B5B\u9009\u6587\u4EF6":["ditaval"]},openLabel:"\u9009\u62E9\u7B5B\u9009\u6587\u4EF6"});$&&$.length>0&&(ne=We($[0].fsPath));let Z=ht({mapPath:u,transtype:v,outputDir:E,cssArg:D,ditavalFile:ne}),W=h.window.createOutputChannel("DITA-OT Transform");d.push(h.Disposable.from({dispose:()=>W.dispose()},{dispose:()=>r.dispose()})),W.show(!0),await h.window.withProgress({location:h.ProgressLocation.Notification,title:`DITA-OT: \u6B63\u5728\u8F6C\u6362\u4E3A ${v}\uFF08\u9996\u6B21\u8F6C\u6362\u53EF\u80FD\u9700\u8981\u8F83\u957F\u65F6\u95F4\uFF09`,cancellable:!0},async(O,ie)=>(ie.onCancellationRequested(()=>{r.token.isCancellationRequested||r.cancel()}),new Promise((c,j)=>{let X=process.platform==="win32",H=(0,bt.spawn)(y.location.executablePath,Z,{shell:X}),oe=!1,Ne=r.token.onCancellationRequested(()=>{oe=!0,H.kill("SIGTERM"),setTimeout(()=>{try{H.kill("SIGKILL")}catch{}},3e3)});d.push(Ne);let le=0,k=vt();H.stdout?.on("data",z=>{W.append(z.toString())}),H.stderr?.on("data",z=>{let J=z.toString();W.append(J);let F=k.processChunk(J);for(let de of F)Ve(de)==="error"&&le++}),H.on("error",z=>{W.appendLine(`
[DITA-OT] \u8FDB\u7A0B\u542F\u52A8\u5931\u8D25: ${z.message}`),j(z)}),H.on("close",async z=>{for(let F of k.flush())Ve(F)==="error"&&le++;if(oe){W.appendLine(`
[DITA-OT] \u8F6C\u6362\u5DF2\u88AB\u7528\u6237\u53D6\u6D88\u3002`),c();return}if(z!==0){W.appendLine(`
[DITA-OT] \u8FDB\u7A0B\u9000\u51FA\uFF0C\u9000\u51FA\u7801: ${z}`),W.appendLine(`
[DITA-OT] \u547D\u4EE4: ${y.location.executablePath} ${Z.join(" ")}`),j(new Error(`DITA-OT \u9000\u51FA\u7801: ${z}`));return}if(W.appendLine(`
[DITA-OT] \u8F6C\u6362\u5B8C\u6210\u3002\u8F93\u51FA\u76EE\u5F55: ${E}`),v==="html5"||v==="xhtml")try{h.workspace.getConfiguration("dita-viewer").get("ditaOtInjectNavToolbar")&&(pn(u,E),W.appendLine(`
[DITA-OT] \u5BFC\u822A\u5DE5\u5177\u680F\u5DF2\u6CE8\u5165\u3002`))}catch(F){W.appendLine(`
[DITA-OT] \u5BFC\u822A\u5DE5\u5177\u680F\u6CE8\u5165\u5931\u8D25: ${F}`)}let J=le>0?`\uFF08\u68C0\u6D4B\u5230 ${le} \u4E2A\u9519\u8BEF\uFF09`:"";if(v==="html5"){let F=(0,A.join)(E,"index.html");(0,B.existsSync)(F)?await h.window.showInformationMessage(`DITA-OT \u8F6C\u6362\u5B8C\u6210${J}`,"\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00")==="\u5728\u6D4F\u89C8\u5668\u4E2D\u6253\u5F00"&&h.env.openExternal(h.Uri.file(F)):await h.window.showInformationMessage(`DITA-OT \u8F6C\u6362\u5B8C\u6210${J}`,"\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A")==="\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A"&&h.commands.executeCommand("revealFileInOS",h.Uri.file(E))}else await h.window.showInformationMessage(`DITA-OT \u8F6C\u6362\u5B8C\u6210${J}`,"\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A")==="\u5728\u6587\u4EF6\u7BA1\u7406\u5668\u4E2D\u663E\u793A"&&h.commands.executeCommand("revealFileInOS",h.Uri.file(E));c()})})))}catch(p){let u=p instanceof Error?p.message:String(p);await h.window.showErrorMessage(`DITA-OT \u8F6C\u6362\u5931\u8D25: ${u}`,"\u67E5\u770B\u8F93\u51FA\u65E5\u5FD7")==="\u67E5\u770B\u8F93\u51FA\u65E5\u5FD7"&&h.commands.executeCommand("workbench.action.output.toggleOutput")}finally{for(let p of d)try{p.dispose()}catch{}}});e.subscriptions.push(s)}function ln(e){let t=(0,B.readFileSync)(e,"utf-8"),i=re(K(t));return De(i.root).filter(r=>r.href&&r.href.toLowerCase().endsWith(".dita")).map(r=>({file:(0,A.basename)(r.href,(0,A.extname)(r.href))+".html",title:r.displayName}))}function dn(e){return`(function(){
var MANIFEST=${JSON.stringify(e)};
function cur(){var p=location.pathname;return p.substring(p.lastIndexOf('/')+1)||'index.html';}
var idx=-1;for(var i=0;i<MANIFEST.length;i++){if(MANIFEST[i].file===cur()){idx=i;break;}}
var s=document.createElement('style');
s.textContent='.dv-toolbar{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:999;display:flex;flex-direction:column;gap:2px;padding:4px;background:#fff;border:1px solid #ddd;border-right:none;border-radius:4px 0 0 4px;box-shadow:0 2px 6px rgba(0,0,0,.1)}.dv-toolbar button{cursor:pointer;border:1px solid #ccc;border-radius:3px;padding:6px 10px;background:#f8f8f8;font-size:16px;line-height:1}.dv-toolbar button:hover{background:#e8e8e8}.section.dv-collapsed>:not(.sectiontitle){display:none}';
document.head.appendChild(s);
var bar=document.createElement('div');bar.className='dv-toolbar';
var tb=document.createElement('button');tb.textContent='\xA7';
tb.title='\u6298\u53E0/\u5C55\u5F00\u7AE0\u8282';
tb.onclick=function(){document.querySelectorAll('section.section').forEach(function(sec){sec.classList.toggle('dv-collapsed');});};
bar.appendChild(tb);
if(idx>0){var pb=document.createElement('button');pb.textContent='\u2039';pb.title='\u4E0A\u4E00\u9875';pb.onclick=function(){location.href=MANIFEST[idx-1].file;};bar.appendChild(pb);}
if(idx>=0&&idx<MANIFEST.length-1){var nb=document.createElement('button');nb.textContent='\u203A';nb.title='\u4E0B\u4E00\u9875';nb.onclick=function(){location.href=MANIFEST[idx+1].file;};bar.appendChild(nb);}
document.body.appendChild(bar);
})();`}function pn(e,t){let i=ln(e);(0,B.writeFileSync)((0,A.join)(t,"dita-viewer-nav.js"),dn(i),"utf-8");function s(r){for(let d of(0,B.readdirSync)(r)){let p=(0,A.join)(r,d);try{if((0,B.statSync)(p).isDirectory()){s(p);continue}}catch{continue}if(!d.toLowerCase().endsWith(".html")||d.toLowerCase()==="index.html")continue;let u=(0,B.readFileSync)(p,"utf-8");if(u.includes("dita-viewer-nav.js"))continue;let f=p.substring(t.length).replace(/\\/g,"/").replace(/^\/+/,"").split("/").length-1,g=f>0?"../".repeat(f):"";u=u.replace("</body>",'<script src="'+g+'dita-viewer-nav.js"></script></body>'),(0,B.writeFileSync)(p,u,"utf-8")}}s(t)}function un(e){let t=new Map,i=new Set;i.add(e);let s=h.workspace.workspaceFolders?.[0]?.uri?.fsPath;s&&s!==e&&i.add(s);try{let r=h.workspace.getConfiguration("dita-viewer").get("cssDirectory");if(r)for(let d of r){let p=(0,A.isAbsolute)(d)?d:(0,A.resolve)(e,d);(0,B.existsSync)(p)&&i.add(p)}}catch{}for(let r of i)try{for(let d of(0,B.readdirSync)(r))d.toLowerCase().endsWith(".css")&&!t.has(d)&&t.set(d,(0,A.join)(r,d))}catch{}try{let r=h.workspace.getConfiguration("dita-viewer").get("customCss");if(r)for(let d of r){let p=(0,A.isAbsolute)(d)?d:(0,A.resolve)(e,d);(0,B.existsSync)(p)&&!t.has((0,A.basename)(p))&&t.set((0,A.basename)(p),p)}}catch{}return[...t.values()]}function We(e){return process.platform==="win32"&&/^[a-z]:/.test(e)?e[0].toUpperCase()+e.slice(1):e}async function fn(){let e=h.window.activeTextEditor;if(!e)return;let t=e.document.uri;if(t.fsPath.endsWith(".ditamap"))return t;if(t.fsPath.endsWith(".dita")){let i=Fe(t);if(i.length===0)return;if(i.length===1)return h.Uri.file(i[0]);let s=i.map(d=>({label:d,description:"\u9009\u62E9\u5173\u8054\u7684 DITA Map"})),r=await h.window.showQuickPick(s,{placeHolder:"\u627E\u5230\u591A\u4E2A DITA Map \u6587\u4EF6\uFF0C\u8BF7\u9009\u62E9\u8981\u4F7F\u7528\u7684\uFF1A"});return r?h.Uri.file(r.label):void 0}}0&&(module.exports={activate});
/*! Bundled license information:

sax/lib/sax.js:
  (*! http://mths.be/fromcodepoint v0.1.0 by @mathias *)
*/
