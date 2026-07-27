"use strict";var Rt=Object.create;var Te=Object.defineProperty;var It=Object.getOwnPropertyDescriptor;var Ot=Object.getOwnPropertyNames;var Lt=Object.getPrototypeOf,Ft=Object.prototype.hasOwnProperty;var Mt=(e,t)=>()=>(t||e((t={exports:{}}).exports,t),t.exports),Pt=(e,t)=>{for(var n in t)Te(e,n,{get:t[n],enumerable:!0})},Qe=(e,t,n,r)=>{if(t&&typeof t=="object"||typeof t=="function")for(let s of Ot(t))!Ft.call(e,s)&&s!==n&&Te(e,s,{get:()=>t[s],enumerable:!(r=It(t,s))||r.enumerable});return e};var we=(e,t,n)=>(n=e!=null?Rt(Lt(e)):{},Qe(t||!e||!e.__esModule?Te(n,"default",{value:e,enumerable:!0}):n,e)),Bt=e=>Qe(Te({},"__esModule",{value:!0}),e);var Ke=Mt(Ee=>{"use strict";(function(e){e.parser=function(o,i){return new n(o,i)},e.SAXParser=n,e.SAXStream=m,e.createStream=h,e.MAX_BUFFER_LENGTH=64*1024;var t=["comment","sgmlDecl","textNode","tagName","doctype","procInstName","procInstBody","entity","attribName","attribValue","cdata","script"];e.EVENTS=["text","processinginstruction","sgmldeclaration","doctype","comment","opentagstart","attribute","opentag","closetag","opencdata","cdata","closecdata","error","end","ready","script","opennamespace","closenamespace"];function n(o,i){if(!(this instanceof n))return new n(o,i);var d=this;s(d),d.q=d.c="",d.bufferCheckPosition=e.MAX_BUFFER_LENGTH,d.encoding=null,d.opt=i||{},d.opt.lowercase=d.opt.lowercase||d.opt.lowercasetags,d.looseCase=d.opt.lowercase?"toLowerCase":"toUpperCase",d.opt.maxEntityCount=d.opt.maxEntityCount||512,d.opt.maxEntityDepth=d.opt.maxEntityDepth||4,d.entityCount=d.entityDepth=0,d.tags=[],d.closed=d.closedRoot=d.sawRoot=!1,d.tag=d.error=null,d.strict=!!o,d.noscript=!!(o||d.opt.noscript),d.state=c.BEGIN,d.strictEntities=d.opt.strictEntities,d.ENTITIES=d.strictEntities?Object.create(e.XML_ENTITIES):Object.create(e.ENTITIES),d.attribList=[],d.opt.xmlns&&(d.ns=Object.create(I)),d.opt.unquotedAttributeValues===void 0&&(d.opt.unquotedAttributeValues=!o),d.trackPosition=d.opt.position!==!1,d.trackPosition&&(d.position=d.line=d.column=0),F(d,"onready")}Object.create||(Object.create=function(o){function i(){}i.prototype=o;var d=new i;return d}),Object.keys||(Object.keys=function(o){var i=[];for(var d in o)o.hasOwnProperty(d)&&i.push(d);return i});function r(o){for(var i=Math.max(e.MAX_BUFFER_LENGTH,10),d=0,a=0,k=t.length;a<k;a++){var M=o[t[a]].length;if(M>i)switch(t[a]){case"textNode":ce(o);break;case"cdata":$(o,"oncdata",o.cdata),o.cdata="";break;case"script":$(o,"onscript",o.script),o.script="";break;default:ie(o,"Max buffer length exceeded: "+t[a])}d=Math.max(d,M)}var W=e.MAX_BUFFER_LENGTH-d;o.bufferCheckPosition=W+o.position}function s(o){for(var i=0,d=t.length;i<d;i++)o[t[i]]=""}function l(o){ce(o),o.cdata!==""&&($(o,"oncdata",o.cdata),o.cdata=""),o.script!==""&&($(o,"onscript",o.script),o.script="")}n.prototype={end:function(){X(this)},write:_t,resume:function(){return this.error=null,this},close:function(){return this.write(null)},flush:function(){l(this)}};var u;try{u=require("stream").Stream}catch{u=function(){}}u||(u=function(){});var f=e.EVENTS.filter(function(o){return o!=="error"&&o!=="end"});function h(o,i){return new m(o,i)}function g(o,i){if(o.length>=2){if(o[0]===255&&o[1]===254)return"utf-16le";if(o[0]===254&&o[1]===255)return"utf-16be"}return o.length>=3&&o[0]===239&&o[1]===187&&o[2]===191?"utf8":o.length>=4?o[0]===60&&o[1]===0&&o[2]===63&&o[3]===0?"utf-16le":o[0]===0&&o[1]===60&&o[2]===0&&o[3]===63?"utf-16be":"utf8":i?"utf8":null}function m(o,i){if(!(this instanceof m))return new m(o,i);u.apply(this),this._parser=new n(o,i),this.writable=!0,this.readable=!0;var d=this;this._parser.onend=function(){d.emit("end")},this._parser.onerror=function(a){d.emit("error",a),d._parser.error=null},this._decoder=null,this._decoderBuffer=null,f.forEach(function(a){Object.defineProperty(d,"on"+a,{get:function(){return d._parser["on"+a]},set:function(k){if(!k)return d.removeAllListeners(a),d._parser["on"+a]=k,k;d.on(a,k)},enumerable:!0,configurable:!1})})}m.prototype=Object.create(u.prototype,{constructor:{value:m}}),m.prototype._decodeBuffer=function(o,i){if(this._decoderBuffer&&(o=Buffer.concat([this._decoderBuffer,o]),this._decoderBuffer=null),!this._decoder){var d=g(o,i);if(!d)return this._decoderBuffer=o,"";this._parser.encoding=d,this._decoder=new TextDecoder(d)}return this._decoder.decode(o,{stream:!i})},m.prototype.write=function(o){if(typeof Buffer=="function"&&typeof Buffer.isBuffer=="function"&&Buffer.isBuffer(o))o=this._decodeBuffer(o,!1);else if(this._decoderBuffer){var i=this._decodeBuffer(Buffer.alloc(0),!0);i&&(this._parser.write(i),this.emit("data",i))}return this._parser.write(o.toString()),this.emit("data",o),!0},m.prototype.end=function(o){if(o&&o.length&&this.write(o),this._decoderBuffer){var i=this._decodeBuffer(Buffer.alloc(0),!0);i&&(this._parser.write(i),this.emit("data",i))}else if(this._decoder){var d=this._decoder.decode();d&&(this._parser.write(d),this.emit("data",d))}return this._parser.end(),!0},m.prototype.on=function(o,i){var d=this;return!d._parser["on"+o]&&f.indexOf(o)!==-1&&(d._parser["on"+o]=function(){var a=arguments.length===1?[arguments[0]]:Array.apply(null,arguments);a.splice(0,0,o),d.emit.apply(d,a)}),u.prototype.on.call(d,o,i)};var T="[CDATA[",v="DOCTYPE",S="http://www.w3.org/XML/1998/namespace",R="http://www.w3.org/2000/xmlns/",I={xml:S,xmlns:R},E=/[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,N=/[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/,b=/[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,w=/[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/;function D(o){return o===" "||o===`
`||o==="\r"||o==="	"}function Q(o){return o==='"'||o==="'"}function z(o){return o===">"||D(o)}function G(o,i){return o.test(i)}function fe(o,i){return!G(o,i)}var c=0;e.STATE={BEGIN:c++,BEGIN_WHITESPACE:c++,TEXT:c++,TEXT_ENTITY:c++,OPEN_WAKA:c++,SGML_DECL:c++,SGML_DECL_QUOTED:c++,DOCTYPE:c++,DOCTYPE_QUOTED:c++,DOCTYPE_DTD:c++,DOCTYPE_DTD_QUOTED:c++,COMMENT_STARTING:c++,COMMENT:c++,COMMENT_ENDING:c++,COMMENT_ENDED:c++,CDATA:c++,CDATA_ENDING:c++,CDATA_ENDING_2:c++,PROC_INST:c++,PROC_INST_BODY:c++,PROC_INST_ENDING:c++,OPEN_TAG:c++,OPEN_TAG_SLASH:c++,ATTRIB:c++,ATTRIB_NAME:c++,ATTRIB_NAME_SAW_WHITE:c++,ATTRIB_VALUE:c++,ATTRIB_VALUE_QUOTED:c++,ATTRIB_VALUE_CLOSED:c++,ATTRIB_VALUE_UNQUOTED:c++,ATTRIB_VALUE_ENTITY_Q:c++,ATTRIB_VALUE_ENTITY_U:c++,CLOSE_TAG:c++,CLOSE_TAG_SAW_WHITE:c++,SCRIPT:c++,SCRIPT_ENDING:c++},e.XML_ENTITIES={amp:"&",gt:">",lt:"<",quot:'"',apos:"'"},e.ENTITIES={amp:"&",gt:">",lt:"<",quot:'"',apos:"'",AElig:198,Aacute:193,Acirc:194,Agrave:192,Aring:197,Atilde:195,Auml:196,Ccedil:199,ETH:208,Eacute:201,Ecirc:202,Egrave:200,Euml:203,Iacute:205,Icirc:206,Igrave:204,Iuml:207,Ntilde:209,Oacute:211,Ocirc:212,Ograve:210,Oslash:216,Otilde:213,Ouml:214,THORN:222,Uacute:218,Ucirc:219,Ugrave:217,Uuml:220,Yacute:221,aacute:225,acirc:226,aelig:230,agrave:224,aring:229,atilde:227,auml:228,ccedil:231,eacute:233,ecirc:234,egrave:232,eth:240,euml:235,iacute:237,icirc:238,igrave:236,iuml:239,ntilde:241,oacute:243,ocirc:244,ograve:242,oslash:248,otilde:245,ouml:246,szlig:223,thorn:254,uacute:250,ucirc:251,ugrave:249,uuml:252,yacute:253,yuml:255,copy:169,reg:174,nbsp:160,iexcl:161,cent:162,pound:163,curren:164,yen:165,brvbar:166,sect:167,uml:168,ordf:170,laquo:171,not:172,shy:173,macr:175,deg:176,plusmn:177,sup1:185,sup2:178,sup3:179,acute:180,micro:181,para:182,middot:183,cedil:184,ordm:186,raquo:187,frac14:188,frac12:189,frac34:190,iquest:191,times:215,divide:247,OElig:338,oelig:339,Scaron:352,scaron:353,Yuml:376,fnof:402,circ:710,tilde:732,Alpha:913,Beta:914,Gamma:915,Delta:916,Epsilon:917,Zeta:918,Eta:919,Theta:920,Iota:921,Kappa:922,Lambda:923,Mu:924,Nu:925,Xi:926,Omicron:927,Pi:928,Rho:929,Sigma:931,Tau:932,Upsilon:933,Phi:934,Chi:935,Psi:936,Omega:937,alpha:945,beta:946,gamma:947,delta:948,epsilon:949,zeta:950,eta:951,theta:952,iota:953,kappa:954,lambda:955,mu:956,nu:957,xi:958,omicron:959,pi:960,rho:961,sigmaf:962,sigma:963,tau:964,upsilon:965,phi:966,chi:967,psi:968,omega:969,thetasym:977,upsih:978,piv:982,ensp:8194,emsp:8195,thinsp:8201,zwnj:8204,zwj:8205,lrm:8206,rlm:8207,ndash:8211,mdash:8212,lsquo:8216,rsquo:8217,sbquo:8218,ldquo:8220,rdquo:8221,bdquo:8222,dagger:8224,Dagger:8225,bull:8226,hellip:8230,permil:8240,prime:8242,Prime:8243,lsaquo:8249,rsaquo:8250,oline:8254,frasl:8260,euro:8364,image:8465,weierp:8472,real:8476,trade:8482,alefsym:8501,larr:8592,uarr:8593,rarr:8594,darr:8595,harr:8596,crarr:8629,lArr:8656,uArr:8657,rArr:8658,dArr:8659,hArr:8660,forall:8704,part:8706,exist:8707,empty:8709,nabla:8711,isin:8712,notin:8713,ni:8715,prod:8719,sum:8721,minus:8722,lowast:8727,radic:8730,prop:8733,infin:8734,ang:8736,and:8743,or:8744,cap:8745,cup:8746,int:8747,there4:8756,sim:8764,cong:8773,asymp:8776,ne:8800,equiv:8801,le:8804,ge:8805,sub:8834,sup:8835,nsub:8836,sube:8838,supe:8839,oplus:8853,otimes:8855,perp:8869,sdot:8901,lceil:8968,rceil:8969,lfloor:8970,rfloor:8971,lang:9001,rang:9002,loz:9674,spades:9824,clubs:9827,hearts:9829,diams:9830},Object.keys(e.ENTITIES).forEach(function(o){var i=e.ENTITIES[o],d=typeof i=="number"?String.fromCharCode(i):i;e.ENTITIES[o]=d});for(var U in e.STATE)e.STATE[e.STATE[U]]=U;c=e.STATE;function F(o,i,d){o[i]&&o[i](d)}function B(o){var i=o&&o.match(/(?:^|\s)encoding\s*=\s*(['"])([^'"]+)\1/i);return i?i[2]:null}function j(o){return o?o.toLowerCase().replace(/[^a-z0-9]/g,""):null}function Re(o,i){let d=j(o),a=j(i);return!d||!a?!0:a==="utf16"?d==="utf16le"||d==="utf16be":d===a}function se(o,i){if(!(!o.strict||!o.encoding||!i||i.name!=="xml")){var d=B(i.body);d&&!Re(o.encoding,d)&&x(o,"XML declaration encoding "+d+" does not match detected stream encoding "+o.encoding.toUpperCase())}}function $(o,i,d){o.textNode&&ce(o),F(o,i,d)}function ce(o){o.textNode=le(o.opt,o.textNode),o.textNode&&F(o,"ontext",o.textNode),o.textNode=""}function le(o,i){return o.trim&&(i=i.trim()),o.normalize&&(i=i.replace(/\s+/g," ")),i}function ie(o,i){return ce(o),o.trackPosition&&(i+=`
Line: `+o.line+`
Column: `+o.column+`
Char: `+o.c),i=new Error(i),o.error=i,F(o,"onerror",i),o}function X(o){return o.sawRoot&&!o.closedRoot&&x(o,"Unclosed root tag"),o.state!==c.BEGIN&&o.state!==c.BEGIN_WHITESPACE&&o.state!==c.TEXT&&ie(o,"Unexpected end"),ce(o),o.c="",o.closed=!0,F(o,"onend"),n.call(o,o.strict,o.opt),o}function x(o,i){if(typeof o!="object"||!(o instanceof n))throw new Error("bad call to strictFail");o.strict&&ie(o,i)}function J(o){o.strict||(o.tagName=o.tagName[o.looseCase]());var i=o.tags[o.tags.length-1]||o,d=o.tag={name:o.tagName,attributes:{}};o.opt.xmlns&&(d.ns=i.ns),o.attribList.length=0,$(o,"onopentagstart",d)}function K(o,i){var d=o.indexOf(":"),a=d<0?["",o]:o.split(":"),k=a[0],M=a[1];return i&&o==="xmlns"&&(k="xmlns",M=""),{prefix:k,local:M}}function ge(o){if(o.strict||(o.attribName=o.attribName[o.looseCase]()),o.attribList.indexOf(o.attribName)!==-1||o.tag.attributes.hasOwnProperty(o.attribName)){o.attribName=o.attribValue="";return}if(o.opt.xmlns){var i=K(o.attribName,!0),d=i.prefix,a=i.local;if(d==="xmlns")if(a==="xml"&&o.attribValue!==S)x(o,"xml: prefix must be bound to "+S+`
Actual: `+o.attribValue);else if(a==="xmlns"&&o.attribValue!==R)x(o,"xmlns: prefix must be bound to "+R+`
Actual: `+o.attribValue);else{var k=o.tag,M=o.tags[o.tags.length-1]||o;k.ns===M.ns&&(k.ns=Object.create(M.ns)),k.ns[a]=o.attribValue}o.attribList.push([o.attribName,o.attribValue])}else o.tag.attributes[o.attribName]=o.attribValue,$(o,"onattribute",{name:o.attribName,value:o.attribValue});o.attribName=o.attribValue=""}function de(o,i){if(o.opt.xmlns){var d=o.tag,a=K(o.tagName);d.prefix=a.prefix,d.local=a.local,d.uri=d.ns[a.prefix]||"",d.prefix&&!d.uri&&(x(o,"Unbound namespace prefix: "+JSON.stringify(o.tagName)),d.uri=a.prefix);var k=o.tags[o.tags.length-1]||o;d.ns&&k.ns!==d.ns&&Object.keys(d.ns).forEach(function(Je){$(o,"onopennamespace",{prefix:Je,uri:d.ns[Je]})});for(var M=0,W=o.attribList.length;M<W;M++){var q=o.attribList[M],Y=q[0],oe=q[1],H=K(Y,!0),re=H.prefix,$t=H.local,Xe=re===""?"":d.ns[re]||"",Le={name:Y,value:oe,prefix:re,local:$t,uri:Xe};re&&re!=="xmlns"&&!Xe&&(x(o,"Unbound namespace prefix: "+JSON.stringify(re)),Le.uri=re),o.tag.attributes[Y]=Le,$(o,"onattribute",Le)}o.attribList.length=0}o.tag.isSelfClosing=!!i,o.sawRoot=!0,o.tags.push(o.tag),$(o,"onopentag",o.tag),i||(!o.noscript&&o.tagName.toLowerCase()==="script"?o.state=c.SCRIPT:o.state=c.TEXT,o.tag=null,o.tagName=""),o.attribName=o.attribValue="",o.attribList.length=0}function Ie(o){if(!o.tagName){x(o,"Weird empty close tag."),o.textNode+="</>",o.state=c.TEXT;return}if(o.script){if(o.tagName!=="script"){o.script+="</"+o.tagName+">",o.tagName="",o.state=c.SCRIPT;return}$(o,"onscript",o.script),o.script=""}var i=o.tags.length,d=o.tagName;o.strict||(d=d[o.looseCase]());for(var a=d;i--;){var k=o.tags[i];if(k.name!==a)x(o,"Unexpected close tag");else break}if(i<0){x(o,"Unmatched closing tag: "+o.tagName),o.textNode+="</"+o.tagName+">",o.state=c.TEXT;return}o.tagName=d;for(var M=o.tags.length;M-- >i;){var W=o.tag=o.tags.pop();o.tagName=o.tag.name,$(o,"onclosetag",o.tagName);var q={};for(var Y in W.ns)q[Y]=W.ns[Y];var oe=o.tags[o.tags.length-1]||o;o.opt.xmlns&&W.ns!==oe.ns&&Object.keys(W.ns).forEach(function(H){var re=W.ns[H];$(o,"onclosenamespace",{prefix:H,uri:re})})}i===0&&(o.closedRoot=!0),o.tagName=o.attribValue=o.attribName="",o.attribList.length=0,o.state=c.TEXT}function At(o){var i=o.entity,d=i.toLowerCase(),a,k="";return o.ENTITIES[i]?o.ENTITIES[i]:o.ENTITIES[d]?o.ENTITIES[d]:(i=d,i.charAt(0)==="#"&&(i.charAt(1)==="x"?(i=i.slice(2),a=parseInt(i,16),k=a.toString(16)):(i=i.slice(1),a=parseInt(i,10),k=a.toString(10))),i=i.replace(/^0+/,""),isNaN(a)||k.toLowerCase()!==i||a<0||a>1114111?(x(o,"Invalid character entity"),"&"+o.entity+";"):String.fromCodePoint(a))}function Ye(o,i){i==="<"?(o.state=c.OPEN_WAKA,o.startTagPosition=o.position):D(i)||(x(o,"Non-whitespace before first tag."),o.textNode=i,o.state=c.TEXT)}function Oe(o,i){var d="";return i<o.length&&(d=o.charAt(i)),d}function _t(o){var i=this;if(this.error)throw this.error;if(i.closed)return ie(i,"Cannot write after close. Assign an onready handler.");if(o===null)return X(i);typeof o=="object"&&(o=o.toString());for(var d=0,a="";a=Oe(o,d++),i.c=a,!!a;)switch(i.trackPosition&&(i.position++,a===`
`?(i.line++,i.column=0):i.column++),i.state){case c.BEGIN:if(i.state=c.BEGIN_WHITESPACE,a==="\uFEFF")continue;Ye(i,a);continue;case c.BEGIN_WHITESPACE:Ye(i,a);continue;case c.TEXT:if(i.sawRoot&&!i.closedRoot){for(var M=d-1;a&&a!=="<"&&a!=="&";)a=Oe(o,d++),a&&i.trackPosition&&(i.position++,a===`
`?(i.line++,i.column=0):i.column++);i.textNode+=o.substring(M,d-1)}a==="<"&&!(i.sawRoot&&i.closedRoot&&!i.strict)?(i.state=c.OPEN_WAKA,i.startTagPosition=i.position):(!D(a)&&(!i.sawRoot||i.closedRoot)&&x(i,"Text data outside of root node."),a==="&"?i.state=c.TEXT_ENTITY:i.textNode+=a);continue;case c.SCRIPT:a==="<"?i.state=c.SCRIPT_ENDING:i.script+=a;continue;case c.SCRIPT_ENDING:a==="/"?i.state=c.CLOSE_TAG:(i.script+="<"+a,i.state=c.SCRIPT);continue;case c.OPEN_WAKA:if(a==="!")i.state=c.SGML_DECL,i.sgmlDecl="";else if(!D(a))if(G(E,a))i.state=c.OPEN_TAG,i.tagName=a;else if(a==="/")i.state=c.CLOSE_TAG,i.tagName="";else if(a==="?")i.state=c.PROC_INST,i.procInstName=i.procInstBody="";else{if(x(i,"Unencoded <"),i.startTagPosition+1<i.position){var k=i.position-i.startTagPosition;a=new Array(k).join(" ")+a}i.textNode+="<"+a,i.state=c.TEXT}continue;case c.SGML_DECL:if(i.sgmlDecl+a==="--"){i.state=c.COMMENT,i.comment="",i.sgmlDecl="";continue}i.doctype&&i.doctype!==!0&&i.sgmlDecl?(i.state=c.DOCTYPE_DTD,i.doctype+="<!"+i.sgmlDecl+a,i.sgmlDecl=""):(i.sgmlDecl+a).toUpperCase()===T?($(i,"onopencdata"),i.state=c.CDATA,i.sgmlDecl="",i.cdata=""):(i.sgmlDecl+a).toUpperCase()===v?(i.state=c.DOCTYPE,(i.doctype||i.sawRoot)&&x(i,"Inappropriately located doctype declaration"),i.doctype="",i.sgmlDecl=""):a===">"?($(i,"onsgmldeclaration",i.sgmlDecl),i.sgmlDecl="",i.state=c.TEXT):(Q(a)&&(i.state=c.SGML_DECL_QUOTED),i.sgmlDecl+=a);continue;case c.SGML_DECL_QUOTED:a===i.q&&(i.state=c.SGML_DECL,i.q=""),i.sgmlDecl+=a;continue;case c.DOCTYPE:a===">"?(i.state=c.TEXT,$(i,"ondoctype",i.doctype),i.doctype=!0):(i.doctype+=a,a==="["?i.state=c.DOCTYPE_DTD:Q(a)&&(i.state=c.DOCTYPE_QUOTED,i.q=a));continue;case c.DOCTYPE_QUOTED:i.doctype+=a,a===i.q&&(i.q="",i.state=c.DOCTYPE);continue;case c.DOCTYPE_DTD:a==="]"?(i.doctype+=a,i.state=c.DOCTYPE):a==="<"?(i.state=c.OPEN_WAKA,i.startTagPosition=i.position):Q(a)?(i.doctype+=a,i.state=c.DOCTYPE_DTD_QUOTED,i.q=a):i.doctype+=a;continue;case c.DOCTYPE_DTD_QUOTED:i.doctype+=a,a===i.q&&(i.state=c.DOCTYPE_DTD,i.q="");continue;case c.COMMENT:a==="-"?i.state=c.COMMENT_ENDING:i.comment+=a;continue;case c.COMMENT_ENDING:a==="-"?(i.state=c.COMMENT_ENDED,i.comment=le(i.opt,i.comment),i.comment&&$(i,"oncomment",i.comment),i.comment=""):(i.comment+="-"+a,i.state=c.COMMENT);continue;case c.COMMENT_ENDED:a!==">"?(x(i,"Malformed comment"),i.comment+="--"+a,i.state=c.COMMENT):i.doctype&&i.doctype!==!0?i.state=c.DOCTYPE_DTD:i.state=c.TEXT;continue;case c.CDATA:for(var M=d-1;a&&a!=="]";)a=Oe(o,d++),a&&i.trackPosition&&(i.position++,a===`
`?(i.line++,i.column=0):i.column++);i.cdata+=o.substring(M,d-1),a==="]"&&(i.state=c.CDATA_ENDING);continue;case c.CDATA_ENDING:a==="]"?i.state=c.CDATA_ENDING_2:(i.cdata+="]"+a,i.state=c.CDATA);continue;case c.CDATA_ENDING_2:a===">"?(i.cdata&&$(i,"oncdata",i.cdata),$(i,"onclosecdata"),i.cdata="",i.state=c.TEXT):a==="]"?i.cdata+="]":(i.cdata+="]]"+a,i.state=c.CDATA);continue;case c.PROC_INST:a==="?"?i.state=c.PROC_INST_ENDING:D(a)?i.state=c.PROC_INST_BODY:i.procInstName+=a;continue;case c.PROC_INST_BODY:if(!i.procInstBody&&D(a))continue;a==="?"?i.state=c.PROC_INST_ENDING:i.procInstBody+=a;continue;case c.PROC_INST_ENDING:if(a===">"){let oe={name:i.procInstName,body:i.procInstBody};se(i,oe),$(i,"onprocessinginstruction",oe),i.procInstName=i.procInstBody="",i.state=c.TEXT}else i.procInstBody+="?"+a,i.state=c.PROC_INST_BODY;continue;case c.OPEN_TAG:G(N,a)?i.tagName+=a:(J(i),a===">"?de(i):a==="/"?i.state=c.OPEN_TAG_SLASH:(D(a)||x(i,"Invalid character in tag name"),i.state=c.ATTRIB));continue;case c.OPEN_TAG_SLASH:a===">"?(de(i,!0),Ie(i)):(x(i,"Forward-slash in opening tag not followed by >"),i.state=c.ATTRIB);continue;case c.ATTRIB:if(D(a))continue;a===">"?de(i):a==="/"?i.state=c.OPEN_TAG_SLASH:G(E,a)?(i.attribName=a,i.attribValue="",i.state=c.ATTRIB_NAME):x(i,"Invalid attribute name");continue;case c.ATTRIB_NAME:a==="="?i.state=c.ATTRIB_VALUE:a===">"?(x(i,"Attribute without value"),i.attribValue=i.attribName,ge(i),de(i)):D(a)?i.state=c.ATTRIB_NAME_SAW_WHITE:G(N,a)?i.attribName+=a:x(i,"Invalid attribute name");continue;case c.ATTRIB_NAME_SAW_WHITE:if(a==="=")i.state=c.ATTRIB_VALUE;else{if(D(a))continue;x(i,"Attribute without value"),i.tag.attributes[i.attribName]="",i.attribValue="",$(i,"onattribute",{name:i.attribName,value:""}),i.attribName="",a===">"?de(i):G(E,a)?(i.attribName=a,i.state=c.ATTRIB_NAME):(x(i,"Invalid attribute name"),i.state=c.ATTRIB)}continue;case c.ATTRIB_VALUE:if(D(a))continue;Q(a)?(i.q=a,i.state=c.ATTRIB_VALUE_QUOTED):(i.opt.unquotedAttributeValues||ie(i,"Unquoted attribute value"),i.state=c.ATTRIB_VALUE_UNQUOTED,i.attribValue=a);continue;case c.ATTRIB_VALUE_QUOTED:if(a!==i.q){a==="&"?i.state=c.ATTRIB_VALUE_ENTITY_Q:i.attribValue+=a;continue}ge(i),i.q="",i.state=c.ATTRIB_VALUE_CLOSED;continue;case c.ATTRIB_VALUE_CLOSED:D(a)?i.state=c.ATTRIB:a===">"?de(i):a==="/"?i.state=c.OPEN_TAG_SLASH:G(E,a)?(x(i,"No whitespace between attributes"),i.attribName=a,i.attribValue="",i.state=c.ATTRIB_NAME):x(i,"Invalid attribute name");continue;case c.ATTRIB_VALUE_UNQUOTED:if(!z(a)){a==="&"?i.state=c.ATTRIB_VALUE_ENTITY_U:i.attribValue+=a;continue}ge(i),a===">"?de(i):i.state=c.ATTRIB;continue;case c.CLOSE_TAG:if(i.tagName)a===">"?Ie(i):G(N,a)?i.tagName+=a:i.script?(i.script+="</"+i.tagName+a,i.tagName="",i.state=c.SCRIPT):(D(a)||x(i,"Invalid tagname in closing tag"),i.state=c.CLOSE_TAG_SAW_WHITE);else{if(D(a))continue;fe(E,a)?i.script?(i.script+="</"+a,i.state=c.SCRIPT):x(i,"Invalid tagname in closing tag."):i.tagName=a}continue;case c.CLOSE_TAG_SAW_WHITE:if(D(a))continue;a===">"?Ie(i):x(i,"Invalid characters in closing tag");continue;case c.TEXT_ENTITY:case c.ATTRIB_VALUE_ENTITY_Q:case c.ATTRIB_VALUE_ENTITY_U:var W,q;switch(i.state){case c.TEXT_ENTITY:W=c.TEXT,q="textNode";break;case c.ATTRIB_VALUE_ENTITY_Q:W=c.ATTRIB_VALUE_QUOTED,q="attribValue";break;case c.ATTRIB_VALUE_ENTITY_U:W=c.ATTRIB_VALUE_UNQUOTED,q="attribValue";break}if(a===";"){var Y=At(i);i.opt.unparsedEntities&&!Object.values(e.XML_ENTITIES).includes(Y)?((i.entityCount+=1)>i.opt.maxEntityCount&&ie(i,"Parsed entity count exceeds max entity count"),(i.entityDepth+=1)>i.opt.maxEntityDepth&&ie(i,"Parsed entity depth exceeds max entity depth"),i.entity="",i.state=W,i.write(Y),i.entityDepth-=1):(i[q]+=Y,i.entity="",i.state=W)}else G(i.entity.length?w:b,a)?i.entity+=a:(x(i,"Invalid character in entity name"),i[q]+="&"+i.entity+a,i.entity="",i.state=W);continue;default:throw new Error(i,"Unknown state: "+i.state)}return i.position>=i.bufferCheckPosition&&r(i),i}String.fromCodePoint||function(){var o=String.fromCharCode,i=Math.floor,d=function(){var a=16384,k=[],M,W,q=-1,Y=arguments.length;if(!Y)return"";for(var oe="";++q<Y;){var H=Number(arguments[q]);if(!isFinite(H)||H<0||H>1114111||i(H)!==H)throw RangeError("Invalid code point: "+H);H<=65535?k.push(H):(H-=65536,M=(H>>10)+55296,W=H%1024+56320,k.push(M,W)),(q+1===Y||k.length>a)&&(oe+=o.apply(null,k),k.length=0)}return oe};Object.defineProperty?Object.defineProperty(String,"fromCodePoint",{value:d,configurable:!0,writable:!0}):String.fromCodePoint=d}()})(typeof Ee>"u"?Ee.sax={}:Ee)});var Sn={};Pt(Sn,{activate:()=>yn});module.exports=Bt(Sn);var p=we(require("vscode")),kt=require("child_process"),L=require("fs"),_=require("path");var y=we(require("vscode"));var tt=we(Ke());var Ze={topic:"topic/topic",title:"topic/title",shortdesc:"topic/shortdesc",body:"topic/body",section:"topic/section",example:"topic/example",p:"topic/p",note:"topic/note",ul:"topic/ul",ol:"topic/ol",li:"topic/li",sl:"topic/sl",sli:"topic/sli",dl:"topic/dl",dlentry:"topic/dlentry",dt:"topic/dt",dd:"topic/dd",table:"topic/table",tgroup:"topic/tgroup",colspec:"topic/colspec",thead:"topic/thead",tbody:"topic/tbody",row:"topic/row",entry:"topic/entry",simpletable:"topic/simpletable",sthead:"topic/sthead",strow:"topic/strow",stentry:"topic/stentry",image:"topic/image",fig:"topic/fig",codeblock:"topic/codeblock",pre:"topic/pre",xref:"topic/xref",link:"topic/link",linktext:"topic/linktext",relatedLinks:"topic/related-links",b:"topic/b",i:"topic/i",u:"topic/u",tt:"topic/tt",sup:"topic/sup",sub:"topic/sub",q:"topic/q",lq:"topic/lq",keyword:"topic/keyword",term:"topic/term",uicontrol:"topic/uicontrol",wintitle:"topic/wintitle",menucascade:"topic/menucascade",filepath:"topic/filepath",userinput:"topic/userinput",systemoutput:"topic/systemoutput",apiname:"topic/apiname",option:"topic/option",parmname:"topic/parmname",cmdname:"topic/cmdname",varname:"topic/varname",msgnum:"topic/msgnum",ph:"topic/ph",draftComment:"topic/draft-comment",requiredCleanup:"topic/required-cleanup",data:"topic/data",dataAbout:"topic/data-about",foreign:"topic/foreign",state:"topic/state",codeph:"topic/codeph",coderef:"topic/coderef",synph:"topic/synph",kwd:"topic/kwd",var:"topic/var",oper:"topic/oper",sep:"topic/sep",delim:"topic/delim",fragment:"topic/fragment",fragref:"topic/fragref",synblk:"topic/synblk",synnote:"topic/synnote",synnoteref:"topic/synnoteref",syntaxdiagram:"topic/syntaxdiagram",screen:"topic/screen",msgph:"topic/msgph",msgblock:"topic/msgblock",lines:"topic/lines",fn:"topic/fn",cite:"topic/cite",boolean:"topic/boolean",tm:"topic/tm",indexterm:"topic/indexterm",indextermref:"topic/indextermref","index-see":"topic/index-see","index-see-also":"topic/index-see-also","index-sort-as":"topic/index-sort-as","index-base":"topic/index-base",div:"topic/div",sectiondiv:"topic/sectiondiv",bodydiv:"topic/bodydiv",desc:"topic/desc",alt:"topic/alt",parml:"topic/parml",plentry:"topic/plentry",pt:"topic/pt",pd:"topic/pd","abbreviated-form":"topic/abbreviated-form",glossterm:"topic/glossterm",glossdef:"topic/glossdef",glossentry:"topic/glossentry",glossref:"topic/glossref",glossgroup:"topic/glossgroup",hazardstatement:"topic/hazardstatement",typeofhazard:"topic/typeofhazard",hazardsymbol:"topic/hazardsymbol",howtoavoid:"topic/howtoavoid",consequence:"topic/consequence",object:"topic/object",param:"topic/param",anchor:"topic/anchor",anchorid:"topic/anchorid",anchorkey:"topic/anchorkey",anchorref:"topic/anchorref"};var et={map:"map/map",title:"map/map-title",topicmeta:"map/topicmeta",navtitle:"map/navtitle",linktext:"map/linktext",shortdesc:"map/shortdesc",keywords:"map/keywords",keyword:"map/keyword",topicref:"map/topicref",topichead:"map/topichead",topicgroup:"map/topicgroup",keydef:"map/keydef",reltable:"map/reltable",relheader:"map/relheader",relrow:"map/relrow",relcell:"map/relcell",relcolspec:"map/relcolspec",anchor:"map/anchor",navref:"map/navref",mapref:"map/mapref"};var Ut=/^(topic|map)\//;function Wt(e){return function(n,r){let s=e[n];if(s)return s;if(r){let l=r.trim().split(/\s+/);for(let u of l)if(Ut.test(u))return u}}}function Vt(){return{startLine:0,startCol:0,endLine:0,endCol:0}}function nt(e){let t=Wt(e);return function(r){let s=tt.default.parser(!0,{trim:!1,normalize:!1}),l={type:"element",children:[],sourceRange:Vt()},u=[l],f="",h=0,g=0;function m(){if(f.length>0){let v=u[u.length-1];v&&v.children.push({type:"text",text:f,children:[],sourceRange:{startLine:h,startCol:g,endLine:s.line,endCol:s.column}}),f=""}}s.onopentag=v=>{m();let S=v.name,R=v.attributes.class,I=t(S,R),E=R?R.trim().split(/\s+/).filter(Boolean):void 0,N={type:"element",tagName:S,classTokens:E,baseType:I,attributes:v.attributes,children:[],sourceRange:{startLine:s.line,startCol:s.column,endLine:0,endCol:0}},b=u[u.length-1];b&&b.children.push(N),u.push(N)},s.onclosetag=()=>{m();let v=u.pop();v&&(v.sourceRange.endLine=s.line,v.sourceRange.endCol=s.column)},s.ontext=v=>{f.length===0&&(h=s.line,g=s.column),f+=v},s.onerror=v=>{throw new Error(`SAX parse error at line ${s.line}:${s.column}: ${v.message}`)},s.write(r).close();let T=l.children.find(v=>v.type==="element");if(!T)throw new Error("No root element found in DITA document");return{root:T,sourceRange:T.sourceRange}}}function te(e){let t=/<!ENTITY\s+(\S+)\s+"((?:[^"\\]|\\.)*)">/g,n,r=[];for(;(n=t.exec(e))!==null;)r.push([n[1],n[2]]);if(r.length===0)return e;let s=e.replace(t,"");for(let[l,u]of r)s=s.replace(new RegExp(`&${l};`,"g"),u);return s}var Ht=nt(Ze),zt=nt(et);function he(e){return Ht(e)}function ae(e){return zt(e)}function it(e){return e.parentBaseType==="topic/thead"}function O(e,t){return e.attributes?.[t]}function P(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function ne(e,t){return t==null?"":` ${e}="${P(t)}"`}var ot={"topic/topic":(e,t,n)=>{let r=O(e,"id");return`<article${ne("id",r)} class="topic">${n(e,t)}</article>`},"topic/title":(e,t,n)=>{let r=Math.min(t.headingLevel,6);return`<h${r}>${n(e,t)}</h${r}>`},"topic/shortdesc":(e,t,n)=>`<p class="shortdesc">${n(e,t)}</p>`,"topic/body":(e,t,n)=>`<main class="body">${n(e,t)}</main>`,"topic/section":(e,t,n)=>{let r=O(e,"id");return`<section${ne("id",r)}>${n(e,t)}</section>`},"topic/example":(e,t,n)=>{let r=O(e,"id");return`<section${ne("id",r)} class="example">${n(e,t)}</section>`},"topic/p":(e,t,n)=>`<p>${n(e,t)}</p>`,"topic/note":(e,t,n)=>{let r=O(e,"type")||"note",l=(t.noteLabels||{note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"})[r]||r;return`<div class="note note--${P(r)}"><span class="note__label">${P(l)}:</span> ${n(e,t)}</div>`},"topic/ul":(e,t,n)=>`<ul>${n(e,t)}</ul>`,"topic/ol":(e,t,n)=>`<ol>${n(e,t)}</ol>`,"topic/li":(e,t,n)=>`<li>${n(e,t)}</li>`,"topic/sl":(e,t,n)=>`<ul class="simple-list">${n(e,t)}</ul>`,"topic/sli":(e,t,n)=>`<li>${n(e,t)}</li>`,"topic/dl":(e,t,n)=>`<dl>${n(e,t)}</dl>`,"topic/dlentry":(e,t,n)=>`<div class="dlentry">${n(e,t)}</div>`,"topic/dt":(e,t,n)=>`<dt>${n(e,t)}</dt>`,"topic/dd":(e,t,n)=>`<dd>${n(e,t)}</dd>`,"topic/table":(e,t,n)=>{let r=O(e,"id");return`<table${ne("id",r)} class="cals-table">${n(e,t)}</table>`},"topic/tgroup":(e,t,n)=>n(e,t),"topic/colspec":()=>"","topic/thead":(e,t,n)=>`<thead>${n(e,t)}</thead>`,"topic/tbody":(e,t,n)=>`<tbody>${n(e,t)}</tbody>`,"topic/row":(e,t,n)=>`<tr>${n(e,t)}</tr>`,"topic/entry":(e,t,n)=>{let r=it(t)?"th":"td";return`<${r}>${n(e,t)}</${r}>`},"topic/simpletable":(e,t,n)=>{let r=O(e,"id");return`<table${ne("id",r)} class="simple-table">${n(e,t)}</table>`},"topic/sthead":(e,t,n)=>`<thead>${n(e,t)}</thead>`,"topic/strow":(e,t,n)=>`<tr>${n(e,t)}</tr>`,"topic/stentry":(e,t,n)=>{let r=it(t)?"th":"td";return`<${r}>${n(e,t)}</${r}>`},"topic/image":(e,t)=>{let n=O(e,"href")||"",r=O(e,"alt")||"",s=O(e,"placement")||"inline",l=O(e,"width"),u=O(e,"height"),f=`${ne("width",l)}${ne("height",u)}`,h=n?t.asWebviewUri(n):"",g=s==="break"?' class="image-break"':"";return`<img src="${h||""}"${ne("alt",r)}${f}${g} loading="lazy" data-dita-src="${P(n)}">`},"topic/fig":(e,t,n)=>{let r=O(e,"id"),s=(e.children||[]).find(h=>h.type==="element"&&h.baseType==="topic/title"),l=(e.children||[]).filter(h=>!(h.type==="element"&&h.baseType==="topic/title")),u=n({...e,children:l},t),f=s?`<figcaption>${n(s,{...t,headingLevel:t.headingLevel+1})}</figcaption>`:"";return`<figure${ne("id",r)}>${u}${f}</figure>`},"topic/codeblock":(e,t,n)=>{let r=O(e,"outputclass")||"",s=r.replace(/^language-/,""),l=s?`<div class="codeblock-lang">${P(s)}</div>`:"";return`<pre class="codeblock ${P(r)}"><code>${n(e,t)}</code>${l}</pre>`},"topic/pre":(e,t,n)=>`<pre class="preformatted">${n(e,t)}</pre>`,"topic/xref":(e,t,n)=>{let r=O(e,"href")||"";if(!r)return"";let s;if(e.children.length>0)s=n(e,t);else if(r.startsWith("#")){let l=r.includes("/")?r.split("/").pop():r.slice(1);s=P(t.resolveTitle?.(l)??"")||P(r)}else r.includes("#")?s=P(t.resolveTitle?.(r)??"")||P(r):s=P(r);if(r.startsWith("#")){let l=r.includes("/")?"#"+r.split("/").pop():r;return`<a href="${P(l)}" class="xref">${s}</a>`}return`<span class="xref-external">\u2192 ${s}</span>`},"topic/link":(e,t,n)=>{let r=O(e,"href"),s=O(e,"keyref"),l=r||s||"";return l?`<a href="${P(l)}" class="link">${n(e,t)}</a>`:n(e,t)},"topic/linktext":(e,t,n)=>n(e,t),"topic/related-links":(e,t,n)=>`<aside class="related-links"><h2>Related links</h2>${n(e,t)}</aside>`,"topic/b":(e,t,n)=>`<strong>${n(e,t)}</strong>`,"topic/i":(e,t,n)=>`<em>${n(e,t)}</em>`,"topic/u":(e,t,n)=>`<u>${n(e,t)}</u>`,"topic/tt":(e,t,n)=>`<code>${n(e,t)}</code>`,"topic/sup":(e,t,n)=>`<sup>${n(e,t)}</sup>`,"topic/sub":(e,t,n)=>`<sub>${n(e,t)}</sub>`,"topic/q":(e,t,n)=>`<q>${n(e,t)}</q>`,"topic/lq":(e,t,n)=>`<blockquote>${n(e,t)}</blockquote>`,"topic/keyword":(e,t,n)=>`<span class="keyword">${n(e,t)}</span>`,"topic/term":(e,t,n)=>`<span class="term">${n(e,t)}</span>`,"topic/ph":(e,t,n)=>{let r=O(e,"keyref");if(r&&t.resolveKey){let s=t.resolveKey(r);return s?`<span class="ph">${P(s)}</span>`:`<span class="ph unresolved-keyref" title="Unresolved key: ${P(r)}">[${P(r)}]</span>`}return`<span class="ph">${n(e,t)}</span>`},"topic/uicontrol":(e,t,n)=>`<span class="uicontrol">${n(e,t)}</span>`,"topic/wintitle":(e,t,n)=>`<span class="wintitle">${n(e,t)}</span>`,"topic/menucascade":(e,t,n)=>`<span class="menucascade">${n(e,t)}</span>`,"topic/filepath":(e,t,n)=>`<span class="filepath">${n(e,t)}</span>`,"topic/userinput":(e,t,n)=>`<span class="userinput">${n(e,t)}</span>`,"topic/systemoutput":(e,t,n)=>`<span class="systemoutput">${n(e,t)}</span>`,"topic/apiname":(e,t,n)=>`<span class="apiname">${n(e,t)}</span>`,"topic/option":(e,t,n)=>`<span class="option">${n(e,t)}</span>`,"topic/parmname":(e,t,n)=>`<span class="parmname">${n(e,t)}</span>`,"topic/cmdname":(e,t,n)=>`<span class="cmdname">${n(e,t)}</span>`,"topic/varname":(e,t,n)=>`<span class="varname">${n(e,t)}</span>`,"topic/msgnum":(e,t,n)=>`<span class="msgnum">${n(e,t)}</span>`,"topic/codeph":(e,t,n)=>`<code class="codeph">${n(e,t)}</code>`,"topic/coderef":(e,t,n)=>`<span class="coderef">${n(e,t)}</span>`,"topic/synph":(e,t,n)=>`<span class="synph">${n(e,t)}</span>`,"topic/kwd":(e,t,n)=>`<span class="kwd">${n(e,t)}</span>`,"topic/var":(e,t,n)=>`<span class="var">${n(e,t)}</span>`,"topic/oper":(e,t,n)=>`<span class="oper">${n(e,t)}</span>`,"topic/sep":(e,t,n)=>`<span class="sep">${n(e,t)}</span>`,"topic/delim":(e,t,n)=>`<span class="delim">${n(e,t)}</span>`,"topic/fragment":(e,t,n)=>`<span class="fragment">${n(e,t)}</span>`,"topic/fragref":(e,t,n)=>`<span class="fragref">${n(e,t)}</span>`,"topic/synblk":(e,t,n)=>`<pre class="synblk">${n(e,t)}</pre>`,"topic/synnote":(e,t,n)=>`<div class="synnote">${n(e,t)}</div>`,"topic/synnoteref":(e,t,n)=>`<span class="synnoteref">${n(e,t)}</span>`,"topic/syntaxdiagram":(e,t,n)=>`<div class="syntaxdiagram">${n(e,t)}</div>`,"topic/screen":(e,t,n)=>`<pre class="screen">${n(e,t)}</pre>`,"topic/msgph":(e,t,n)=>`<span class="msgph">${n(e,t)}</span>`,"topic/msgblock":(e,t,n)=>`<pre class="msgblock">${n(e,t)}</pre>`,"topic/lines":(e,t,n)=>`<pre class="lines">${n(e,t)}</pre>`,"topic/fn":(e,t,n)=>{let r=O(e,"id");return`<sup class="fn${r?` fn-call-${P(r)}`:""}">${n(e,t)}</sup>`},"topic/cite":(e,t,n)=>`<cite>${n(e,t)}</cite>`,"topic/boolean":(e,t,n)=>{let r=O(e,"value")||"";return`<span class="boolean" data-value="${P(r)}">${P(r)||n(e,t)}</span>`},"topic/tm":(e,t,n)=>`<span class="tm">${n(e,t)}</span>`,"topic/indexterm":()=>"","topic/indextermref":()=>"","topic/index-see":()=>"","topic/index-see-also":()=>"","topic/index-sort-as":()=>"","topic/index-base":()=>"","topic/div":(e,t,n)=>`<div class="body-div">${n(e,t)}</div>`,"topic/sectiondiv":(e,t,n)=>`<div class="section-div">${n(e,t)}</div>`,"topic/bodydiv":(e,t,n)=>`<div class="body-div">${n(e,t)}</div>`,"topic/desc":(e,t,n)=>`<span class="desc">${n(e,t)}</span>`,"topic/alt":(e,t,n)=>`<span class="alt">${n(e,t)}</span>`,"topic/parml":(e,t,n)=>`<dl class="parml">${n(e,t)}</dl>`,"topic/plentry":(e,t,n)=>`<div class="plentry">${n(e,t)}</div>`,"topic/pt":(e,t,n)=>`<dt class="pt">${n(e,t)}</dt>`,"topic/pd":(e,t,n)=>`<dd class="pd">${n(e,t)}</dd>`,"topic/abbreviated-form":(e,t,n)=>{let r=O(e,"keyref");return r&&t.resolveKey?`<abbr class="abbreviated-form" title="${P(r)}">${P(t.resolveKey(r)||r)}</abbr>`:`<abbr class="abbreviated-form">${n(e,t)}</abbr>`},"topic/glossterm":(e,t,n)=>`<dfn class="glossterm">${n(e,t)}</dfn>`,"topic/glossdef":(e,t,n)=>`<dd class="glossdef">${n(e,t)}</dd>`,"topic/glossentry":(e,t,n)=>`<dl class="glossentry">${n(e,t)}</dl>`,"topic/glossref":(e,t,n)=>`<span class="glossref">${n(e,t)}</span>`,"topic/glossgroup":(e,t,n)=>`<div class="glossgroup">${n(e,t)}</div>`,"topic/hazardstatement":(e,t,n)=>`<div class="hazardstatement">${n(e,t)}</div>`,"topic/typeofhazard":(e,t,n)=>`<span class="typeofhazard">${n(e,t)}</span>`,"topic/hazardsymbol":()=>"","topic/howtoavoid":(e,t,n)=>`<p class="howtoavoid">${n(e,t)}</p>`,"topic/consequence":(e,t,n)=>`<p class="consequence">${n(e,t)}</p>`,"topic/object":(e,t,n)=>`<object class="dita-object">${n(e,t)}</object>`,"topic/param":()=>"","topic/anchor":e=>{let t=O(e,"id");return t?`<a${ne("id",t)}></a>`:""},"topic/anchorid":e=>{let t=O(e,"id");return t?`<span${ne("id",t)}></span>`:""},"topic/anchorkey":()=>"","topic/anchorref":()=>""};var Gt=new Set(["topic/section","topic/example","topic/fig","topic/related-links"]),jt=new Set(["topic/tgroup","topic/link","topic/linktext"]);function qt(e){return Gt.has(e)}function Yt(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function Xt(e,t,n){return e.replace(/^<([a-zA-Z][a-zA-Z0-9]*)/,`<$1 title="${t}" data-line="${n.startLine}" data-end-line="${n.endLine}" data-start-col="${n.startCol}" data-end-col="${n.endCol}"`)}function Jt(e,t){return{type:"text",text:e,children:[],sourceRange:t}}function Qt(e,t){let n=e.attributes?.conref;if(!n||!t.resolveConref)return e;let r=t.resolveConref(n);if(!r)return e;let s=Object.fromEntries(Object.entries(e.attributes||{}).filter(([l])=>l!=="conref"));return{...e,children:[Jt(r,e.sourceRange)],attributes:s}}function st(e,t){if(e.type==="text")return Yt(e.text||"");let n=Qt(e,t),r=n.baseType,s=r?ot[r]:void 0,u=(r?qt(r):!1)?t.headingLevel+1:t.headingLevel,f={...t,headingLevel:u,parentBaseType:r};if(s){let h=s(n,f,rt);if(r&&!jt.has(r)){let g=n.tagName||r.split("/").pop()||r;h=Xt(h,g,n.sourceRange)}return h}return rt(n,f)}function rt(e,t){return(e.children||[]).map(n=>st(n,t)).join("")}function Se(e,t){return st(e,t)}var V=require("fs"),A=require("path"),mt=require("crypto");var ue=require("fs"),Z=require("path");function xe(e){return e.type==="text"?e.text||"":(e.children||[]).map(xe).join("")}function Fe(e){let t=new Map;function n(r){if(r.type==="element"){let s=r.attributes?.id;if(s){let l=(r.children||[]).find(u=>u.type==="element"&&u.baseType==="topic/title");l&&t.set(s,xe(l))}for(let l of r.children||[])n(l)}}return n(e),t}function at(e){let t=new Map;function n(l){let u=(0,Z.resolve)(e,l);if(t.has(u))return t.get(u);if(!(0,ue.existsSync)(u)){t.set(u,void 0);return}try{let f=(0,ue.readFileSync)(u,"utf-8"),h=he(te(f));return t.set(u,h.root),h.root}catch{t.set(u,void 0);return}}function r(l,u){if(l.attributes?.id===u)return l;for(let f of l.children||[]){let h=r(f,u);if(h)return h}}function s(l,u){let f=r(l,u);if(!f)return;let h=(f.children||[]).find(g=>g.type==="element"&&g.baseType==="topic/title");if(h)return xe(h)}return{loadFile:n,findElementById:r,findTitleOfElement:s}}function Me(e){let t=at(e);function n(r){let s="";for(let l of r.children||[])l.type==="text"?s+=l.text||"":s+=n(l);return s}return r=>{let s=r.indexOf("#");if(s<0)return;let l=r.substring(0,s),f=r.substring(s+1).split("/"),h=f.length>1?f[1]:f[0],g=t.loadFile(l);if(!g)return;let m=t.findElementById(g,h);if(m)return n(m)}}function Pe(e){let t=at(e);return n=>{let r=n.indexOf("#");if(r<0)return;let s=n.substring(0,r),u=n.substring(r+1).split("/")[0],f=t.loadFile(s);if(f)return t.findTitleOfElement(f,u)}}var Kt={note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"},Zt={note:"\u6CE8",notice:"\u6CE8\u610F",warning:"\u8B66\u544A",danger:"\u5371\u9669",important:"\u91CD\u8981",tip:"\u63D0\u793A",restriction:"\u9650\u5236"};function en(e){return(e.attributes?.["xml:lang"]||"").startsWith("zh")?Zt:Kt}function ve(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function tn(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Be(e,t){let n=Math.min(1+t,6);return`<div class="book-entry book-entry--placeholder">
  <h${n} class="book-section-heading">${tn(e)}</h${n}>
</div>`}function ct(e,t,n){let r=Math.min(1+n,6);return`<div class="book-entry book-entry--error">
  <h${r} class="book-entry-title">${ve(e)}</h${r}>
  <p class="book-error">${ve(t)}</p>
</div>`}function lt(e){return`<p class="book-skip">(Skipped: ${ve(e)} already included above)</p>`}var nn=/^[a-z][a-z0-9+.-]*:/i;function dt(e,t){return!(!e||e.startsWith("#")||t==="external"||t==="peer"||nn.test(e)||(0,Z.isAbsolute)(e))}function on(e){if(e.type!=="element")return!1;let t=e.baseType;if(t!=="map/topicref"&&t!=="map/keydef"&&t!=="map/mapref")return!1;let n=e.attributes?.href;return!n||!dt(n,e.attributes?.scope)?!1:n.split("#")[0].toLowerCase().endsWith(".ditamap")||e.attributes?.format==="ditamap"}function ut(e,t,n){if(e.type!=="element")return;let r=e.attributes?.href;if(r&&e.attributes&&dt(r,e.attributes.scope)){let s=r.indexOf("#"),l=s>=0?r.substring(0,s):r,u=s>=0?r.substring(s):"";if(l){let f=(0,Z.resolve)(t,l);e.attributes.href=(0,Z.relative)(n,f).replace(/\\/g,"/")+u}}for(let s of e.children||[])ut(s,t,n)}function be(e,t,n=ue.readFileSync,r){if(e.type==="element"){if(on(e)){let s=e.attributes.href,l=(0,Z.resolve)(t,s.split("#")[0]);if(r||(r=new Set),r.has(l))return;r.add(l);try{let u=n(l,"utf-8"),h=(ae(te(u)).root.children||[]).filter(g=>g.type==="element");if(h.length>0){let g=(0,Z.dirname)(l);if(g!==(0,Z.resolve)(t))for(let m of h)ut(m,g,t);e.children||(e.children=[]),e.children.push(...h)}}catch{}}for(let s of e.children||[])be(s,t,n,r)}}function pt(e){let{filePath:t,keyMap:n,asWebviewUri:r,headingLevel:s}=e;try{if(!(0,ue.existsSync)(t))return{html:"",error:`File not found: ${t}`};let l=(0,ue.readFileSync)(t,"utf-8"),u=te(l),f=he(u),h=Fe(f.root),g=en(f.root),m=(0,Z.dirname)(t),T=Me(m),v=Pe(m),S=N=>{let b=h.get(N);if(b)return b;if(N.includes("#"))return v(N)},R=Se(f.root,{headingLevel:s,asWebviewUri:r,documentDir:m,resolveTitle:S,resolveKey:N=>n.get(N),resolveConref:N=>T(N),noteLabels:g}),I=(f.root.children||[]).find(N=>N.type==="element"&&N.baseType==="topic/title"),E=I?xe(I):void 0;return{html:R,title:E}}catch(l){let u=l instanceof Error?l.message:String(l);return{html:"",error:`Error rendering ${t}: ${u}`}}}var gt=new Map;function ht(e){return gt.get(e)}function rn(){let e={selectThemeCss:JSON.stringify(y.l10n.t("Select theme CSS")),decreaseFontSize:JSON.stringify(y.l10n.t("Decrease font size")),increaseFontSize:JSON.stringify(y.l10n.t("Increase font size")),fontSans:JSON.stringify(y.l10n.t("Sans")),fontSerif:JSON.stringify(y.l10n.t("Serif")),fontCurrentSans:JSON.stringify(y.l10n.t("Current: Sans-serif. Click to switch to Serif")),fontCurrentSerif:JSON.stringify(y.l10n.t("Current: Serif. Click to switch to Sans-serif")),pageWidth:JSON.stringify(y.l10n.t("Page width")),widthAuto:JSON.stringify(y.l10n.t("Auto")),widthFull:JSON.stringify(y.l10n.t("Full")),widthWide:JSON.stringify(y.l10n.t("Wide")),widthDesktop:JSON.stringify(y.l10n.t("Desktop")),widthNarrow:JSON.stringify(y.l10n.t("Narrow")),reloadContent:JSON.stringify(y.l10n.t("Reload DITA content"))};return`
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
    sel.title = ${e.selectThemeCss};
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
  fsDown.title = ${e.decreaseFontSize};
  fsDown.style.cssText = btnStyle + 'font-weight:bold;';
  fsDown.addEventListener('click', function() {
    fontSize = Math.max(60, fontSize - 10);
    document.body.style.fontSize = fontSize + '%';
  });
  toolbar.appendChild(fsDown);

  var fsUp = document.createElement('button');
  fsUp.innerHTML = 'A+';
  fsUp.title = ${e.increaseFontSize};
  fsUp.style.cssText = btnStyle + 'font-weight:bold;';
  fsUp.addEventListener('click', function() {
    fontSize = Math.min(200, fontSize + 10);
    document.body.style.fontSize = fontSize + '%';
  });
  toolbar.appendChild(fsUp);

  // Font toggle (serif / sans-serif)
  var isSerif = false;
  var fontBtn = document.createElement('button');
  fontBtn.textContent = ${e.fontSans};
  fontBtn.title = ${e.fontCurrentSans};
  fontBtn.style.cssText = btnStyle + 'font-size:11px;';
  fontBtn.addEventListener('click', function() {
    isSerif = !isSerif;
    fontBtn.textContent = isSerif ? ${e.fontSerif} : ${e.fontSans};
    fontBtn.title = isSerif ? ${e.fontCurrentSerif} : ${e.fontCurrentSans};
    document.body.style.fontFamily = isSerif ? "Georgia,'Times New Roman','Noto Serif SC','Songti SC',STSong,SimSun,serif" : '';
  });
  toolbar.appendChild(fontBtn);

  // Page width dropdown
  var widths = [
    { label: ${e.widthAuto}, value: '' },
    { label: ${e.widthFull}, value: '100%' },
    { label: ${e.widthWide}, value: '1400px' },
    { label: ${e.widthDesktop}, value: '1280px' },
    { label: ${e.widthNarrow}, value: '720px' },
  ];
  var wSel = document.createElement('select');
  wSel.title = ${e.pageWidth};
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
  refreshBtn.title = ${e.reloadContent};
  refreshBtn.style.cssText = btnStyle;
  refreshBtn.addEventListener('click', function() { vscode.postMessage({ type: 'refresh' }); });
  toolbar.appendChild(refreshBtn);

  document.body.appendChild(toolbar);
})();
`}var Ce=class{constructor(t){this.context=t}async resolveCustomTextEditor(t,n,r){let s=y.Uri.file((0,A.dirname)(t.uri.fsPath));n.webview.options={enableScripts:!0,localResourceRoots:[y.Uri.file(this.context.extensionPath),s,...(y.workspace.workspaceFolders||[]).map(b=>b.uri)]};let l=()=>y.window.visibleTextEditors.find(b=>b.document.uri.toString()===t.uri.toString()),u=!1,f=b=>{u||n.webview.postMessage({type:"revealLine",line:b})},h=0;n.webview.onDidReceiveMessage(b=>{if(b.type==="refresh")E(),setTimeout(m,200);else if(b.type==="scrollSync"){let w=l();if(w){let D=w.visibleRanges[0]?.start.line;if(D!==void 0&&Math.abs(b.line-D)>=2){h=Date.now()+250;let z=Math.max(0,Math.min(b.line,t.lineCount-1));w.revealRange(new y.Range(z,0,z,0),y.TextEditorRevealType.AtTop),w.selection=new y.Selection(new y.Position(z,0),new y.Position(z,0))}}}else if(b.type==="navigateToLine"){let w=l();if(w){let D=Math.max(0,Math.min(b.line,t.lineCount-1));w.visibleRanges.some(z=>D>=z.start.line&&D<=z.end.line)||w.revealRange(new y.Range(D,0,D,0),y.TextEditorRevealType.AtTop),w.selection=new y.Selection(new y.Position(D,0),new y.Position(D,0))}}});let g=y.window.onDidChangeTextEditorSelection(b=>{if(b.textEditor.document.uri.toString()!==t.uri.toString()||Date.now()<h)return;let w=b.selections[0];!w||w.start.line!==w.end.line||n.webview.postMessage({type:"highlightLine",line:w.start.line,col:w.start.character})}),m=()=>{let b=l();if(b){let w=b.visibleRanges[0]?.start.line;w!==void 0&&f(w)}},T,v=y.window.onDidChangeTextEditorVisibleRanges(b=>{b.textEditor.document.uri.toString()===t.uri.toString()&&(Date.now()<h||(T&&clearTimeout(T),T=setTimeout(()=>{let w=b.textEditor.visibleRanges[0]?.start.line;w!==void 0&&f(w)},120)))}),S,R=y.workspace.onDidChangeTextDocument(b=>{b.document.uri.toString()===t.uri.toString()&&(S&&clearTimeout(S),S=setTimeout(()=>{E(),setTimeout(m,200)},300))}),I=y.window.onDidChangeActiveColorTheme(()=>{E()}),E=()=>{if(u)return;let b=this.generateHtml(t,n.webview);n.webview.html=b,gt.set(t.uri.toString(),b)};E();let N=setTimeout(m,300);n.onDidDispose(()=>{u=!0,clearTimeout(N),T&&clearTimeout(T),S&&clearTimeout(S),R.dispose(),v.dispose(),g.dispose(),I.dispose()})}generateHtml(t,n){let r=n.asWebviewUri(y.Uri.file((0,A.join)(this.context.extensionPath,"media","styles.css"))),s=(0,A.dirname)(t.uri.fsPath),l=y.Uri.file(s),u=f=>{try{let h=(0,A.resolve)(s,f),g=y.Uri.file(h),m=n.asWebviewUri(g);if(m)return m.toString()}catch{}try{let h=(0,A.resolve)(s,f);if((0,V.existsSync)(h)){let g=(0,V.readFileSync)(h),m=(0,A.extname)(f).toLowerCase();return`data:${m===".png"?"image/png":m===".jpg"||m===".jpeg"?"image/jpeg":m===".gif"?"image/gif":m===".svg"?"image/svg+xml":m===".webp"?"image/webp":"image/png"};base64,${g.toString("base64")}`}}catch{}return""};try{let f=t.getText(),h=te(f),g=he(h),m=Fe(g.root),S=(g.root.attributes?.["xml:lang"]||"").startsWith("zh")?{note:"\u6CE8",notice:"\u6CE8\u610F",warning:"\u8B66\u544A",danger:"\u5371\u9669",important:"\u91CD\u8981",tip:"\u63D0\u793A",restriction:"\u9650\u5236"}:{note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"},R=Ve(t.uri),I=Me(s),E=Pe(s),N=B=>{let j=m.get(B);if(j)return j;if(B.includes("#"))return E(B)},b=Se(g.root,{headingLevel:1,asWebviewUri:u,documentDir:l.fsPath,resolveTitle:N,resolveKey:B=>R.get(B),resolveConref:B=>I(B),noteLabels:S}),{files:w,defaultName:D}=ln(t.uri),Q=w[D]||"",z=y.window.activeColorTheme,G=z.kind===y.ColorThemeKind.Dark||z.kind===y.ColorThemeKind.HighContrast,fe=rn(),c=ft(JSON.stringify(w)),U=ft(JSON.stringify(D)),F=(0,mt.randomBytes)(16).toString("base64");return`<!DOCTYPE html>
<html lang="en"${G?' class="vscode-dark"':""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${n.cspSource} data:; style-src ${n.cspSource} 'unsafe-inline'; script-src 'nonce-${F}';">
<link rel="stylesheet" href="${r}">
${Q?`<style>
${Q}
</style>`:""}
<title>${t.fileName}</title>
<script nonce="${F}">window.__cssFiles=${c};window.__defaultCss=${U};</script>
</head>
<body>
${b}
<script nonce="${F}">${fe}</script>
</body>
</html>`}catch(f){let h=f instanceof Error?f.message:String(f);return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Render Error</h2>
<pre>${sn(h)}</pre>
</div>
</body>
</html>`}}};function sn(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function ft(e){return e.replace(/<\/script>/gi,"<\\/script>")}function We(e,t=!0){let n=[],r=(0,A.dirname)(e.fsPath),s=He(r),l=r;for(;l.length>=s.length;){try{for(let f of(0,V.readdirSync)(l))f.endsWith(".ditamap")&&n.push((0,A.join)(l,f))}catch{}if(t&&n.length>0)return n;let u=(0,A.dirname)(l);if(u===l)break;l=u}return n}function Ue(e){return e.type==="text"?e.text||"":(e.children||[]).map(Ue).join("")}function an(e,t){for(let n of t){let r=(e.children||[]).find(l=>l.type==="element"&&l.baseType===n);if(r){let l=Ue(r).trim();if(l)return l}let s=(e.children||[]).find(l=>l.type==="element"&&l.baseType==="map/keywords");if(s){let l=(s.children||[]).find(u=>u.type==="element"&&u.baseType===n);if(l){let u=Ue(l).trim();if(u)return u}}}}function cn(e){let t=(e.children||[]).find(n=>n.type==="element"&&n.baseType==="map/topicmeta");if(t)return an(t,["map/keyword","map/linktext","map/navtitle","map/shortdesc"])}function Ve(e){let t=new Map,n=We(e,!1);for(let s of n)try{let h=function(g){if(g.type!=="element")return;let m=g.baseType;if((m==="map/topicref"||m==="map/keydef")&&g.attributes?.keys){let T=g.attributes.keys,v=cn(g);t.has(T)||t.set(T,v||T)}for(let T of g.children||[])h(T)};var r=h;let l=(0,V.readFileSync)(s,"utf-8"),f=ae(te(l)).root;be(f,(0,A.dirname)(s));for(let g of f.children||[])h(g)}catch{}return t}function ln(e){let t={},n=new Set,r=g=>{let m=(0,A.basename)(g);if(!n.has(m)&&(0,V.existsSync)(g))try{t[m]=(0,V.readFileSync)(g,"utf-8"),n.add(m)}catch{}},s=(0,A.dirname)(e.fsPath),l=He(s),u=dn(s),f=new Set;f.add(u),l!==u&&f.add(l);try{let m=y.workspace.getConfiguration("dita-viewer").get("cssDirectory");if(m)for(let T of m){let v=pn(T,s);v&&(0,V.existsSync)(v)&&!f.has(v)&&f.add(v)}}catch{}for(let g of f)try{for(let m of(0,V.readdirSync)(g))m.toLowerCase().endsWith(".css")&&r((0,A.join)(g,m))}catch{}try{let m=y.workspace.getConfiguration("dita-viewer").get("customCss");if(m)for(let T of m){let v=un(T,s);v&&r(v)}}catch{}let h=t["custom.css"]?"custom.css":Object.keys(t)[0]||"";return{files:t,defaultName:h}}function dn(e){let t=He(e),n=e;for(;n.length>=t.length;){if((0,V.existsSync)((0,A.join)(n,"custom.css")))return n;let r=(0,A.dirname)(n);if(r===n)break;n=r}return e}function He(e){let t=y.workspace.workspaceFolders;if(t&&t.length>0)return t[0].uri.fsPath;let n=e.includes("/")?"/":"\\",r=e.split(/[\\/]/);return n==="/"?"/"+r.slice(1,2).join("/"):r.length>2?r.slice(0,2).join("\\"):e}function un(e,t){if((0,A.isAbsolute)(e)&&(0,V.existsSync)(e))return e;let n=(0,A.resolve)(t,e);if((0,V.existsSync)(n))return n;let r=y.workspace.workspaceFolders;if(r)for(let s of r){let l=(0,A.resolve)(s.uri.fsPath,e);if((0,V.existsSync)(l))return l}}function pn(e,t){if((0,A.isAbsolute)(e))return(0,V.existsSync)(e)?e:void 0;let n=(0,A.resolve)(t,e);if((0,V.existsSync)(n))return n;let r=y.workspace.workspaceFolders;if(r)for(let s of r){let l=(0,A.resolve)(s.uri.fsPath,e);if((0,V.existsSync)(l))return l}}var C=we(require("vscode"));function me(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function vt(e,t){return t==null?"":` ${e}="${me(t)}"`}function pe(e,t){return e.attributes?.[t]}function Ne(e){return e.type==="text"?e.text||"":(e.children||[]).map(Ne).join("")}function bt(e,t){for(let n of t){let r=(e.children||[]).find(s=>s.type==="element"&&s.baseType===n);if(r){let s=Ne(r).trim();if(s)return s}}}function Ge(e){let t=pe(e,"keys"),n=pe(e,"href"),r=(e.children||[]).find(s=>s.type==="element"&&s.baseType==="map/topicmeta");if(r){let s=bt(r,["map/navtitle","map/linktext","map/shortdesc"]);if(s)return s;let l=r.children.find(u=>u.type==="element"&&u.baseType==="map/keywords");if(l){let u=bt(l,["map/keyword"]);if(u)return u}}if(n){let s=n.replace(/\\/g,"/").split("/"),l=s[s.length-1]||"",u=l.lastIndexOf(".");return u>0?l.substring(0,u):l}return t||"(unnamed)"}function fn(e){return!!pe(e,"href")}function ye(e,t,n){return(e.children||[]).filter(r=>r.type==="element").map(r=>n(r,t)).join("")}function ze(e,t,n){let r=pe(e,"href")||"",s=pe(e,"keys")||"",l=Ge(e),u=fn(e),f=ye(e,t,n),h=u?'<span class="map-tree-icon map-tree-icon--file">\u{1F4C4}</span>':'<span class="map-tree-icon map-tree-icon--key">\u{1F511}</span>',g=me(l),m=vt("data-keys",s),T=r?vt("data-href",r):"";return u?`<li class="map-tree-item map-tree-item--nav"${m}${T}>
      <a href="#" class="map-tree-link" data-href="${me(r)}">${h}<span class="map-tree-label">${g}</span></a>
      ${f?`<ul class="map-tree">${f}</ul>`:""}
    </li>`:`<li class="map-tree-item map-tree-item--keydef"${m}${T}>
    ${h}<span class="map-tree-label map-tree-label--keydef">${g}</span>
    ${f?`<ul class="map-tree">${f}</ul>`:""}
  </li>`}var mn={"map/map":(e,t,n)=>{let r=e.children.find(f=>f.type==="element"&&f.baseType==="map/map-title"),s=r?`<h1 class="map-title">${me(Ne(r))}</h1>`:"",u=e.children.filter(f=>f.type!=="element"||f.baseType!=="map/map-title").filter(f=>f.type==="element").map(f=>n(f,t)).join("");return`<div class="ditamap-container">
      ${s}
      <ul class="map-tree">${u}</ul>
    </div>`},"map/map-title":(e,t,n)=>`<h1 class="map-title">${me(Ne(e))}</h1>`,"map/topicref":ze,"map/topichead":(e,t,n)=>{let r=Ge(e),s=ye(e,t,n);return`<li class="map-tree-item map-tree-item--head">
      <span class="map-tree-label map-tree-label--head">${me(r)}</span>
      ${s?`<ul class="map-tree">${s}</ul>`:""}
    </li>`},"map/topicgroup":(e,t,n)=>`<li class="map-tree-item map-tree-item--group">
      <ul class="map-tree">${ye(e,t,n)}</ul>
    </li>`,"map/keydef":ze,"map/reltable":(e,t,n)=>`<div class="map-reltable"><h2 class="map-reltable-title">Related Information</h2>
      <table class="map-reltable-table"><tbody>${e.children.filter(l=>l.type==="element"&&(l.baseType==="map/relheader"||l.baseType==="map/relrow")).map(l=>n(l,t)).join("")}</tbody></table>
    </div>`,"map/relheader":(e,t,n)=>`<tr class="relheader">${e.children.filter(s=>s.type==="element"&&s.baseType==="map/relcell").map(s=>n(s,t)).map(s=>`<th>${s}</th>`).join("")}</tr>`,"map/relrow":(e,t,n)=>`<tr class="relrow">${e.children.filter(s=>s.type==="element"&&s.baseType==="map/relcell").map(s=>n(s,t)).map(s=>`<td>${s}</td>`).join("")}</tr>`,"map/relcell":(e,t,n)=>`<span class="relcell-content"><ul class="map-tree map-tree--inline">${ye(e,t,n)}</ul></span>`,"map/relcolspec":()=>"","map/topicmeta":()=>"","map/linktext":()=>"","map/navtitle":()=>"","map/shortdesc":()=>"","map/keywords":()=>"","map/keyword":()=>"","map/anchor":()=>"","map/navref":()=>"","map/mapref":ze};function De(e,t,n){if(e.type!=="element")return;let r=e.baseType;if(r!=="map/reltable")if(r==="map/topicref"||r==="map/keydef"||r==="map/mapref"||r==="map/topichead"){let s=pe(e,"href"),l=pe(e,"keys");n.push({href:s,displayName:Ge(e),depth:t,keys:l});for(let u of e.children||[])De(u,t+1,n)}else if(r==="map/topicgroup")for(let s of e.children||[])De(s,t,n);else for(let s of e.children||[])De(s,t,n)}function ke(e){let t=[];for(let n of e.children||[])De(n,0,t);return t}function yt(e,t){function n(s,l){if(s.type==="text")return"";let u=s.baseType,f=u?mn[u]:void 0;return f?f(s,l,n):ye(s,l,n)}let r={docDir:t.docDir};return n(e,r)}var ee=require("path"),Tt=require("crypto"),_e=require("fs"),wt=new Map;function Et(e){return wt.get(e)}function gn(){let e={decreaseFontSize:JSON.stringify(C.l10n.t("Decrease font size")),increaseFontSize:JSON.stringify(C.l10n.t("Increase font size")),fontSans:JSON.stringify(C.l10n.t("Sans")),fontSerif:JSON.stringify(C.l10n.t("Serif")),fontCurrentSans:JSON.stringify(C.l10n.t("Current: Sans-serif. Click to switch to Serif")),fontCurrentSerif:JSON.stringify(C.l10n.t("Current: Serif. Click to switch to Sans-serif")),pageWidth:JSON.stringify(C.l10n.t("Page width")),widthAuto:JSON.stringify(C.l10n.t("Auto")),widthFull:JSON.stringify(C.l10n.t("Full")),widthWide:JSON.stringify(C.l10n.t("Wide")),widthDesktop:JSON.stringify(C.l10n.t("Desktop")),widthNarrow:JSON.stringify(C.l10n.t("Narrow")),switchModeTitle:JSON.stringify(C.l10n.t("Switch between outline tree and full book view")),modeOutline:JSON.stringify(C.l10n.t("Outline")),modeBook:JSON.stringify(C.l10n.t("Book")),reloadContent:JSON.stringify(C.l10n.t("Reload DITA content"))};return`
(function() {
  var vscode = acquireVsCodeApi();
  // The whole HTML document is regenerated on every mode switch, so derive
  // the current mode from the body class instead of a hardcoded default \u2014
  // otherwise the script's state resets to 'tree' while the extension is in
  // 'book' mode and the toggle can never switch back.
  var currentMode = document.body.classList.contains('mode-book') ? 'book' : 'tree';

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
  fsDown.title = ${e.decreaseFontSize};
  fsDown.style.cssText = btnStyle + 'font-weight:bold;';
  fsDown.addEventListener('click', function() {
    fontSize = Math.max(60, fontSize - 10);
    document.body.style.fontSize = fontSize + '%';
  });
  toolbar.appendChild(fsDown);

  var fsUp = document.createElement('button');
  fsUp.innerHTML = 'A+';
  fsUp.title = ${e.increaseFontSize};
  fsUp.style.cssText = btnStyle + 'font-weight:bold;';
  fsUp.addEventListener('click', function() {
    fontSize = Math.min(200, fontSize + 10);
    document.body.style.fontSize = fontSize + '%';
  });
  toolbar.appendChild(fsUp);

  // Font toggle (serif / sans-serif)
  var isSerif = false;
  var fontBtn = document.createElement('button');
  fontBtn.textContent = ${e.fontSans};
  fontBtn.title = ${e.fontCurrentSans};
  fontBtn.style.cssText = btnStyle + 'font-size:11px;';
  fontBtn.addEventListener('click', function() {
    isSerif = !isSerif;
    fontBtn.textContent = isSerif ? ${e.fontSerif} : ${e.fontSans};
    fontBtn.title = isSerif ? ${e.fontCurrentSerif} : ${e.fontCurrentSans};
    document.body.style.fontFamily = isSerif ? "Georgia,'Times New Roman','Noto Serif SC','Songti SC',STSong,SimSun,serif" : '';
  });
  toolbar.appendChild(fontBtn);

  // Page width
  var widths = [
    { label: ${e.widthAuto}, value: '' },
    { label: ${e.widthFull}, value: '100%' },
    { label: ${e.widthWide}, value: '1400px' },
    { label: ${e.widthDesktop}, value: '1280px' },
    { label: ${e.widthNarrow}, value: '720px' },
  ];
  var ddStyle = 'padding:1px 4px;border-radius:3px;border:1px solid var(--vscode-dropdown-border,var(--vscode-widget-border,#555));background:var(--vscode-dropdown-background,#333);color:var(--vscode-dropdown-foreground,#eee);font-size:11px;outline:none;cursor:pointer;';
  var wSel = document.createElement('select');
  wSel.title = ${e.pageWidth};
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
  modeBtn.title = ${e.switchModeTitle};
  modeBtn.style.cssText = btnStyle + 'font-size:11px;';
  function updateModeLabel() {
    modeBtn.textContent = currentMode === 'tree' ? ${e.modeBook} : ${e.modeOutline};
  }
  updateModeLabel();
  modeBtn.addEventListener('click', function() {
    var newMode = currentMode === 'tree' ? 'book' : 'tree';
    currentMode = newMode;
    updateModeLabel();
    vscode.postMessage({ type: 'switchMode', mode: newMode });
  });
  toolbar.appendChild(modeBtn);

  // Refresh button
  var refreshBtn = document.createElement('button');
  refreshBtn.innerHTML = '&#x21bb;';
  refreshBtn.title = ${e.reloadContent};
  refreshBtn.style.cssText = btnStyle;
  refreshBtn.addEventListener('click', function() { vscode.postMessage({ type: 'refresh' }); });
  toolbar.appendChild(refreshBtn);

  document.body.appendChild(toolbar);
})();
`}var Ae=class{constructor(t){this.context=t}async resolveCustomTextEditor(t,n,r){let s=C.Uri.file((0,ee.dirname)(t.uri.fsPath)),l="tree";n.webview.options={enableScripts:!0,localResourceRoots:[C.Uri.file(this.context.extensionPath),s,...(C.workspace.workspaceFolders||[]).map(m=>m.uri)]},n.webview.onDidReceiveMessage(m=>{if(m.type==="refresh")g();else if(m.type==="openTopic"){let T=m.href;if(!T)return;let v=(0,ee.dirname)(t.uri.fsPath),S=(0,ee.resolve)(v,T),R=C.Uri.file(S),I=T.toLowerCase().endsWith(".ditamap")?"ditaViewer.mapPreview":"ditaViewer.preview";C.commands.executeCommand("vscode.openWith",R,I)}else m.type==="switchMode"&&(l=m.mode,g())});let u,f=C.workspace.onDidChangeTextDocument(m=>{m.document.uri.toString()===t.uri.toString()&&(u&&clearTimeout(u),u=setTimeout(g,300))}),h=C.window.onDidChangeActiveColorTheme(()=>{g()}),g=()=>{let m=this.generateHtml(t,n.webview,l);n.webview.html=m,wt.set(t.uri.toString(),m)};g(),n.onDidDispose(()=>{u&&clearTimeout(u),f.dispose(),h.dispose()})}generateHtml(t,n,r){let s=n.asWebviewUri(C.Uri.file((0,ee.join)(this.context.extensionPath,"media","styles.css"))),l=(0,ee.dirname)(t.uri.fsPath);try{let u=t.getText(),f=te(u),h=ae(f);be(h.root,l);let g;r==="book"?g=this.renderBookContent(h.root,t,n,l):g=yt(h.root,{docDir:l});let m=gn(),T=(0,Tt.randomBytes)(16).toString("base64"),v=C.window.activeColorTheme;return`<!DOCTYPE html>
<html lang="en"${v.kind===C.ColorThemeKind.Dark||v.kind===C.ColorThemeKind.HighContrast?' class="vscode-dark"':""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${n.cspSource} data:; style-src ${n.cspSource} 'unsafe-inline'; script-src 'nonce-${T}';">
<link rel="stylesheet" href="${s}">
<title>${t.fileName}</title>
</head>
<body class="mode-${r}">
${g}
<script nonce="${T}">${m}</script>
</body>
</html>`}catch(u){let f=u instanceof Error?u.message:String(u);return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Map Render Error</h2>
<pre>${ve(f)}</pre>
</div>
</body>
</html>`}}renderBookContent(t,n,r,s){let l=ke(t),u=Ve(n.uri),f=new Set,h=[];for(let g of l)if(g.href){if(g.href.split("#")[0].toLowerCase().endsWith(".ditamap")){h.push(Be(g.displayName,g.depth));continue}let m=(0,ee.resolve)(s,g.href);if(f.has(m)){h.push(lt(g.href));continue}f.add(m);let T=(0,ee.dirname)(m),v=I=>{try{let E=(0,ee.resolve)(T,I),N=C.Uri.file(E),b=r.asWebviewUri(N);if(b)return b.toString()}catch{}try{let E=(0,ee.resolve)(T,I);if((0,_e.existsSync)(E)){let N=(0,_e.readFileSync)(E),b=I.toLowerCase().split(".").pop()||"";return`data:${b==="png"?"image/png":b==="jpg"||b==="jpeg"?"image/jpeg":b==="gif"?"image/gif":b==="svg"?"image/svg+xml":b==="webp"?"image/webp":"image/png"};base64,${N.toString("base64")}`}}catch{}return""},S=Math.min(1+g.depth,6),R=pt({filePath:m,keyMap:u,asWebviewUri:v,headingLevel:S});R.error?h.push(ct(g.displayName,R.error,g.depth)):h.push(`<div class="book-entry">${R.html}</div>`)}else h.push(Be(g.displayName,g.depth));return`<div class="ditamap-book">${h.join(`
`)}</div>`}};var St=require("fs"),$e=require("path");function xt(e){let t=(0,St.readFileSync)(e,"utf-8"),n=ae(te(t));return ke(n.root).filter(s=>s.href&&s.href.toLowerCase().endsWith(".dita")).map(s=>({file:(0,$e.basename)(s.href,(0,$e.extname)(s.href))+".html",title:s.displayName}))}function Ct(e){if(e.configuredPath){let t=e.configuredPath.trim();if(e.fileExists(t))return{found:!0,location:{executablePath:t,source:"setting"}};let n=e.platform==="win32"?`${t}\\bin\\dita.bat`:`${t}/bin/dita`;return e.fileExists(n)?{found:!0,location:{executablePath:n,source:"setting"}}:{found:!1,reason:"setting-invalid"}}if(e.ditaHomeEnv){let t=e.platform==="win32"?`${e.ditaHomeEnv}\\bin\\dita.bat`:`${e.ditaHomeEnv}/bin/dita`;if(e.fileExists(t))return{found:!0,location:{executablePath:t,source:"env"}}}if(e.pathEnv){let t=e.platform==="win32"?";":":",n=e.pathEnv.split(t),r=e.platform==="win32"?"dita.bat":"dita";for(let s of n){if(!s)continue;let l=`${s}/${r}`.replace(/\\/g,"/");if(e.fileExists(l))return{found:!0,location:{executablePath:l,source:"path"}}}}return{found:!1,reason:"not-found"}}function Dt(e){let t=["-i",e.mapPath,"-f",e.transtype,"-o",e.outputDir,"--nav-toc=full"];return e.cssArg&&(t.push("--args.css",e.cssArg.filename),t.push("--args.cssroot",e.cssArg.root),t.push("--args.copycss","yes"),t.push("--args.csspath","css")),e.ditavalFile&&t.push("--filter",e.ditavalFile),t}var hn=/^.*?\[ERROR\]/i,vn=/^.*?\[WARN\]/i;function je(e){return hn.test(e)?"error":vn.test(e)?"warn":"info"}function Nt(){let e="";return{processChunk(t){e+=t;let n=e.split(`
`);return e=n.pop()||"",n},flush(){let t=e;return e="",t?[t]:[]}}}var bn="ditaViewer.transformWithDitaOt";function yn(e){e.subscriptions.push(p.window.registerCustomEditorProvider("ditaViewer.preview",new Ce(e),{webviewOptions:{retainContextWhenHidden:!0}})),e.subscriptions.push(p.window.registerCustomEditorProvider("ditaViewer.mapPreview",new Ae(e),{webviewOptions:{retainContextWhenHidden:!0}}));let t=async u=>{let f=p.window.tabGroups.activeTabGroup.activeTab,h=f?.input;if(f&&h instanceof p.TabInputCustom&&h.viewType===u){let m=h.uri.toString();for(let T of p.window.tabGroups.all)for(let v of T.tabs)if(v.input instanceof p.TabInputText&&v.input.uri.toString()===m){await p.window.showTextDocument(v.input.uri,{viewColumn:T.viewColumn}),await p.window.tabGroups.close(f);return}await p.commands.executeCommand("vscode.openWith",h.uri,"default",f.group.viewColumn);return}let g=p.window.activeTextEditor;g&&await p.commands.executeCommand("vscode.openWith",g.document.uri,u,p.ViewColumn.Beside)},n=p.commands.registerCommand("ditaViewer.showRendered",()=>t("ditaViewer.preview"));e.subscriptions.push(n);let r=p.commands.registerCommand("ditaViewer.showMapRendered",()=>t("ditaViewer.mapPreview"));e.subscriptions.push(r),e.subscriptions.push(p.commands.registerCommand("ditaViewer.showSource",()=>t("ditaViewer.preview")),p.commands.registerCommand("ditaViewer.showMapSource",()=>t("ditaViewer.mapPreview")));let s=e.extensionPath,l=p.commands.registerCommand(bn,async()=>{let u=new p.CancellationTokenSource,f=[];try{let h=await En();if(!h){p.window.showErrorMessage(p.l10n.t("Please open a .ditamap file first."));return}let g=qe(h.fsPath),m=(0,_.dirname)(g),T=p.workspace.getConfiguration("dita-viewer").get("ditaOtPath"),v=T&&T.trim()?T.trim():void 0,S=Ct({configuredPath:v,ditaHomeEnv:process.env.DITA_HOME,pathEnv:process.env.PATH,platform:process.platform,fileExists:U=>(0,L.existsSync)(U)});if(!S.found){if(S.reason==="setting-invalid"){let U=p.l10n.t("Open Settings");await p.window.showErrorMessage(p.l10n.t("The configured DITA-OT path is invalid: no dita executable was found under {0}.",v??""),U)===U&&p.commands.executeCommand("workbench.action.openSettings","dita-viewer.ditaOtPath")}else{let U=p.l10n.t("View Install Instructions");await p.window.showErrorMessage(p.l10n.t("DITA-OT was not found. Please install DITA-OT or configure the DITA_HOME environment variable."),U)===U&&p.env.openExternal(p.Uri.parse("https://www.dita-ot.org/documentation/installing"))}return}let R=[{label:"html5",description:p.l10n.t("HTML5 (default)")},{label:"pdf",description:"PDF"},{label:"xhtml",description:"XHTML"},{label:"markdown",description:"Markdown"}],I=await p.window.showQuickPick(R,{placeHolder:p.l10n.t("Select an output format (transtype)")});if(!I)return;let E=I.label,N=(0,_.join)(m,"out",E),b=await p.window.showOpenDialog({canSelectFolders:!0,canSelectFiles:!1,canSelectMany:!1,defaultUri:p.Uri.file(N),openLabel:p.l10n.t("Select Output Directory")}),w=qe(b&&b.length>0?b[0].fsPath:N);if((0,L.existsSync)(w))try{if((0,L.readdirSync)(w).length>0){let F=p.l10n.t("Overwrite");if(await p.window.showWarningMessage(p.l10n.t("The output directory already exists and is not empty: {0}. Overwrite it?",w),{modal:!0},F)!==F)return}}catch{}let D;if(E==="html5"||E==="xhtml"){let U=wn(m);if(U.length>0){let F=[{label:`$(close) ${p.l10n.t("No custom CSS")}`,description:p.l10n.t("Use DITA-OT default styles"),css:void 0},...U.map(j=>({label:`$(file) ${(0,_.basename)(j)}`,description:(0,_.dirname)(j),css:{filename:(0,_.basename)(j),root:(0,_.dirname)(j)}}))],B=await p.window.showQuickPick(F,{placeHolder:p.l10n.t("Select a custom CSS file (optional)"),ignoreFocusOut:!1});B&&B.css&&(D=B.css)}}let Q,z=await p.window.showOpenDialog({canSelectFiles:!0,canSelectFolders:!1,canSelectMany:!1,filters:{[p.l10n.t("DITAVAL Filter Files")]:["ditaval"]},openLabel:p.l10n.t("Select Filter File")});z&&z.length>0&&(Q=qe(z[0].fsPath));let G;if(E==="html5"||E==="xhtml"){let U=[{label:p.l10n.t("Navigation Toolbar"),description:p.l10n.t("Prev/Next page + collapsible sections"),key:"navToolbar",picked:!0},{label:p.l10n.t("Sidebar Outline"),description:p.l10n.t("Fixed table of contents on the left"),key:"sidebar",picked:!0},{label:p.l10n.t("On-This-Page"),description:p.l10n.t("Right-hand navigation for headings on the current page"),key:"onPageToc",picked:!0},{label:p.l10n.t("Copy-Code Button"),description:p.l10n.t("Copy button on code blocks"),key:"copyCode",picked:!0},{label:p.l10n.t("Back to Top"),description:p.l10n.t("Back-to-top button in the bottom-right corner"),key:"backToTop",picked:!0},{label:p.l10n.t("Dark Mode"),description:p.l10n.t("Light/dark theme toggle"),key:"darkMode",picked:!0}],F=await p.window.showQuickPick(U,{canPickMany:!0,placeHolder:p.l10n.t("Select the site enhancements to enable (all enabled by default)"),ignoreFocusOut:!1});if(F){let B={navToolbar:!1,sidebar:!1,onPageToc:!1,copyCode:!1,backToTop:!1,darkMode:!1};for(let j of F)B[j.key]=!0;G=B}else G={navToolbar:!0,sidebar:!0,onPageToc:!0,copyCode:!0,backToTop:!0,darkMode:!0}}let fe=Dt({mapPath:g,transtype:E,outputDir:w,cssArg:D,ditavalFile:Q}),c=p.window.createOutputChannel("DITA-OT Transform");f.push(p.Disposable.from({dispose:()=>c.dispose()},{dispose:()=>u.dispose()})),c.show(!0),await p.window.withProgress({location:p.ProgressLocation.Notification,title:p.l10n.t("DITA-OT: Transforming to {0} (the first run may take a while)",E),cancellable:!0},async(U,F)=>(F.onCancellationRequested(()=>{u.token.isCancellationRequested||u.cancel()}),new Promise((B,j)=>{let Re=process.platform==="win32",se=(0,kt.spawn)(S.location.executablePath,fe,{shell:Re}),$=!1,ce=u.token.onCancellationRequested(()=>{$=!0,se.kill("SIGTERM"),setTimeout(()=>{try{se.kill("SIGKILL")}catch{}},3e3)});f.push(ce);let le=0,ie=Nt();se.stdout?.on("data",X=>{c.append(X.toString())}),se.stderr?.on("data",X=>{let x=X.toString();c.append(x);let J=ie.processChunk(x);for(let K of J)je(K)==="error"&&le++}),se.on("error",X=>{c.appendLine(p.l10n.t(`
[DITA-OT] Failed to start process: {0}`,X.message)),j(X)}),se.on("close",async X=>{for(let J of ie.flush())je(J)==="error"&&le++;if($){c.appendLine(p.l10n.t(`
[DITA-OT] Transformation cancelled by user.`)),B();return}if(X!==0){c.appendLine(p.l10n.t(`
[DITA-OT] Process exited with code: {0}`,String(X))),c.appendLine(p.l10n.t(`
[DITA-OT] Command: {0} {1}`,S.location.executablePath,fe.join(" "))),j(new Error(p.l10n.t("DITA-OT exit code: {0}",String(X))));return}if(c.appendLine(p.l10n.t(`
[DITA-OT] Transformation complete. Output directory: {0}`,w)),E==="html5"||E==="xhtml")try{G&&(Tn(s,g,w,G),c.appendLine(p.l10n.t(`
[DITA-OT] Site enhancements injected.`)))}catch(J){c.appendLine(p.l10n.t(`
[DITA-OT] Failed to inject site enhancements: {0}`,String(J)))}let x=le>0?p.l10n.t(" ({0} error(s) detected)",String(le)):"";if(E==="html5"){let J=(0,_.join)(w,"index.html");if((0,L.existsSync)(J)){let K=p.l10n.t("Open in Browser");await p.window.showInformationMessage(p.l10n.t("DITA-OT transformation complete{0}",x),K)===K&&p.env.openExternal(p.Uri.file(J))}else{let K=p.l10n.t("Reveal in File Explorer");await p.window.showInformationMessage(p.l10n.t("DITA-OT transformation complete{0}",x),K)===K&&p.commands.executeCommand("revealFileInOS",p.Uri.file(w))}}else{let J=p.l10n.t("Reveal in File Explorer");await p.window.showInformationMessage(p.l10n.t("DITA-OT transformation complete{0}",x),J)===J&&p.commands.executeCommand("revealFileInOS",p.Uri.file(w))}B()})})))}catch(h){let g=h instanceof Error?h.message:String(h),m=p.l10n.t("View Output Log");await p.window.showErrorMessage(p.l10n.t("DITA-OT transformation failed: {0}",g),m)===m&&p.commands.executeCommand("workbench.action.output.toggleOutput")}finally{for(let h of f)try{h.dispose()}catch{}}});return e.subscriptions.push(l),{_test:{getLastRenderedHtml:ht,getLastRenderedMapHtml:Et}}}function Tn(e,t,n,r){let s=xt(t),u=(0,L.readFileSync)((0,_.join)(e,"media","transform-assets","site-chrome.js"),"utf-8").replace("/* __DV_MANIFEST__ */",JSON.stringify(s)).replace("/* __DV_FEATURES__ */",JSON.stringify(r));(0,L.writeFileSync)((0,_.join)(n,"dita-viewer-chrome.js"),u,"utf-8");let f=(0,L.readFileSync)((0,_.join)(e,"media","transform-assets","site-chrome.css"),"utf-8");(0,L.writeFileSync)((0,_.join)(n,"dita-viewer-chrome.css"),f,"utf-8");let h=r.darkMode;if(h){let m=(0,L.readFileSync)((0,_.join)(e,"media","transform-assets","dark-mode.css"),"utf-8");(0,L.writeFileSync)((0,_.join)(n,"dita-viewer-dark.css"),m,"utf-8")}function g(m){for(let T of(0,L.readdirSync)(m)){let v=(0,_.join)(m,T);try{if((0,L.statSync)(v).isDirectory()){g(v);continue}}catch{continue}if(!T.toLowerCase().endsWith(".html"))continue;let S=(0,L.readFileSync)(v,"utf-8");if(S.includes("dita-viewer-chrome"))continue;let I=v.substring(n.length).replace(/\\/g,"/").replace(/^\/+/,"").split("/").length-1,E=I>0?"../".repeat(I):"",N='<link rel="stylesheet" type="text/css" href="'+E+'dita-viewer-chrome.css">';if(S=S.replace("</head>",N+"</head>"),h){let b='<link rel="stylesheet" type="text/css" href="'+E+'dita-viewer-dark.css">';S=S.replace("</head>",b+"</head>")}S=S.replace("</body>",'<script src="'+E+'dita-viewer-chrome.js"></script></body>'),(0,L.writeFileSync)(v,S,"utf-8")}}g(n)}function wn(e){let t=new Map,n=new Set;n.add(e);let r=p.workspace.workspaceFolders?.[0]?.uri?.fsPath;r&&r!==e&&n.add(r);try{let s=p.workspace.getConfiguration("dita-viewer").get("cssDirectory");if(s)for(let l of s){let u=(0,_.isAbsolute)(l)?l:(0,_.resolve)(e,l);(0,L.existsSync)(u)&&n.add(u)}}catch{}for(let s of n)try{for(let l of(0,L.readdirSync)(s))l.toLowerCase().endsWith(".css")&&!t.has(l)&&t.set(l,(0,_.join)(s,l))}catch{}try{let s=p.workspace.getConfiguration("dita-viewer").get("customCss");if(s)for(let l of s){let u=(0,_.isAbsolute)(l)?l:(0,_.resolve)(e,l);(0,L.existsSync)(u)&&!t.has((0,_.basename)(u))&&t.set((0,_.basename)(u),u)}}catch{}return[...t.values()]}function qe(e){return process.platform==="win32"&&/^[a-z]:/.test(e)?e[0].toUpperCase()+e.slice(1):e}async function En(){let e=p.window.activeTextEditor;if(!e)return;let t=e.document.uri;if(t.fsPath.endsWith(".ditamap"))return t;if(t.fsPath.endsWith(".dita")){let n=We(t);if(n.length===0)return;if(n.length===1)return p.Uri.file(n[0]);let r=n.map(l=>({label:l,description:p.l10n.t("Associated DITA Map")})),s=await p.window.showQuickPick(r,{placeHolder:p.l10n.t("Multiple DITA Map files found \u2014 select the one to use:")});return s?p.Uri.file(s.label):void 0}}0&&(module.exports={activate});
/*! Bundled license information:

sax/lib/sax.js:
  (*! http://mths.be/fromcodepoint v0.1.0 by @mathias *)
*/
