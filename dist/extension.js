"use strict";var Je=Object.create;var re=Object.defineProperty;var et=Object.getOwnPropertyDescriptor;var tt=Object.getOwnPropertyNames;var nt=Object.getPrototypeOf,it=Object.prototype.hasOwnProperty;var ot=(e,n)=>()=>(n||e((n={exports:{}}).exports,n),n.exports),rt=(e,n)=>{for(var i in n)re(e,i,{get:n[i],enumerable:!0})},Ce=(e,n,i,s)=>{if(n&&typeof n=="object"||typeof n=="function")for(let c of tt(n))!it.call(e,c)&&c!==i&&re(e,c,{get:()=>n[c],enumerable:!(s=et(n,c))||s.enumerable});return e};var se=(e,n,i)=>(i=e!=null?Je(nt(e)):{},Ce(n||!e||!e.__esModule?re(i,"default",{value:e,enumerable:!0}):i,e)),st=e=>Ce(re({},"__esModule",{value:!0}),e);var _e=ot(ae=>{"use strict";(function(e){e.parser=function(o,t){return new i(o,t)},e.SAXParser=i,e.SAXStream=f,e.createStream=m,e.MAX_BUFFER_LENGTH=64*1024;var n=["comment","sgmlDecl","textNode","tagName","doctype","procInstName","procInstBody","entity","attribName","attribValue","cdata","script"];e.EVENTS=["text","processinginstruction","sgmldeclaration","doctype","comment","opentagstart","attribute","opentag","closetag","opencdata","cdata","closecdata","error","end","ready","script","opennamespace","closenamespace"];function i(o,t){if(!(this instanceof i))return new i(o,t);var l=this;c(l),l.q=l.c="",l.bufferCheckPosition=e.MAX_BUFFER_LENGTH,l.encoding=null,l.opt=t||{},l.opt.lowercase=l.opt.lowercase||l.opt.lowercasetags,l.looseCase=l.opt.lowercase?"toLowerCase":"toUpperCase",l.opt.maxEntityCount=l.opt.maxEntityCount||512,l.opt.maxEntityDepth=l.opt.maxEntityDepth||4,l.entityCount=l.entityDepth=0,l.tags=[],l.closed=l.closedRoot=l.sawRoot=!1,l.tag=l.error=null,l.strict=!!o,l.noscript=!!(o||l.opt.noscript),l.state=a.BEGIN,l.strictEntities=l.opt.strictEntities,l.ENTITIES=l.strictEntities?Object.create(e.XML_ENTITIES):Object.create(e.ENTITIES),l.attribList=[],l.opt.xmlns&&(l.ns=Object.create(k)),l.opt.unquotedAttributeValues===void 0&&(l.opt.unquotedAttributeValues=!o),l.trackPosition=l.opt.position!==!1,l.trackPosition&&(l.position=l.line=l.column=0),V(l,"onready")}Object.create||(Object.create=function(o){function t(){}t.prototype=o;var l=new t;return l}),Object.keys||(Object.keys=function(o){var t=[];for(var l in o)o.hasOwnProperty(l)&&t.push(l);return t});function s(o){for(var t=Math.max(e.MAX_BUFFER_LENGTH,10),l=0,r=0,y=n.length;r<y;r++){var N=o[n[r]].length;if(N>t)switch(n[r]){case"textNode":Z(o);break;case"cdata":_(o,"oncdata",o.cdata),o.cdata="";break;case"script":_(o,"onscript",o.script),o.script="";break;default:Y(o,"Max buffer length exceeded: "+n[r])}l=Math.max(l,N)}var S=e.MAX_BUFFER_LENGTH-l;o.bufferCheckPosition=S+o.position}function c(o){for(var t=0,l=n.length;t<l;t++)o[n[t]]=""}function d(o){Z(o),o.cdata!==""&&(_(o,"oncdata",o.cdata),o.cdata=""),o.script!==""&&(_(o,"onscript",o.script),o.script="")}i.prototype={end:function(){we(this)},write:Qe,resume:function(){return this.error=null,this},close:function(){return this.write(null)},flush:function(){d(this)}};var p;try{p=require("stream").Stream}catch{p=function(){}}p||(p=function(){});var u=e.EVENTS.filter(function(o){return o!=="error"&&o!=="end"});function m(o,t){return new f(o,t)}function g(o,t){if(o.length>=2){if(o[0]===255&&o[1]===254)return"utf-16le";if(o[0]===254&&o[1]===255)return"utf-16be"}return o.length>=3&&o[0]===239&&o[1]===187&&o[2]===191?"utf8":o.length>=4?o[0]===60&&o[1]===0&&o[2]===63&&o[3]===0?"utf-16le":o[0]===0&&o[1]===60&&o[2]===0&&o[3]===63?"utf-16be":"utf8":t?"utf8":null}function f(o,t){if(!(this instanceof f))return new f(o,t);p.apply(this),this._parser=new i(o,t),this.writable=!0,this.readable=!0;var l=this;this._parser.onend=function(){l.emit("end")},this._parser.onerror=function(r){l.emit("error",r),l._parser.error=null},this._decoder=null,this._decoderBuffer=null,u.forEach(function(r){Object.defineProperty(l,"on"+r,{get:function(){return l._parser["on"+r]},set:function(y){if(!y)return l.removeAllListeners(r),l._parser["on"+r]=y,y;l.on(r,y)},enumerable:!0,configurable:!1})})}f.prototype=Object.create(p.prototype,{constructor:{value:f}}),f.prototype._decodeBuffer=function(o,t){if(this._decoderBuffer&&(o=Buffer.concat([this._decoderBuffer,o]),this._decoderBuffer=null),!this._decoder){var l=g(o,t);if(!l)return this._decoderBuffer=o,"";this._parser.encoding=l,this._decoder=new TextDecoder(l)}return this._decoder.decode(o,{stream:!t})},f.prototype.write=function(o){if(typeof Buffer=="function"&&typeof Buffer.isBuffer=="function"&&Buffer.isBuffer(o))o=this._decodeBuffer(o,!1);else if(this._decoderBuffer){var t=this._decodeBuffer(Buffer.alloc(0),!0);t&&(this._parser.write(t),this.emit("data",t))}return this._parser.write(o.toString()),this.emit("data",o),!0},f.prototype.end=function(o){if(o&&o.length&&this.write(o),this._decoderBuffer){var t=this._decodeBuffer(Buffer.alloc(0),!0);t&&(this._parser.write(t),this.emit("data",t))}else if(this._decoder){var l=this._decoder.decode();l&&(this._parser.write(l),this.emit("data",l))}return this._parser.end(),!0},f.prototype.on=function(o,t){var l=this;return!l._parser["on"+o]&&u.indexOf(o)!==-1&&(l._parser["on"+o]=function(){var r=arguments.length===1?[arguments[0]]:Array.apply(null,arguments);r.splice(0,0,o),l.emit.apply(l,r)}),p.prototype.on.call(l,o,t)};var D="[CDATA[",v="DOCTYPE",b="http://www.w3.org/XML/1998/namespace",T="http://www.w3.org/2000/xmlns/",k={xml:b,xmlns:T},B=/[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,R=/[:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/,X=/[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]/,ne=/[#:_A-Za-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\u00B7\u0300-\u036F\u203F-\u2040.\d-]/;function $(o){return o===" "||o===`
`||o==="\r"||o==="	"}function H(o){return o==='"'||o==="'"}function ie(o){return o===">"||$(o)}function M(o,t){return o.test(t)}function ue(o,t){return!M(o,t)}var a=0;e.STATE={BEGIN:a++,BEGIN_WHITESPACE:a++,TEXT:a++,TEXT_ENTITY:a++,OPEN_WAKA:a++,SGML_DECL:a++,SGML_DECL_QUOTED:a++,DOCTYPE:a++,DOCTYPE_QUOTED:a++,DOCTYPE_DTD:a++,DOCTYPE_DTD_QUOTED:a++,COMMENT_STARTING:a++,COMMENT:a++,COMMENT_ENDING:a++,COMMENT_ENDED:a++,CDATA:a++,CDATA_ENDING:a++,CDATA_ENDING_2:a++,PROC_INST:a++,PROC_INST_BODY:a++,PROC_INST_ENDING:a++,OPEN_TAG:a++,OPEN_TAG_SLASH:a++,ATTRIB:a++,ATTRIB_NAME:a++,ATTRIB_NAME_SAW_WHITE:a++,ATTRIB_VALUE:a++,ATTRIB_VALUE_QUOTED:a++,ATTRIB_VALUE_CLOSED:a++,ATTRIB_VALUE_UNQUOTED:a++,ATTRIB_VALUE_ENTITY_Q:a++,ATTRIB_VALUE_ENTITY_U:a++,CLOSE_TAG:a++,CLOSE_TAG_SAW_WHITE:a++,SCRIPT:a++,SCRIPT_ENDING:a++},e.XML_ENTITIES={amp:"&",gt:">",lt:"<",quot:'"',apos:"'"},e.ENTITIES={amp:"&",gt:">",lt:"<",quot:'"',apos:"'",AElig:198,Aacute:193,Acirc:194,Agrave:192,Aring:197,Atilde:195,Auml:196,Ccedil:199,ETH:208,Eacute:201,Ecirc:202,Egrave:200,Euml:203,Iacute:205,Icirc:206,Igrave:204,Iuml:207,Ntilde:209,Oacute:211,Ocirc:212,Ograve:210,Oslash:216,Otilde:213,Ouml:214,THORN:222,Uacute:218,Ucirc:219,Ugrave:217,Uuml:220,Yacute:221,aacute:225,acirc:226,aelig:230,agrave:224,aring:229,atilde:227,auml:228,ccedil:231,eacute:233,ecirc:234,egrave:232,eth:240,euml:235,iacute:237,icirc:238,igrave:236,iuml:239,ntilde:241,oacute:243,ocirc:244,ograve:242,oslash:248,otilde:245,ouml:246,szlig:223,thorn:254,uacute:250,ucirc:251,ugrave:249,uuml:252,yacute:253,yuml:255,copy:169,reg:174,nbsp:160,iexcl:161,cent:162,pound:163,curren:164,yen:165,brvbar:166,sect:167,uml:168,ordf:170,laquo:171,not:172,shy:173,macr:175,deg:176,plusmn:177,sup1:185,sup2:178,sup3:179,acute:180,micro:181,para:182,middot:183,cedil:184,ordm:186,raquo:187,frac14:188,frac12:189,frac34:190,iquest:191,times:215,divide:247,OElig:338,oelig:339,Scaron:352,scaron:353,Yuml:376,fnof:402,circ:710,tilde:732,Alpha:913,Beta:914,Gamma:915,Delta:916,Epsilon:917,Zeta:918,Eta:919,Theta:920,Iota:921,Kappa:922,Lambda:923,Mu:924,Nu:925,Xi:926,Omicron:927,Pi:928,Rho:929,Sigma:931,Tau:932,Upsilon:933,Phi:934,Chi:935,Psi:936,Omega:937,alpha:945,beta:946,gamma:947,delta:948,epsilon:949,zeta:950,eta:951,theta:952,iota:953,kappa:954,lambda:955,mu:956,nu:957,xi:958,omicron:959,pi:960,rho:961,sigmaf:962,sigma:963,tau:964,upsilon:965,phi:966,chi:967,psi:968,omega:969,thetasym:977,upsih:978,piv:982,ensp:8194,emsp:8195,thinsp:8201,zwnj:8204,zwj:8205,lrm:8206,rlm:8207,ndash:8211,mdash:8212,lsquo:8216,rsquo:8217,sbquo:8218,ldquo:8220,rdquo:8221,bdquo:8222,dagger:8224,Dagger:8225,bull:8226,hellip:8230,permil:8240,prime:8242,Prime:8243,lsaquo:8249,rsaquo:8250,oline:8254,frasl:8260,euro:8364,image:8465,weierp:8472,real:8476,trade:8482,alefsym:8501,larr:8592,uarr:8593,rarr:8594,darr:8595,harr:8596,crarr:8629,lArr:8656,uArr:8657,rArr:8658,dArr:8659,hArr:8660,forall:8704,part:8706,exist:8707,empty:8709,nabla:8711,isin:8712,notin:8713,ni:8715,prod:8719,sum:8721,minus:8722,lowast:8727,radic:8730,prop:8733,infin:8734,ang:8736,and:8743,or:8744,cap:8745,cup:8746,int:8747,there4:8756,sim:8764,cong:8773,asymp:8776,ne:8800,equiv:8801,le:8804,ge:8805,sub:8834,sup:8835,nsub:8836,sube:8838,supe:8839,oplus:8853,otimes:8855,perp:8869,sdot:8901,lceil:8968,rceil:8969,lfloor:8970,rfloor:8971,lang:9001,rang:9002,loz:9674,spades:9824,clubs:9827,hearts:9829,diams:9830},Object.keys(e.ENTITIES).forEach(function(o){var t=e.ENTITIES[o],l=typeof t=="number"?String.fromCharCode(t):t;e.ENTITIES[o]=l});for(var oe in e.STATE)e.STATE[e.STATE[oe]]=oe;a=e.STATE;function V(o,t,l){o[t]&&o[t](l)}function z(o){var t=o&&o.match(/(?:^|\s)encoding\s*=\s*(['"])([^'"]+)\1/i);return t?t[2]:null}function Q(o){return o?o.toLowerCase().replace(/[^a-z0-9]/g,""):null}function Ye(o,t){let l=Q(o),r=Q(t);return!l||!r?!0:r==="utf16"?l==="utf16le"||l==="utf16be":l===r}function je(o,t){if(!(!o.strict||!o.encoding||!t||t.name!=="xml")){var l=z(t.body);l&&!Ye(o.encoding,l)&&E(o,"XML declaration encoding "+l+" does not match detected stream encoding "+o.encoding.toUpperCase())}}function _(o,t,l){o.textNode&&Z(o),V(o,t,l)}function Z(o){o.textNode=Ee(o.opt,o.textNode),o.textNode&&V(o,"ontext",o.textNode),o.textNode=""}function Ee(o,t){return o.trim&&(t=t.trim()),o.normalize&&(t=t.replace(/\s+/g," ")),t}function Y(o,t){return Z(o),o.trackPosition&&(t+=`
Line: `+o.line+`
Column: `+o.column+`
Char: `+o.c),t=new Error(t),o.error=t,V(o,"onerror",t),o}function we(o){return o.sawRoot&&!o.closedRoot&&E(o,"Unclosed root tag"),o.state!==a.BEGIN&&o.state!==a.BEGIN_WHITESPACE&&o.state!==a.TEXT&&Y(o,"Unexpected end"),Z(o),o.c="",o.closed=!0,V(o,"onend"),i.call(o,o.strict,o.opt),o}function E(o,t){if(typeof o!="object"||!(o instanceof i))throw new Error("bad call to strictFail");o.strict&&Y(o,t)}function Xe(o){o.strict||(o.tagName=o.tagName[o.looseCase]());var t=o.tags[o.tags.length-1]||o,l=o.tag={name:o.tagName,attributes:{}};o.opt.xmlns&&(l.ns=t.ns),o.attribList.length=0,_(o,"onopentagstart",l)}function fe(o,t){var l=o.indexOf(":"),r=l<0?["",o]:o.split(":"),y=r[0],N=r[1];return t&&o==="xmlns"&&(y="xmlns",N=""),{prefix:y,local:N}}function me(o){if(o.strict||(o.attribName=o.attribName[o.looseCase]()),o.attribList.indexOf(o.attribName)!==-1||o.tag.attributes.hasOwnProperty(o.attribName)){o.attribName=o.attribValue="";return}if(o.opt.xmlns){var t=fe(o.attribName,!0),l=t.prefix,r=t.local;if(l==="xmlns")if(r==="xml"&&o.attribValue!==b)E(o,"xml: prefix must be bound to "+b+`
Actual: `+o.attribValue);else if(r==="xmlns"&&o.attribValue!==T)E(o,"xmlns: prefix must be bound to "+T+`
Actual: `+o.attribValue);else{var y=o.tag,N=o.tags[o.tags.length-1]||o;y.ns===N.ns&&(y.ns=Object.create(N.ns)),y.ns[r]=o.attribValue}o.attribList.push([o.attribName,o.attribValue])}else o.tag.attributes[o.attribName]=o.attribValue,_(o,"onattribute",{name:o.attribName,value:o.attribValue});o.attribName=o.attribValue=""}function j(o,t){if(o.opt.xmlns){var l=o.tag,r=fe(o.tagName);l.prefix=r.prefix,l.local=r.local,l.uri=l.ns[r.prefix]||"",l.prefix&&!l.uri&&(E(o,"Unbound namespace prefix: "+JSON.stringify(o.tagName)),l.uri=r.prefix);var y=o.tags[o.tags.length-1]||o;l.ns&&y.ns!==l.ns&&Object.keys(l.ns).forEach(function(Ne){_(o,"onopennamespace",{prefix:Ne,uri:l.ns[Ne]})});for(var N=0,S=o.attribList.length;N<S;N++){var F=o.attribList[N],O=F[0],G=F[1],I=fe(O,!0),q=I.prefix,Ze=I.local,xe=q===""?"":l.ns[q]||"",ve={name:O,value:G,prefix:q,local:Ze,uri:xe};q&&q!=="xmlns"&&!xe&&(E(o,"Unbound namespace prefix: "+JSON.stringify(q)),ve.uri=q),o.tag.attributes[O]=ve,_(o,"onattribute",ve)}o.attribList.length=0}o.tag.isSelfClosing=!!t,o.sawRoot=!0,o.tags.push(o.tag),_(o,"onopentag",o.tag),t||(!o.noscript&&o.tagName.toLowerCase()==="script"?o.state=a.SCRIPT:o.state=a.TEXT,o.tag=null,o.tagName=""),o.attribName=o.attribValue="",o.attribList.length=0}function ge(o){if(!o.tagName){E(o,"Weird empty close tag."),o.textNode+="</>",o.state=a.TEXT;return}if(o.script){if(o.tagName!=="script"){o.script+="</"+o.tagName+">",o.tagName="",o.state=a.SCRIPT;return}_(o,"onscript",o.script),o.script=""}var t=o.tags.length,l=o.tagName;o.strict||(l=l[o.looseCase]());for(var r=l;t--;){var y=o.tags[t];if(y.name!==r)E(o,"Unexpected close tag");else break}if(t<0){E(o,"Unmatched closing tag: "+o.tagName),o.textNode+="</"+o.tagName+">",o.state=a.TEXT;return}o.tagName=l;for(var N=o.tags.length;N-- >t;){var S=o.tag=o.tags.pop();o.tagName=o.tag.name,_(o,"onclosetag",o.tagName);var F={};for(var O in S.ns)F[O]=S.ns[O];var G=o.tags[o.tags.length-1]||o;o.opt.xmlns&&S.ns!==G.ns&&Object.keys(S.ns).forEach(function(I){var q=S.ns[I];_(o,"onclosenamespace",{prefix:I,uri:q})})}t===0&&(o.closedRoot=!0),o.tagName=o.attribValue=o.attribName="",o.attribList.length=0,o.state=a.TEXT}function Ke(o){var t=o.entity,l=t.toLowerCase(),r,y="";return o.ENTITIES[t]?o.ENTITIES[t]:o.ENTITIES[l]?o.ENTITIES[l]:(t=l,t.charAt(0)==="#"&&(t.charAt(1)==="x"?(t=t.slice(2),r=parseInt(t,16),y=r.toString(16)):(t=t.slice(1),r=parseInt(t,10),y=r.toString(10))),t=t.replace(/^0+/,""),isNaN(r)||y.toLowerCase()!==t||r<0||r>1114111?(E(o,"Invalid character entity"),"&"+o.entity+";"):String.fromCodePoint(r))}function De(o,t){t==="<"?(o.state=a.OPEN_WAKA,o.startTagPosition=o.position):$(t)||(E(o,"Non-whitespace before first tag."),o.textNode=t,o.state=a.TEXT)}function he(o,t){var l="";return t<o.length&&(l=o.charAt(t)),l}function Qe(o){var t=this;if(this.error)throw this.error;if(t.closed)return Y(t,"Cannot write after close. Assign an onready handler.");if(o===null)return we(t);typeof o=="object"&&(o=o.toString());for(var l=0,r="";r=he(o,l++),t.c=r,!!r;)switch(t.trackPosition&&(t.position++,r===`
`?(t.line++,t.column=0):t.column++),t.state){case a.BEGIN:if(t.state=a.BEGIN_WHITESPACE,r==="\uFEFF")continue;De(t,r);continue;case a.BEGIN_WHITESPACE:De(t,r);continue;case a.TEXT:if(t.sawRoot&&!t.closedRoot){for(var N=l-1;r&&r!=="<"&&r!=="&";)r=he(o,l++),r&&t.trackPosition&&(t.position++,r===`
`?(t.line++,t.column=0):t.column++);t.textNode+=o.substring(N,l-1)}r==="<"&&!(t.sawRoot&&t.closedRoot&&!t.strict)?(t.state=a.OPEN_WAKA,t.startTagPosition=t.position):(!$(r)&&(!t.sawRoot||t.closedRoot)&&E(t,"Text data outside of root node."),r==="&"?t.state=a.TEXT_ENTITY:t.textNode+=r);continue;case a.SCRIPT:r==="<"?t.state=a.SCRIPT_ENDING:t.script+=r;continue;case a.SCRIPT_ENDING:r==="/"?t.state=a.CLOSE_TAG:(t.script+="<"+r,t.state=a.SCRIPT);continue;case a.OPEN_WAKA:if(r==="!")t.state=a.SGML_DECL,t.sgmlDecl="";else if(!$(r))if(M(B,r))t.state=a.OPEN_TAG,t.tagName=r;else if(r==="/")t.state=a.CLOSE_TAG,t.tagName="";else if(r==="?")t.state=a.PROC_INST,t.procInstName=t.procInstBody="";else{if(E(t,"Unencoded <"),t.startTagPosition+1<t.position){var y=t.position-t.startTagPosition;r=new Array(y).join(" ")+r}t.textNode+="<"+r,t.state=a.TEXT}continue;case a.SGML_DECL:if(t.sgmlDecl+r==="--"){t.state=a.COMMENT,t.comment="",t.sgmlDecl="";continue}t.doctype&&t.doctype!==!0&&t.sgmlDecl?(t.state=a.DOCTYPE_DTD,t.doctype+="<!"+t.sgmlDecl+r,t.sgmlDecl=""):(t.sgmlDecl+r).toUpperCase()===D?(_(t,"onopencdata"),t.state=a.CDATA,t.sgmlDecl="",t.cdata=""):(t.sgmlDecl+r).toUpperCase()===v?(t.state=a.DOCTYPE,(t.doctype||t.sawRoot)&&E(t,"Inappropriately located doctype declaration"),t.doctype="",t.sgmlDecl=""):r===">"?(_(t,"onsgmldeclaration",t.sgmlDecl),t.sgmlDecl="",t.state=a.TEXT):(H(r)&&(t.state=a.SGML_DECL_QUOTED),t.sgmlDecl+=r);continue;case a.SGML_DECL_QUOTED:r===t.q&&(t.state=a.SGML_DECL,t.q=""),t.sgmlDecl+=r;continue;case a.DOCTYPE:r===">"?(t.state=a.TEXT,_(t,"ondoctype",t.doctype),t.doctype=!0):(t.doctype+=r,r==="["?t.state=a.DOCTYPE_DTD:H(r)&&(t.state=a.DOCTYPE_QUOTED,t.q=r));continue;case a.DOCTYPE_QUOTED:t.doctype+=r,r===t.q&&(t.q="",t.state=a.DOCTYPE);continue;case a.DOCTYPE_DTD:r==="]"?(t.doctype+=r,t.state=a.DOCTYPE):r==="<"?(t.state=a.OPEN_WAKA,t.startTagPosition=t.position):H(r)?(t.doctype+=r,t.state=a.DOCTYPE_DTD_QUOTED,t.q=r):t.doctype+=r;continue;case a.DOCTYPE_DTD_QUOTED:t.doctype+=r,r===t.q&&(t.state=a.DOCTYPE_DTD,t.q="");continue;case a.COMMENT:r==="-"?t.state=a.COMMENT_ENDING:t.comment+=r;continue;case a.COMMENT_ENDING:r==="-"?(t.state=a.COMMENT_ENDED,t.comment=Ee(t.opt,t.comment),t.comment&&_(t,"oncomment",t.comment),t.comment=""):(t.comment+="-"+r,t.state=a.COMMENT);continue;case a.COMMENT_ENDED:r!==">"?(E(t,"Malformed comment"),t.comment+="--"+r,t.state=a.COMMENT):t.doctype&&t.doctype!==!0?t.state=a.DOCTYPE_DTD:t.state=a.TEXT;continue;case a.CDATA:for(var N=l-1;r&&r!=="]";)r=he(o,l++),r&&t.trackPosition&&(t.position++,r===`
`?(t.line++,t.column=0):t.column++);t.cdata+=o.substring(N,l-1),r==="]"&&(t.state=a.CDATA_ENDING);continue;case a.CDATA_ENDING:r==="]"?t.state=a.CDATA_ENDING_2:(t.cdata+="]"+r,t.state=a.CDATA);continue;case a.CDATA_ENDING_2:r===">"?(t.cdata&&_(t,"oncdata",t.cdata),_(t,"onclosecdata"),t.cdata="",t.state=a.TEXT):r==="]"?t.cdata+="]":(t.cdata+="]]"+r,t.state=a.CDATA);continue;case a.PROC_INST:r==="?"?t.state=a.PROC_INST_ENDING:$(r)?t.state=a.PROC_INST_BODY:t.procInstName+=r;continue;case a.PROC_INST_BODY:if(!t.procInstBody&&$(r))continue;r==="?"?t.state=a.PROC_INST_ENDING:t.procInstBody+=r;continue;case a.PROC_INST_ENDING:if(r===">"){let G={name:t.procInstName,body:t.procInstBody};je(t,G),_(t,"onprocessinginstruction",G),t.procInstName=t.procInstBody="",t.state=a.TEXT}else t.procInstBody+="?"+r,t.state=a.PROC_INST_BODY;continue;case a.OPEN_TAG:M(R,r)?t.tagName+=r:(Xe(t),r===">"?j(t):r==="/"?t.state=a.OPEN_TAG_SLASH:($(r)||E(t,"Invalid character in tag name"),t.state=a.ATTRIB));continue;case a.OPEN_TAG_SLASH:r===">"?(j(t,!0),ge(t)):(E(t,"Forward-slash in opening tag not followed by >"),t.state=a.ATTRIB);continue;case a.ATTRIB:if($(r))continue;r===">"?j(t):r==="/"?t.state=a.OPEN_TAG_SLASH:M(B,r)?(t.attribName=r,t.attribValue="",t.state=a.ATTRIB_NAME):E(t,"Invalid attribute name");continue;case a.ATTRIB_NAME:r==="="?t.state=a.ATTRIB_VALUE:r===">"?(E(t,"Attribute without value"),t.attribValue=t.attribName,me(t),j(t)):$(r)?t.state=a.ATTRIB_NAME_SAW_WHITE:M(R,r)?t.attribName+=r:E(t,"Invalid attribute name");continue;case a.ATTRIB_NAME_SAW_WHITE:if(r==="=")t.state=a.ATTRIB_VALUE;else{if($(r))continue;E(t,"Attribute without value"),t.tag.attributes[t.attribName]="",t.attribValue="",_(t,"onattribute",{name:t.attribName,value:""}),t.attribName="",r===">"?j(t):M(B,r)?(t.attribName=r,t.state=a.ATTRIB_NAME):(E(t,"Invalid attribute name"),t.state=a.ATTRIB)}continue;case a.ATTRIB_VALUE:if($(r))continue;H(r)?(t.q=r,t.state=a.ATTRIB_VALUE_QUOTED):(t.opt.unquotedAttributeValues||Y(t,"Unquoted attribute value"),t.state=a.ATTRIB_VALUE_UNQUOTED,t.attribValue=r);continue;case a.ATTRIB_VALUE_QUOTED:if(r!==t.q){r==="&"?t.state=a.ATTRIB_VALUE_ENTITY_Q:t.attribValue+=r;continue}me(t),t.q="",t.state=a.ATTRIB_VALUE_CLOSED;continue;case a.ATTRIB_VALUE_CLOSED:$(r)?t.state=a.ATTRIB:r===">"?j(t):r==="/"?t.state=a.OPEN_TAG_SLASH:M(B,r)?(E(t,"No whitespace between attributes"),t.attribName=r,t.attribValue="",t.state=a.ATTRIB_NAME):E(t,"Invalid attribute name");continue;case a.ATTRIB_VALUE_UNQUOTED:if(!ie(r)){r==="&"?t.state=a.ATTRIB_VALUE_ENTITY_U:t.attribValue+=r;continue}me(t),r===">"?j(t):t.state=a.ATTRIB;continue;case a.CLOSE_TAG:if(t.tagName)r===">"?ge(t):M(R,r)?t.tagName+=r:t.script?(t.script+="</"+t.tagName+r,t.tagName="",t.state=a.SCRIPT):($(r)||E(t,"Invalid tagname in closing tag"),t.state=a.CLOSE_TAG_SAW_WHITE);else{if($(r))continue;ue(B,r)?t.script?(t.script+="</"+r,t.state=a.SCRIPT):E(t,"Invalid tagname in closing tag."):t.tagName=r}continue;case a.CLOSE_TAG_SAW_WHITE:if($(r))continue;r===">"?ge(t):E(t,"Invalid characters in closing tag");continue;case a.TEXT_ENTITY:case a.ATTRIB_VALUE_ENTITY_Q:case a.ATTRIB_VALUE_ENTITY_U:var S,F;switch(t.state){case a.TEXT_ENTITY:S=a.TEXT,F="textNode";break;case a.ATTRIB_VALUE_ENTITY_Q:S=a.ATTRIB_VALUE_QUOTED,F="attribValue";break;case a.ATTRIB_VALUE_ENTITY_U:S=a.ATTRIB_VALUE_UNQUOTED,F="attribValue";break}if(r===";"){var O=Ke(t);t.opt.unparsedEntities&&!Object.values(e.XML_ENTITIES).includes(O)?((t.entityCount+=1)>t.opt.maxEntityCount&&Y(t,"Parsed entity count exceeds max entity count"),(t.entityDepth+=1)>t.opt.maxEntityDepth&&Y(t,"Parsed entity depth exceeds max entity depth"),t.entity="",t.state=S,t.write(O),t.entityDepth-=1):(t[F]+=O,t.entity="",t.state=S)}else M(t.entity.length?ne:X,r)?t.entity+=r:(E(t,"Invalid character in entity name"),t[F]+="&"+t.entity+r,t.entity="",t.state=S);continue;default:throw new Error(t,"Unknown state: "+t.state)}return t.position>=t.bufferCheckPosition&&s(t),t}String.fromCodePoint||function(){var o=String.fromCharCode,t=Math.floor,l=function(){var r=16384,y=[],N,S,F=-1,O=arguments.length;if(!O)return"";for(var G="";++F<O;){var I=Number(arguments[F]);if(!isFinite(I)||I<0||I>1114111||t(I)!==I)throw RangeError("Invalid code point: "+I);I<=65535?y.push(I):(I-=65536,N=(I>>10)+55296,S=I%1024+56320,y.push(N,S)),(F+1===O||y.length>r)&&(G+=o.apply(null,y),y.length=0)}return G};Object.defineProperty?Object.defineProperty(String,"fromCodePoint",{value:l,configurable:!0,writable:!0}):String.fromCodePoint=l}()})(typeof ae>"u"?ae.sax={}:ae)});var Pt={};rt(Pt,{activate:()=>Ot});module.exports=st(Pt);var P=se(require("vscode"));var h=se(require("vscode"));var $e=se(_e());var Ae={topic:"topic/topic",title:"topic/title",shortdesc:"topic/shortdesc",body:"topic/body",section:"topic/section",example:"topic/example",p:"topic/p",note:"topic/note",ul:"topic/ul",ol:"topic/ol",li:"topic/li",sl:"topic/sl",sli:"topic/sli",dl:"topic/dl",dlentry:"topic/dlentry",dt:"topic/dt",dd:"topic/dd",table:"topic/table",tgroup:"topic/tgroup",colspec:"topic/colspec",thead:"topic/thead",tbody:"topic/tbody",row:"topic/row",entry:"topic/entry",simpletable:"topic/simpletable",sthead:"topic/sthead",strow:"topic/strow",stentry:"topic/stentry",image:"topic/image",fig:"topic/fig",codeblock:"topic/codeblock",pre:"topic/pre",xref:"topic/xref",link:"topic/link",linktext:"topic/linktext",relatedLinks:"topic/related-links",b:"topic/b",i:"topic/i",u:"topic/u",tt:"topic/tt",sup:"topic/sup",sub:"topic/sub",q:"topic/q",lq:"topic/lq",keyword:"topic/keyword",term:"topic/term",uicontrol:"topic/uicontrol",wintitle:"topic/wintitle",menucascade:"topic/menucascade",filepath:"topic/filepath",userinput:"topic/userinput",systemoutput:"topic/systemoutput",apiname:"topic/apiname",option:"topic/option",parmname:"topic/parmname",cmdname:"topic/cmdname",varname:"topic/varname",msgnum:"topic/msgnum",ph:"topic/ph",draftComment:"topic/draft-comment",requiredCleanup:"topic/required-cleanup",data:"topic/data",dataAbout:"topic/data-about",foreign:"topic/foreign",state:"topic/state",codeph:"topic/codeph",coderef:"topic/coderef",synph:"topic/synph",kwd:"topic/kwd",var:"topic/var",oper:"topic/oper",sep:"topic/sep",delim:"topic/delim",fragment:"topic/fragment",fragref:"topic/fragref",synblk:"topic/synblk",synnote:"topic/synnote",synnoteref:"topic/synnoteref",syntaxdiagram:"topic/syntaxdiagram",screen:"topic/screen",msgph:"topic/msgph",msgblock:"topic/msgblock",lines:"topic/lines",fn:"topic/fn",cite:"topic/cite",boolean:"topic/boolean",tm:"topic/tm",indexterm:"topic/indexterm",indextermref:"topic/indextermref","index-see":"topic/index-see","index-see-also":"topic/index-see-also","index-sort-as":"topic/index-sort-as","index-base":"topic/index-base",div:"topic/div",sectiondiv:"topic/sectiondiv",bodydiv:"topic/bodydiv",desc:"topic/desc",alt:"topic/alt",parml:"topic/parml",plentry:"topic/plentry",pt:"topic/pt",pd:"topic/pd","abbreviated-form":"topic/abbreviated-form",glossterm:"topic/glossterm",glossdef:"topic/glossdef",glossentry:"topic/glossentry",glossref:"topic/glossref",glossgroup:"topic/glossgroup",hazardstatement:"topic/hazardstatement",typeofhazard:"topic/typeofhazard",hazardsymbol:"topic/hazardsymbol",howtoavoid:"topic/howtoavoid",consequence:"topic/consequence",object:"topic/object",param:"topic/param",anchor:"topic/anchor",anchorid:"topic/anchorid",anchorkey:"topic/anchorkey",anchorref:"topic/anchorref"};var Se={map:"map/map",title:"map/map-title",topicmeta:"map/topicmeta",navtitle:"map/navtitle",linktext:"map/linktext",shortdesc:"map/shortdesc",keywords:"map/keywords",keyword:"map/keyword",topicref:"map/topicref",topichead:"map/topichead",topicgroup:"map/topicgroup",keydef:"map/keydef",reltable:"map/reltable",relheader:"map/relheader",relrow:"map/relrow",relcell:"map/relcell",relcolspec:"map/relcolspec",anchor:"map/anchor",navref:"map/navref",mapref:"map/mapref"};var at=/^(topic|map)\//;function ct(e){return function(i,s){let c=e[i];if(c)return c;if(s){let d=s.trim().split(/\s+/);for(let p of d)if(at.test(p))return p}}}function lt(){return{startLine:0,startCol:0,endLine:0,endCol:0}}function Ie(e){let n=ct(e);return function(s){let c=$e.default.parser(!0,{trim:!1,normalize:!1}),d={type:"element",children:[],sourceRange:lt()},p=[d],u="",m=0,g=0;function f(){if(u.length>0){let v=p[p.length-1];v&&v.children.push({type:"text",text:u,children:[],sourceRange:{startLine:m,startCol:g,endLine:c.line,endCol:c.column}}),u=""}}c.onopentag=v=>{f();let b=v.name,T=v.attributes.class,k=n(b,T),B=T?T.trim().split(/\s+/).filter(Boolean):void 0,R={type:"element",tagName:b,classTokens:B,baseType:k,attributes:v.attributes,children:[],sourceRange:{startLine:c.line,startCol:c.column,endLine:0,endCol:0}},X=p[p.length-1];X&&X.children.push(R),p.push(R)},c.onclosetag=()=>{f();let v=p.pop();v&&(v.sourceRange.endLine=c.line,v.sourceRange.endCol=c.column)},c.ontext=v=>{u.length===0&&(m=c.line,g=c.column),u+=v},c.onerror=v=>{throw new Error(`SAX parse error at line ${c.line}:${c.column}: ${v.message}`)},c.write(s).close();let D=d.children.find(v=>v.type==="element");if(!D)throw new Error("No root element found in DITA document");return{root:D,sourceRange:D.sourceRange}}}function J(e){let n=/<!ENTITY\s+(\S+)\s+"((?:[^"\\]|\\.)*)">/g,i,s=[];for(;(i=n.exec(e))!==null;)s.push([i[1],i[2]]);if(s.length===0)return e;let c=e.replace(n,"");for(let[d,p]of s)c=c.replace(new RegExp(`&${d};`,"g"),p);return c}var dt=Ie(Ae),pt=Ie(Se);function be(e){return dt(e)}function ce(e){return pt(e)}function Re(e){return e.parentBaseType==="topic/thead"}function x(e,n){return e.attributes?.[n]}function C(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function U(e,n){return n==null?"":` ${e}="${C(n)}"`}var ke={"topic/topic":(e,n,i)=>{let s=x(e,"id");return`<article${U("id",s)} class="topic">${i(e,n)}</article>`},"topic/title":(e,n,i)=>{let s=Math.min(n.headingLevel,6);return`<h${s}>${i(e,n)}</h${s}>`},"topic/shortdesc":(e,n,i)=>`<p class="shortdesc">${i(e,n)}</p>`,"topic/body":(e,n,i)=>`<main class="body">${i(e,n)}</main>`,"topic/section":(e,n,i)=>{let s=x(e,"id");return`<section${U("id",s)}>${i(e,n)}</section>`},"topic/example":(e,n,i)=>{let s=x(e,"id");return`<section${U("id",s)} class="example">${i(e,n)}</section>`},"topic/p":(e,n,i)=>`<p>${i(e,n)}</p>`,"topic/note":(e,n,i)=>{let s=x(e,"type")||"note",d=(n.noteLabels||{note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"})[s]||s;return`<div class="note note--${C(s)}"><span class="note__label">${C(d)}:</span> ${i(e,n)}</div>`},"topic/ul":(e,n,i)=>`<ul>${i(e,n)}</ul>`,"topic/ol":(e,n,i)=>`<ol>${i(e,n)}</ol>`,"topic/li":(e,n,i)=>`<li>${i(e,n)}</li>`,"topic/sl":(e,n,i)=>`<ul class="simple-list">${i(e,n)}</ul>`,"topic/sli":(e,n,i)=>`<li>${i(e,n)}</li>`,"topic/dl":(e,n,i)=>`<dl>${i(e,n)}</dl>`,"topic/dlentry":(e,n,i)=>`<div class="dlentry">${i(e,n)}</div>`,"topic/dt":(e,n,i)=>`<dt>${i(e,n)}</dt>`,"topic/dd":(e,n,i)=>`<dd>${i(e,n)}</dd>`,"topic/table":(e,n,i)=>{let s=x(e,"id");return`<table${U("id",s)} class="cals-table">${i(e,n)}</table>`},"topic/tgroup":(e,n,i)=>i(e,n),"topic/colspec":()=>"","topic/thead":(e,n,i)=>`<thead>${i(e,n)}</thead>`,"topic/tbody":(e,n,i)=>`<tbody>${i(e,n)}</tbody>`,"topic/row":(e,n,i)=>`<tr>${i(e,n)}</tr>`,"topic/entry":(e,n,i)=>{let s=Re(n)?"th":"td";return`<${s}>${i(e,n)}</${s}>`},"topic/simpletable":(e,n,i)=>{let s=x(e,"id");return`<table${U("id",s)} class="simple-table">${i(e,n)}</table>`},"topic/sthead":(e,n,i)=>`<thead>${i(e,n)}</thead>`,"topic/strow":(e,n,i)=>`<tr>${i(e,n)}</tr>`,"topic/stentry":(e,n,i)=>{let s=Re(n)?"th":"td";return`<${s}>${i(e,n)}</${s}>`},"topic/image":(e,n)=>{let i=x(e,"href")||"",s=x(e,"alt")||"",c=x(e,"placement")||"inline",d=x(e,"width"),p=x(e,"height"),u=`${U("width",d)}${U("height",p)}`,m=i?n.asWebviewUri(i):"",g=c==="break"?' class="image-break"':"";return`<img src="${m||""}"${U("alt",s)}${u}${g} loading="lazy" data-dita-src="${C(i)}">`},"topic/fig":(e,n,i)=>{let s=x(e,"id"),c=(e.children||[]).find(m=>m.type==="element"&&m.baseType==="topic/title"),d=(e.children||[]).filter(m=>!(m.type==="element"&&m.baseType==="topic/title")),p=i({...e,children:d},n),u=c?`<figcaption>${i(c,{...n,headingLevel:n.headingLevel+1})}</figcaption>`:"";return`<figure${U("id",s)}>${p}${u}</figure>`},"topic/codeblock":(e,n,i)=>{let s=x(e,"outputclass")||"",c=s.replace(/^language-/,""),d=c?`<div class="codeblock-lang">${C(c)}</div>`:"";return`<pre class="codeblock ${C(s)}"><code>${i(e,n)}</code>${d}</pre>`},"topic/pre":(e,n,i)=>`<pre class="preformatted">${i(e,n)}</pre>`,"topic/xref":(e,n,i)=>{let s=x(e,"href")||"";if(!s)return"";let c;if(e.children.length>0)c=i(e,n);else if(s.startsWith("#")){let d=s.includes("/")?s.split("/").pop():s.slice(1);c=C(n.resolveTitle?.(d)??"")||C(s)}else s.includes("#")?c=C(n.resolveTitle?.(s)??"")||C(s):c=C(s);if(s.startsWith("#")){let d=s.includes("/")?"#"+s.split("/").pop():s;return`<a href="${C(d)}" class="xref">${c}</a>`}return`<span class="xref-external">\u2192 ${c}</span>`},"topic/link":(e,n,i)=>{let s=x(e,"href"),c=x(e,"keyref"),d=s||c||"";return d?`<a href="${C(d)}" class="link">${i(e,n)}</a>`:i(e,n)},"topic/linktext":(e,n,i)=>i(e,n),"topic/related-links":(e,n,i)=>`<aside class="related-links"><h2>Related links</h2>${i(e,n)}</aside>`,"topic/b":(e,n,i)=>`<strong>${i(e,n)}</strong>`,"topic/i":(e,n,i)=>`<em>${i(e,n)}</em>`,"topic/u":(e,n,i)=>`<u>${i(e,n)}</u>`,"topic/tt":(e,n,i)=>`<code>${i(e,n)}</code>`,"topic/sup":(e,n,i)=>`<sup>${i(e,n)}</sup>`,"topic/sub":(e,n,i)=>`<sub>${i(e,n)}</sub>`,"topic/q":(e,n,i)=>`<q>${i(e,n)}</q>`,"topic/lq":(e,n,i)=>`<blockquote>${i(e,n)}</blockquote>`,"topic/keyword":(e,n,i)=>`<span class="keyword">${i(e,n)}</span>`,"topic/term":(e,n,i)=>`<span class="term">${i(e,n)}</span>`,"topic/ph":(e,n,i)=>{let s=x(e,"keyref");if(s&&n.resolveKey){let c=n.resolveKey(s);return c?`<span class="ph">${C(c)}</span>`:`<span class="ph unresolved-keyref" title="Unresolved key: ${C(s)}">[${C(s)}]</span>`}return`<span class="ph">${i(e,n)}</span>`},"topic/uicontrol":(e,n,i)=>`<span class="uicontrol">${i(e,n)}</span>`,"topic/wintitle":(e,n,i)=>`<span class="wintitle">${i(e,n)}</span>`,"topic/menucascade":(e,n,i)=>`<span class="menucascade">${i(e,n)}</span>`,"topic/filepath":(e,n,i)=>`<span class="filepath">${i(e,n)}</span>`,"topic/userinput":(e,n,i)=>`<span class="userinput">${i(e,n)}</span>`,"topic/systemoutput":(e,n,i)=>`<span class="systemoutput">${i(e,n)}</span>`,"topic/apiname":(e,n,i)=>`<span class="apiname">${i(e,n)}</span>`,"topic/option":(e,n,i)=>`<span class="option">${i(e,n)}</span>`,"topic/parmname":(e,n,i)=>`<span class="parmname">${i(e,n)}</span>`,"topic/cmdname":(e,n,i)=>`<span class="cmdname">${i(e,n)}</span>`,"topic/varname":(e,n,i)=>`<span class="varname">${i(e,n)}</span>`,"topic/msgnum":(e,n,i)=>`<span class="msgnum">${i(e,n)}</span>`,"topic/codeph":(e,n,i)=>`<code class="codeph">${i(e,n)}</code>`,"topic/coderef":(e,n,i)=>`<span class="coderef">${i(e,n)}</span>`,"topic/synph":(e,n,i)=>`<span class="synph">${i(e,n)}</span>`,"topic/kwd":(e,n,i)=>`<span class="kwd">${i(e,n)}</span>`,"topic/var":(e,n,i)=>`<span class="var">${i(e,n)}</span>`,"topic/oper":(e,n,i)=>`<span class="oper">${i(e,n)}</span>`,"topic/sep":(e,n,i)=>`<span class="sep">${i(e,n)}</span>`,"topic/delim":(e,n,i)=>`<span class="delim">${i(e,n)}</span>`,"topic/fragment":(e,n,i)=>`<span class="fragment">${i(e,n)}</span>`,"topic/fragref":(e,n,i)=>`<span class="fragref">${i(e,n)}</span>`,"topic/synblk":(e,n,i)=>`<pre class="synblk">${i(e,n)}</pre>`,"topic/synnote":(e,n,i)=>`<div class="synnote">${i(e,n)}</div>`,"topic/synnoteref":(e,n,i)=>`<span class="synnoteref">${i(e,n)}</span>`,"topic/syntaxdiagram":(e,n,i)=>`<div class="syntaxdiagram">${i(e,n)}</div>`,"topic/screen":(e,n,i)=>`<pre class="screen">${i(e,n)}</pre>`,"topic/msgph":(e,n,i)=>`<span class="msgph">${i(e,n)}</span>`,"topic/msgblock":(e,n,i)=>`<pre class="msgblock">${i(e,n)}</pre>`,"topic/lines":(e,n,i)=>`<pre class="lines">${i(e,n)}</pre>`,"topic/fn":(e,n,i)=>{let s=x(e,"id");return`<sup class="fn${s?` fn-call-${C(s)}`:""}">${i(e,n)}</sup>`},"topic/cite":(e,n,i)=>`<cite>${i(e,n)}</cite>`,"topic/boolean":(e,n,i)=>{let s=x(e,"value")||"";return`<span class="boolean" data-value="${C(s)}">${C(s)||i(e,n)}</span>`},"topic/tm":(e,n,i)=>`<span class="tm">${i(e,n)}</span>`,"topic/indexterm":()=>"","topic/indextermref":()=>"","topic/index-see":()=>"","topic/index-see-also":()=>"","topic/index-sort-as":()=>"","topic/index-base":()=>"","topic/div":(e,n,i)=>`<div class="body-div">${i(e,n)}</div>`,"topic/sectiondiv":(e,n,i)=>`<div class="section-div">${i(e,n)}</div>`,"topic/bodydiv":(e,n,i)=>`<div class="body-div">${i(e,n)}</div>`,"topic/desc":(e,n,i)=>`<span class="desc">${i(e,n)}</span>`,"topic/alt":(e,n,i)=>`<span class="alt">${i(e,n)}</span>`,"topic/parml":(e,n,i)=>`<dl class="parml">${i(e,n)}</dl>`,"topic/plentry":(e,n,i)=>`<div class="plentry">${i(e,n)}</div>`,"topic/pt":(e,n,i)=>`<dt class="pt">${i(e,n)}</dt>`,"topic/pd":(e,n,i)=>`<dd class="pd">${i(e,n)}</dd>`,"topic/abbreviated-form":(e,n,i)=>{let s=x(e,"keyref");return s&&n.resolveKey?`<abbr class="abbreviated-form" title="${C(s)}">${C(n.resolveKey(s)||s)}</abbr>`:`<abbr class="abbreviated-form">${i(e,n)}</abbr>`},"topic/glossterm":(e,n,i)=>`<dfn class="glossterm">${i(e,n)}</dfn>`,"topic/glossdef":(e,n,i)=>`<dd class="glossdef">${i(e,n)}</dd>`,"topic/glossentry":(e,n,i)=>`<dl class="glossentry">${i(e,n)}</dl>`,"topic/glossref":(e,n,i)=>`<span class="glossref">${i(e,n)}</span>`,"topic/glossgroup":(e,n,i)=>`<div class="glossgroup">${i(e,n)}</div>`,"topic/hazardstatement":(e,n,i)=>`<div class="hazardstatement">${i(e,n)}</div>`,"topic/typeofhazard":(e,n,i)=>`<span class="typeofhazard">${i(e,n)}</span>`,"topic/hazardsymbol":()=>"","topic/howtoavoid":(e,n,i)=>`<p class="howtoavoid">${i(e,n)}</p>`,"topic/consequence":(e,n,i)=>`<p class="consequence">${i(e,n)}</p>`,"topic/object":(e,n,i)=>`<object class="dita-object">${i(e,n)}</object>`,"topic/param":()=>"","topic/anchor":e=>{let n=x(e,"id");return n?`<a${U("id",n)}></a>`:""},"topic/anchorid":e=>{let n=x(e,"id");return n?`<span${U("id",n)}></span>`:""},"topic/anchorkey":()=>"","topic/anchorref":()=>""};var ut=new Set(["topic/section","topic/example","topic/fig","topic/related-links"]),ft=new Set(["topic/tgroup","topic/link","topic/linktext"]);function mt(e){return ut.has(e)}function gt(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function ht(e,n,i){return e.replace(/^<([a-zA-Z][a-zA-Z0-9]*)/,`<$1 title="${n}" data-line="${i}"`)}function vt(e,n){return{type:"text",text:e,children:[],sourceRange:n}}function bt(e,n){let i=e.attributes?.conref;if(!i||!n.resolveConref)return e;let s=n.resolveConref(i);if(!s)return e;let{conref:c,...d}=e.attributes||{};return{...e,children:[vt(s,e.sourceRange)],attributes:d}}function Fe(e,n){if(e.type==="text")return gt(e.text||"");let i=bt(e,n),s=i.baseType,c=s?ke[s]:void 0,p=(s?mt(s):!1)?n.headingLevel+1:n.headingLevel,u={...n,headingLevel:p,parentBaseType:s};if(c){let m=c(i,u,Le);if(s&&!ft.has(s)){let g=i.tagName||s.split("/").pop()||s;m=ht(m,g,i.sourceRange.startLine)}return m}return Le(i,u)}function Le(e,n){return(e.children||[]).map(i=>Fe(i,n)).join("")}function Oe(e,n){return Fe(e,n)}var A=require("fs"),w=require("path"),Be=require("crypto");function Tt(){return`
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
`}var le=class{constructor(n){this.context=n}async resolveCustomTextEditor(n,i,s){let c=h.Uri.file((0,w.dirname)(n.uri.fsPath));i.webview.options={enableScripts:!0,localResourceRoots:[h.Uri.file(this.context.extensionPath),c,...(h.workspace.workspaceFolders||[]).map(b=>b.uri)]};let d=()=>h.window.visibleTextEditors.find(b=>b.document.uri.toString()===n.uri.toString()),p=b=>{i.webview.postMessage({type:"revealLine",line:b})},u=0;i.webview.onDidReceiveMessage(b=>{if(b.type==="refresh")v(),setTimeout(g,200);else if(b.type==="scrollSync"){let T=d();if(T){let k=T.visibleRanges[0]?.start.line;if(k!==void 0&&Math.abs(b.line-k)>=2){u=Date.now()+250;let R=Math.max(0,Math.min(b.line,n.lineCount-1));T.revealRange(new h.Range(R,0,R,0),h.TextEditorRevealType.AtTop),T.selection=new h.Selection(new h.Position(R,0),new h.Position(R,0))}}}else if(b.type==="navigateToLine"){let T=d();if(T){let k=Math.max(0,Math.min(b.line,n.lineCount-1));T.visibleRanges.some(R=>k>=R.start.line&&k<=R.end.line)||T.revealRange(new h.Range(k,0,k,0),h.TextEditorRevealType.AtTop),T.selection=new h.Selection(new h.Position(k,0),new h.Position(k,0))}}});let m=h.window.onDidChangeTextEditorSelection(b=>{if(b.textEditor.document.uri.toString()!==n.uri.toString()||Date.now()<u)return;let T=b.selections[0];!T||T.start.line!==T.end.line||i.webview.postMessage({type:"highlightLine",line:T.start.line})}),g=()=>{let b=d();if(b){let T=b.visibleRanges[0]?.start.line;T!==void 0&&p(T)}},f=h.window.onDidChangeTextEditorVisibleRanges(b=>{if(b.textEditor.document.uri.toString()===n.uri.toString()){if(Date.now()<u)return;let T=b.textEditor.visibleRanges[0]?.start.line;T!==void 0&&p(T)}}),D=h.workspace.onDidChangeTextDocument(b=>{b.document.uri.toString()===n.uri.toString()&&(v(),setTimeout(g,200))}),v=()=>{let b=this.generateHtml(n,i.webview);i.webview.html=b};v(),setTimeout(g,300),i.onDidDispose(()=>{D.dispose(),f.dispose(),m.dispose()})}generateHtml(n,i){let s=i.asWebviewUri(h.Uri.file((0,w.join)(this.context.extensionPath,"media","styles.css"))),c=(0,w.dirname)(n.uri.fsPath),d=h.Uri.file(c),p=u=>{try{let m=(0,w.resolve)(c,u),g=h.Uri.file(m),f=i.asWebviewUri(g);if(f)return f.toString()}catch{}try{let m=(0,w.resolve)(c,u);if((0,A.existsSync)(m)){let g=(0,A.readFileSync)(m),f=(0,w.extname)(u).toLowerCase();return`data:${f===".png"?"image/png":f===".jpg"||f===".jpeg"?"image/jpeg":f===".gif"?"image/gif":f===".svg"?"image/svg+xml":f===".webp"?"image/webp":"image/png"};base64,${g.toString("base64")}`}}catch{}return""};try{let u=n.getText(),m=J(u),g=be(m),f=Et(g.root),b=(g.root.attributes?.["xml:lang"]||"").startsWith("zh")?{note:"\u6CE8",notice:"\u6CE8\u610F",warning:"\u8B66\u544A",danger:"\u5371\u9669",important:"\u91CD\u8981",tip:"\u63D0\u793A",restriction:"\u9650\u5236"}:{note:"Note",notice:"Notice",warning:"Warning",danger:"Danger",important:"Important",tip:"Tip",restriction:"Restriction"},T=Nt(n.uri),k=Ct(c),B=_t(c),R=z=>{let Q=f.get(z);if(Q)return Q;if(z.includes("#"))return B(z)},X=Oe(g.root,{headingLevel:1,asWebviewUri:p,documentDir:d.fsPath,resolveTitle:R,resolveKey:z=>T.get(z),resolveConref:z=>k(z),noteLabels:b}),{files:ne,defaultName:$}=At(n.uri),H=ne[$]||"",ie=h.window.activeColorTheme,M=ie.kind===h.ColorThemeKind.Dark||ie.kind===h.ColorThemeKind.HighContrast,ue=Tt(),a=Pe(JSON.stringify(ne)),oe=Pe(JSON.stringify($)),V=(0,Be.randomBytes)(16).toString("base64");return`<!DOCTYPE html>
<html lang="en"${M?' class="vscode-dark"':""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${i.cspSource} data:; style-src ${i.cspSource} 'unsafe-inline'; script-src 'nonce-${V}';">
<link rel="stylesheet" href="${s}">
${H?`<style>
${H}
</style>`:""}
<title>${n.fileName}</title>
<script nonce="${V}">window.__cssFiles=${a};window.__defaultCss=${oe};</script>
</head>
<body>
${X}
<script nonce="${V}">${ue}</script>
</body>
</html>`}catch(u){let m=u instanceof Error?u.message:String(u);return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Render Error</h2>
<pre>${yt(m)}</pre>
</div>
</body>
</html>`}}};function yt(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function Pe(e){return e.replace(/<\/script>/gi,"<\\/script>")}function Te(e){return e.type==="text"?e.text||"":(e.children||[]).map(Te).join("")}function Et(e){let n=new Map;function i(s){if(s.type==="element"){let c=s.attributes?.id;if(c){let d=(s.children||[]).find(p=>p.type==="element"&&p.baseType==="topic/title");d&&n.set(c,Te(d))}for(let d of s.children||[])i(d)}}return i(e),n}function wt(e){let n=[],i=(0,w.dirname)(e.fsPath),s=ye(i),c=i;for(;c.length>=s.length;){try{for(let p of(0,A.readdirSync)(c))p.endsWith(".ditamap")&&n.push((0,w.join)(c,p))}catch{}if(n.length>0)return n;let d=(0,w.dirname)(c);if(d===c)break;c=d}return n}function Me(e){return e.type==="text"?e.text||"":(e.children||[]).map(Me).join("")}function Dt(e,n){for(let i of n){let s=(e.children||[]).find(c=>c.type==="element"&&c.baseType===i);if(s){let c=Me(s).trim();if(c)return c}}}function xt(e){let n=(e.children||[]).find(i=>i.type==="element"&&i.baseType==="map/topicmeta");if(n)return Dt(n,["map/keyword","map/linktext","map/navtitle","map/shortdesc"])}function Nt(e){let n=new Map,i=wt(e);for(let c of i)try{let m=function(g){if(g.type!=="element")return;let f=g.baseType;if((f==="map/topicref"||f==="map/keydef")&&g.attributes?.keys){let D=g.attributes.keys,v=xt(g);n.set(D,v||D)}for(let D of g.children||[])m(D)};var s=m;let d=(0,A.readFileSync)(c,"utf-8"),u=ce(J(d)).root;for(let g of u.children||[])m(g)}catch{}return n}function Ue(e){let n=new Map;function i(d){let p=(0,w.resolve)(e,d);if(n.has(p))return n.get(p);if(!(0,A.existsSync)(p)){n.set(p,void 0);return}try{let u=(0,A.readFileSync)(p,"utf-8"),m=be(u);return n.set(p,m.root),m.root}catch{n.set(p,void 0);return}}function s(d,p){if(d.attributes?.id===p)return d;for(let u of d.children||[]){let m=s(u,p);if(m)return m}}function c(d,p){let u=s(d,p);if(!u)return;let m=(u.children||[]).find(g=>g.type==="element"&&g.baseType==="topic/title");if(m)return Te(m)}return{loadFile:i,findElementById:s,findTitleOfElement:c}}function Ct(e){let n=Ue(e);function i(s){let c="";for(let d of s.children||[])d.type==="text"?c+=d.text||"":c+=i(d);return c}return s=>{let c=s.indexOf("#");if(c<0)return;let d=s.substring(0,c),u=s.substring(c+1).split("/"),m=u.length>1?u[1]:u[0],g=n.loadFile(d);if(!g)return;let f=n.findElementById(g,m);if(f)return i(f)}}function _t(e){let n=Ue(e);return i=>{let s=i.indexOf("#");if(s<0)return;let c=i.substring(0,s),p=i.substring(s+1).split("/")[0],u=n.loadFile(c);if(u)return n.findTitleOfElement(u,p)}}function At(e){let n={},i=new Set,s=g=>{let f=(0,w.basename)(g);if(!i.has(f)&&(0,A.existsSync)(g))try{n[f]=(0,A.readFileSync)(g,"utf-8"),i.add(f)}catch{}},c=(0,w.dirname)(e.fsPath),d=ye(c),p=St(c),u=new Set;u.add(p),d!==p&&u.add(d);try{let f=h.workspace.getConfiguration("dita-viewer").get("cssDirectory");if(f)for(let D of f){let v=It(D,c);v&&(0,A.existsSync)(v)&&!u.has(v)&&u.add(v)}}catch{}for(let g of u)try{for(let f of(0,A.readdirSync)(g))f.toLowerCase().endsWith(".css")&&s((0,w.join)(g,f))}catch{}try{let f=h.workspace.getConfiguration("dita-viewer").get("customCss");if(f)for(let D of f){let v=$t(D,c);v&&s(v)}}catch{}let m=n["custom.css"]?"custom.css":Object.keys(n)[0]||"";return{files:n,defaultName:m}}function St(e){let n=ye(e),i=e;for(;i.length>=n.length;){if((0,A.existsSync)((0,w.join)(i,"custom.css")))return i;let s=(0,w.dirname)(i);if(s===i)break;i=s}return e}function ye(e){let n=h.workspace.workspaceFolders;if(n&&n.length>0)return n[0].uri.fsPath;let i=e.includes("/")?"/":"\\",s=e.split(/[\\/]/);return i==="/"?"/"+s.slice(1,2).join("/"):s.length>2?s.slice(0,2).join("\\"):e}function $t(e,n){if((0,w.isAbsolute)(e)&&(0,A.existsSync)(e))return e;let i=(0,w.resolve)(n,e);if((0,A.existsSync)(i))return i;let s=h.workspace.workspaceFolders;if(s)for(let c of s){let d=(0,w.resolve)(c.uri.fsPath,e);if((0,A.existsSync)(d))return d}}function It(e,n){if((0,w.isAbsolute)(e))return(0,A.existsSync)(e)?e:void 0;let i=(0,w.resolve)(n,e);if((0,A.existsSync)(i))return i;let s=h.workspace.workspaceFolders;if(s)for(let c of s){let d=(0,w.resolve)(c.uri.fsPath,e);if((0,A.existsSync)(d))return d}}var L=se(require("vscode"));function K(e){return e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function Ve(e,n){return n==null?"":` ${e}="${K(n)}"`}function te(e,n){return e.attributes?.[n]}function de(e){return e.type==="text"?e.text||"":(e.children||[]).map(de).join("")}function ze(e,n){for(let i of n){let s=(e.children||[]).find(c=>c.type==="element"&&c.baseType===i);if(s){let c=de(s).trim();if(c)return c}}}function qe(e){let n=te(e,"keys"),i=te(e,"href"),s=(e.children||[]).find(c=>c.type==="element"&&c.baseType==="map/topicmeta");if(s){let c=ze(s,["map/navtitle","map/linktext","map/shortdesc"]);if(c)return c;let d=s.children.find(p=>p.type==="element"&&p.baseType==="map/keywords");if(d){let p=ze(d,["map/keyword"]);if(p)return p}}if(i){let c=i.replace(/\\/g,"/").split("/"),d=c[c.length-1]||"",p=d.lastIndexOf(".");return p>0?d.substring(0,p):d}return n||"(unnamed)"}function Rt(e){return!!te(e,"href")}function ee(e,n,i){return(e.children||[]).filter(s=>s.type==="element").map(s=>i(s,n)).join("")}function Ge(e,n,i){let s=te(e,"href")||"",c=te(e,"keys")||"",d=qe(e),p=Rt(e),u=ee(e,n,i),m=p?'<span class="map-tree-icon map-tree-icon--file">\u{1F4C4}</span>':'<span class="map-tree-icon map-tree-icon--key">\u{1F511}</span>',g=K(d),f=Ve("data-keys",c),D=s?Ve("data-href",s):"";return p?`<li class="map-tree-item map-tree-item--nav"${f}${D}>
      <a href="#" class="map-tree-link" data-href="${K(s)}">${m}<span class="map-tree-label">${g}</span></a>
      ${u?`<ul class="map-tree">${u}</ul>`:""}
    </li>`:`<li class="map-tree-item map-tree-item--keydef"${f}${D}>
    ${m}<span class="map-tree-label map-tree-label--keydef">${g}</span>
    ${u?`<ul class="map-tree">${u}</ul>`:""}
  </li>`}var kt={"map/map":(e,n,i)=>{let s=e.children.find(u=>u.type==="element"&&u.baseType==="map/map-title"),c=s?`<h1 class="map-title">${K(de(s))}</h1>`:"",p=e.children.filter(u=>u.type!=="element"||u.baseType!=="map/map-title").filter(u=>u.type==="element").map(u=>i(u,n)).join("");return`<div class="ditamap-container">
      ${c}
      <ul class="map-tree">${p}</ul>
    </div>`},"map/map-title":(e,n,i)=>`<h1 class="map-title">${K(de(e))}</h1>`,"map/topicref":Ge,"map/topichead":(e,n,i)=>{let s=qe(e),c=ee(e,n,i);return`<li class="map-tree-item map-tree-item--head">
      <span class="map-tree-label map-tree-label--head">${K(s)}</span>
      ${c?`<ul class="map-tree">${c}</ul>`:""}
    </li>`},"map/topicgroup":(e,n,i)=>`<li class="map-tree-item map-tree-item--group">
      <ul class="map-tree">${ee(e,n,i)}</ul>
    </li>`,"map/keydef":Ge,"map/reltable":(e,n,i)=>`<div class="map-reltable"><h2 class="map-reltable-title">Related Information</h2>
      <table class="map-reltable-table"><tbody>${e.children.filter(d=>d.type==="element"&&(d.baseType==="map/relheader"||d.baseType==="map/relrow")).map(d=>i(d,n)).join("")}</tbody></table>
    </div>`,"map/relheader":(e,n,i)=>`<tr class="relheader">${e.children.filter(c=>c.type==="element"&&c.baseType==="map/relcell").map(c=>i(c,n)).map(c=>`<th>${c}</th>`).join("")}</tr>`,"map/relrow":(e,n,i)=>`<tr class="relrow">${e.children.filter(c=>c.type==="element"&&c.baseType==="map/relcell").map(c=>i(c,n)).map(c=>`<td>${c}</td>`).join("")}</tr>`,"map/relcell":(e,n,i)=>`<span class="relcell-content"><ul class="map-tree map-tree--inline">${ee(e,n,i)}</ul></span>`,"map/relcolspec":()=>"","map/topicmeta":()=>"","map/linktext":()=>"","map/navtitle":()=>"","map/shortdesc":()=>"","map/keywords":()=>"","map/keyword":()=>"","map/anchor":()=>"","map/navref":()=>"","map/mapref":()=>""};function We(e,n){function i(c,d){if(c.type==="text")return"";let p=c.baseType,u=p?kt[p]:void 0;return u?u(c,d,i):ee(c,d,i)}let s={docDir:n.docDir};return i(e,s)}var W=require("path"),He=require("crypto");function Lt(){return`
(function() {
  var vscode = acquireVsCodeApi();

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

  document.body.appendChild(toolbar);
})();
`}var pe=class{constructor(n){this.context=n}async resolveCustomTextEditor(n,i,s){let c=L.Uri.file((0,W.dirname)(n.uri.fsPath));i.webview.options={enableScripts:!0,localResourceRoots:[L.Uri.file(this.context.extensionPath),c,...(L.workspace.workspaceFolders||[]).map(u=>u.uri)]},i.webview.onDidReceiveMessage(u=>{if(u.type==="refresh")p();else if(u.type==="openTopic"){let m=u.href;if(!m)return;let g=(0,W.dirname)(n.uri.fsPath),f=(0,W.resolve)(g,m),D=L.Uri.file(f);L.commands.executeCommand("vscode.openWith",D,"ditaViewer.preview")}});let d=L.workspace.onDidChangeTextDocument(u=>{u.document.uri.toString()===n.uri.toString()&&p()}),p=()=>{let u=this.generateHtml(n,i.webview);i.webview.html=u};p(),i.onDidDispose(()=>{d.dispose()})}generateHtml(n,i){let s=i.asWebviewUri(L.Uri.file((0,W.join)(this.context.extensionPath,"media","styles.css"))),c=(0,W.dirname)(n.uri.fsPath);try{let d=n.getText(),p=J(d),u=ce(p),m=We(u.root,{docDir:c}),g=Lt(),f=(0,He.randomBytes)(16).toString("base64"),D=L.window.activeColorTheme;return`<!DOCTYPE html>
<html lang="en"${D.kind===L.ColorThemeKind.Dark||D.kind===L.ColorThemeKind.HighContrast?' class="vscode-dark"':""}>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${i.cspSource} data:; style-src ${i.cspSource} 'unsafe-inline'; script-src 'nonce-${f}';">
<link rel="stylesheet" href="${s}">
<title>${n.fileName}</title>
</head>
<body>
${m}
<script nonce="${f}">${g}</script>
</body>
</html>`}catch(d){let p=d instanceof Error?d.message:String(d);return`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Error</title></head>
<body>
<div style="padding:2rem;color:#c0392b;">
<h2>Map Render Error</h2>
<pre>${Ft(p)}</pre>
</div>
</body>
</html>`}}};function Ft(e){return e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function Ot(e){e.subscriptions.push(P.window.registerCustomEditorProvider("ditaViewer.preview",new le(e),{webviewOptions:{retainContextWhenHidden:!0}})),e.subscriptions.push(P.window.registerCustomEditorProvider("ditaViewer.mapPreview",new pe(e),{webviewOptions:{retainContextWhenHidden:!0}}));let n=P.commands.registerCommand("ditaViewer.showRendered",()=>{let s=P.window.activeTextEditor;s&&P.commands.executeCommand("vscode.openWith",s.document.uri,"ditaViewer.preview",P.ViewColumn.Beside)});e.subscriptions.push(n);let i=P.commands.registerCommand("ditaViewer.showMapRendered",()=>{let s=P.window.activeTextEditor;s&&P.commands.executeCommand("vscode.openWith",s.document.uri,"ditaViewer.mapPreview",P.ViewColumn.Beside)});e.subscriptions.push(i)}0&&(module.exports={activate});
/*! Bundled license information:

sax/lib/sax.js:
  (*! http://mths.be/fromcodepoint v0.1.0 by @mathias *)
*/
