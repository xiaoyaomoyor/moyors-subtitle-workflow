// Deliberately small, paired subtitle syntax; no HTML or raw ASS evaluation.
(function(global) {
  'use strict';
  const markers=['**','__','~~','--','++','%%','//'];
  const enabled=project=>project?.preview?.inline_markup===true;
  function parse(value) {
    const source=String(value??''),tokens=[],escaped=new Map(),stack=[],pairs=[];
    const markerAt=i=>markers.includes(source.slice(i,i+2))&&source[i-1]!==source[i]&&source[i+2]!==source[i]?source.slice(i,i+2):null;
    for(let i=0;i<source.length;i++) {
      if(source[i]==='\\'&&(markers.includes(source.slice(i+1,i+3))||source[i+1]==='\\')) {
        const length=source[i+1]==='\\'?2:3;escaped.set(i,length);i+=length-1;continue;
      }
      const marker=markerAt(i);
      if(!marker||marker==='//'&&source[i-1]===':')continue;
      tokens.push({start:i,marker});i++;
    }
    for(const token of tokens) {
      const last=stack.at(-1);
      if(last?.marker===token.marker&&token.start>last.start+2&&/\S/.test(source.slice(last.start+2,token.start))) {
        pairs.push({...last,end:token.start+2});stack.pop();
      } else if(!stack.some(t=>t.marker===token.marker))stack.push(token);
    }
    pairs.sort((a,b)=>a.start-b.start);
    const opens=new Map(pairs.map(p=>[p.start,p])),closes=new Map(pairs.map(p=>[p.end-2,p]));
    const runs=[],units=[],active=[];
    function append(text,start,end) {
      const marks=[...active];
      if(runs.length&&runs.at(-1).marks.join()===marks.join())runs.at(-1).text+=text;
      else runs.push({text,marks});
      units.push({text,marks,start,end});
    }
    for(let i=0;i<source.length;) {
      if(opens.has(i)){active.push(opens.get(i).marker);i+=2;continue;}
      if(closes.has(i)){active.splice(active.lastIndexOf(closes.get(i).marker),1);i+=2;continue;}
      if(escaped.has(i)){const n=escaped.get(i);append(source.slice(i+1,i+n),i,i+n);i+=n;continue;}
      const ch=String.fromCodePoint(source.codePointAt(i));append(ch,i,i+ch.length);i+=ch.length;
    }
    return {text:runs.map(r=>r.text).join(''),runs,units,pairs};
  }
  const plain=(text,on=true)=>on?parse(text).text:String(text??'');
  function clearStyles(value,on=false) {
    const text=String(value??'');if(!on)return text;
    // Preserve literal addresses and paths, and keep escapes verbatim. Plain
    // export intentionally unescapes text; editing must not do that implicitly.
    const literals=[...text.matchAll(/(?:[a-z][a-z\d+.-]*:\/\/|[a-z]:[\\/]|\\\\|\.{1,2}[\\/]|(?<![\w/])\/(?!\/))[^\s<>"']+/giu)];
    const removed=new Set();
    for(const pair of parse(text).pairs) {
      if(literals.some(m=>pair.start>=m.index&&pair.start<m.index+m[0].length
        ||pair.end-2>=m.index&&pair.end<m.index+m[0].length))continue;
      for(const i of [pair.start,pair.start+1,pair.end-2,pair.end-1])removed.add(i);
    }
    return Array.from({length:text.length},(_,i)=>removed.has(i)?'':text[i]).join('');
  }
  function appearance(base,marks) {
    const style={...base};let scale=1;
    for(const mark of marks) {
      if(mark==='**'){style.bold=true;style.primaryColor='#ffaa00';scale*=1.3;}
      if(mark==='%%'){style.primaryColor='#999999';scale*=.8;}
      if(mark==='++')scale*=1.5;
      if(mark==='--')scale*=.8;
      if(mark==='//')style.italic=true;
      if(mark==='__')style.underline=true;
      if(mark==='~~')style.strikeOut=true;
    }
    style.fontSize=base.fontSize*scale;return style;
  }
  function trimVisible(text,side,cleaner=null) {
    const parsed=parse(text),keep=[...parsed.units];
    const target=cleaner?cleaner(parsed.text,side):side==='left'?parsed.text.trimEnd():parsed.text.trimStart();
    let remove=parsed.text.length-target.length;
    if(side==='left')while(keep.length&&remove>0)remove-=keep.pop().text.length;
    else while(keep.length&&remove>0)remove-=keep.shift().text.length;
    const kept=new Set(keep),removed=new Set();
    for(const unit of parsed.units)if(!kept.has(unit))for(let i=unit.start;i<unit.end;i++)removed.add(i);
    for(const p of parsed.pairs)if(!keep.some(u=>u.start>=p.start+2&&u.end<=p.end-2))for(const i of [p.start,p.start+1,p.end-2,p.end-1])removed.add(i);
    let result='';for(let i=0;i<text.length;i++)if(!removed.has(i))result+=text[i];return result;
  }
  function split(text,offset,{trim=false}={}) {
    const parsed=parse(text);let cut=Math.max(0,Math.min(text.length,offset));
    for(const p of parsed.pairs)for(const boundary of [p.start,p.end-2])if(cut>boundary&&cut<boundary+2)cut=boundary+2;
    for(const u of parsed.units)if(cut>u.start&&cut<u.end)cut=u.end;
    const removed=new Set();let suffix='',prefix='';
    for(const p of parsed.pairs)if(p.start<cut&&cut<p.end) {
      const leftHas=parsed.units.some(u=>u.start>=p.start+2&&u.end<=cut),rightHas=parsed.units.some(u=>u.start>=cut&&u.end<=p.end-2);
      if(leftHas)suffix=p.marker+suffix;else{removed.add(p.start);removed.add(p.start+1);}
      if(rightHas)prefix+=p.marker;else{removed.add(p.end-2);removed.add(p.end-1);}
    }
    let left='',right='';for(let i=0;i<text.length;i++)if(!removed.has(i)){if(i<cut)left+=text[i];else right+=text[i];}
    left+=suffix;right=prefix+right;
    const cleaner=typeof trim==='function'?trim:null;
    return {left:trim?trimVisible(left,'left',cleaner):left,right:trim?trimVisible(right,'right',cleaner):right,offset:cut};
  }
  function display(text,style,prefix='') {
    const segment=value=>typeof Intl.Segmenter==='function'?[...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value)].map(s=>s.segment):Array.from(value);
    const runs=[{text:prefix,marks:[]},...parse(String(text).replace(/\r\n?/g,'\n')).runs];
    const marks=runs.flatMap(r=>Array.from({length:r.text.length},()=>r.marks));
    const units=[];let count=0,at=0;
    for(const text of segment(runs.map(r=>r.text).join(''))) {
      if(text==='\n')count=0;
      else if(style.wrapMode==='characters'&&count>=style.charsPerLine){units.push({text:'\n',marks:[]});count=0;}
      units.push({text,marks:marks[at]});at+=text.length;if(text!=='\n')count++;
    }
    return units;
  }
  function join(texts,separator='') {
    if(!texts.length)return '';
    return texts.reduce((left,right)=>{
      const a=parse(left),b=parse(right);let remove=0;
      while(true){
        const close=a.pairs.find(p=>p.end===left.length-remove),open=b.pairs.find(p=>p.start===remove);
        if(!close||!open||close.marker!==open.marker)break;remove+=2;
      }
      return left.slice(0,left.length-remove)+separator+right.slice(remove);
    });
  }
  function retargetItems(items,text) {
    if(!items?.length)return [];
    const body=items.map(i=>i.text).join(''),at=body?text.indexOf(body):-1;
    const result=items.map(i=>({...i}));
    if(at>=0){result[0].text=text.slice(0,at)+result[0].text;result.at(-1).text+=text.slice(at+body.length);return result;}
    // Folding removes only marker characters at a join, possibly adding a
    // word separator. Retain every real letter and its original word timing.
    const source=items.flatMap((item,owner)=>Array.from(item.text,ch=>({ch,owner}))),symbol=ch=>'*_~+-/%'.includes(ch);
    for(const item of result)item.text='';let cursor=0;
    for(const ch of text) {
      if(!symbol(ch)&&!ch.trim()) {
        if(source[cursor]?.ch===ch){result[source[cursor].owner].text+=ch;cursor++;}
        else result[source[cursor]?.owner??result.length-1].text+=ch;
        continue;
      }
      if(!symbol(ch))while(cursor<source.length&&symbol(source[cursor].ch)&&source[cursor].ch!==ch)cursor++;
      if(source[cursor]?.ch===ch){result[source[cursor].owner].text+=ch;cursor++;}
      else if(symbol(ch))result[source[cursor]?.owner??result.length-1].text+=ch;
      else return [];
    }
    if(source.slice(cursor).some(u=>!symbol(u.ch)))return [];
    return result.filter(i=>i.text);
  }
  function applyCss(node,style) {
    Object.assign(node.style,{fontSize:style.fontSize+'px',fontWeight:style.bold?'bold':'normal',fontStyle:style.italic?'italic':'normal',
      textDecoration:[style.underline?'underline':'',style.strikeOut?'line-through':''].filter(Boolean).join(' ')||'none',color:style.primaryColor});
  }
  const api={markers,enabled,parse,plain,clearStyles,appearance,split,join,retargetItems,display,applyCss};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else global.MSWInlineMarkup=api;
})(typeof window!=='undefined'?window:globalThis);
