// A native, continuously selectable document with protected metadata ranges.
// Cue identities stay outside the text; typing never parses quotes or delimiters.
(function(global){
  'use strict';
  const core=global.MSWFindTextTools;
  const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  function create({onChange,onNotice,onLocate}){
    const element=document.createElement('div');element.className='find-script-editor';
    const input=document.createElement('textarea');input.spellcheck=false;input.wrap='soft';
    const mirror=document.createElement('div');mirror.className='find-script-mirror';mirror.setAttribute('aria-hidden','true');
    const ink=document.createElement('pre');ink.className='find-script-ink';mirror.append(ink);element.append(input,mirror);
    let rows=[],fields={},values=new Map(),doc={text:'',ranges:[]},composing=false,compositionStart=0,before=null,undo=[],redo=[],painted=[];
    const text=row=>values.get(row.key)??row.text;
    const bookmark=()=>[input.selectionStart,input.selectionEnd].map(offset=>{
      const range=doc.ranges.find(r=>offset>=r.from&&offset<=r.end)||doc.ranges.at(-1);
      return range?{key:range.key,offset:Math.max(0,Math.min(offset-range.start,range.text.length))}:null;
    });
    function select(marks){
      if(!marks?.[0])return;
      const offsets=marks.map(mark=>{const r=doc.ranges.find(r=>r.key===mark?.key);return r?r.start+Math.min(mark.offset,r.text.length):0;});
      input.setSelectionRange(...offsets);
    }
    function scroll(){ink.style.width=input.clientWidth+'px';ink.style.transform=`translateY(${-input.scrollTop}px)`;}
    function paint(){
      if(painted.length!==doc.ranges.length){
        const fragment=document.createDocumentFragment();painted=doc.ranges.map(()=>{
          const meta=document.createElement('span');meta.className='find-script-info';const body=document.createTextNode('');fragment.append(meta,body);return {meta,body};
        });ink.replaceChildren(fragment);
      }
      doc.ranges.forEach((range,i)=>{
        if(painted[i].meta.textContent!==range.prefix)painted[i].meta.textContent=range.prefix;
        if(painted[i].body.data!==range.text)painted[i].body.data=range.text;
      });scroll();
    }
    function project(marks){
      const top=input.scrollTop;doc=core.scriptDocument(rows,text,fields);
      if(input.value!==doc.text)input.value=doc.text;
      if(marks)select(marks);input.scrollTop=top;paint();
    }
    function reject(message=core.scriptProtected){
      const selection=before?.selection,top=input.scrollTop;input.value=doc.text;
      if(selection)input.setSelectionRange(...selection);input.scrollTop=top;onNotice(message);before=null;
    }
    function write(patches,{record=true,marks=null,previous=null}={}){
      const edits=patches.filter(p=>values.has(p.key)&&values.get(p.key)!==p.text).map(p=>({...p,before:values.get(p.key)}));
      if(!edits.length)return;
      const saved=previous||bookmark();for(const p of edits)values.set(p.key,p.text);
      project(marks);
      if(record){undo.push({edits,before:saved,after:bookmark()});if(undo.length>100)undo.shift();redo=[];}
      onChange(edits.map(({key,text})=>({key,text})),composing);
    }
    function history(reverse){
      if(input.readOnly)return;
      const source=reverse?undo:redo,target=reverse?redo:undo,change=source.pop();if(!change)return;
      write(change.edits.map(p=>({key:p.key,text:reverse?p.before:p.text})),{record:false,marks:reverse?change.before:change.after});target.push(change);
    }
    function replaceSelection(value,previous=bookmark()){
      if(input.readOnly)return;
      const start=input.selectionStart,end=input.selectionEnd,range=core.scriptRange(doc,start,end);
      if(!range){onNotice(core.scriptProtected);return;}
      const offset=start-range.start;
      write([{key:range.key,text:range.text.slice(0,offset)+value+range.text.slice(end-range.start)}],
        {previous,marks:[{key:range.key,offset:offset+value.length},{key:range.key,offset:offset+value.length}]});
      // Programmatic value updates avoid Chromium's costly native replacement
      // near the end of long textareas; reveal the caret using the aligned mirror.
      const index=doc.ranges.findIndex(r=>r.key===range.key),caret=document.createRange();
      caret.setStart(painted[index].body,Math.min(offset+value.length,painted[index].body.length));caret.collapse(true);
      const rect=caret.getBoundingClientRect(),box=input.getBoundingClientRect();
      if(rect.height&&rect.bottom>box.bottom-8)input.scrollTop+=rect.bottom-box.bottom+8;
      else if(rect.height&&rect.top<box.top+8)input.scrollTop-=box.top+8-rect.top;
      scroll();
    }
    input.addEventListener('beforeinput',event=>{
      before={selection:[input.selectionStart,input.selectionEnd],marks:bookmark()};
      if(event.inputType==='historyUndo'||event.inputType==='historyRedo'){event.preventDefault();history(event.inputType==='historyUndo');return;}
      const range=core.scriptRange(doc,input.selectionStart,input.selectionEnd),collapsed=input.selectionStart===input.selectionEnd;
      const boundary=range&&collapsed&&(event.inputType?.endsWith('Backward')&&input.selectionStart===range.start||event.inputType?.endsWith('Forward')&&input.selectionEnd===range.end);
      if(input.readOnly||!range||boundary||event.inputType==='insertFromDrop'){
        if(event.cancelable)event.preventDefault();before.blocked=true;onNotice(core.scriptProtected);
        return;
      }
      const lineBreak=event.inputType==='insertLineBreak'||event.inputType==='insertParagraph';
      if(event.cancelable&&!event.isComposing&&(lineBreak||event.inputType==='insertText'&&event.data!==null)){
        event.preventDefault();replaceSelection(event.inputType==='insertText'?event.data:'\n');before=null;
      }else if(event.cancelable&&!event.isComposing&&['deleteContentBackward','deleteContentForward'].includes(event.inputType)){
        event.preventDefault();
        if(collapsed){
          const offset=input.selectionStart-range.start,segments=[...graphemes.segment(range.text)],backward=event.inputType==='deleteContentBackward';
          const segment=backward?segments.findLast(s=>s.index<offset):segments.find(s=>s.index+s.segment.length>offset);
          if(segment)input.setSelectionRange(backward?range.start+segment.index:input.selectionStart,backward?input.selectionEnd:range.start+segment.index+segment.segment.length);
        }
        replaceSelection('',before.marks);before=null;
      }
    });
    input.addEventListener('input',event=>{
      event.stopPropagation();
      if(input.readOnly||before?.blocked){reject();return;}
      try{
        const change=core.scriptEdit(doc,input.value,before?.selection);
        if(change)write([change],{previous:before?.marks});
      }catch(error){reject(error.message);}
      before=null;
    });
    input.addEventListener('compositionstart',()=>{composing=true;compositionStart=undo.length;});
    input.addEventListener('compositionend',()=>{
      composing=false;
      const steps=undo.splice(compositionStart),edits=new Map();
      for(const step of steps)for(const edit of step.edits){const first=edits.get(edit.key);edits.set(edit.key,{...edit,before:first?first.before:edit.before});}
      if(steps.length)undo.push({edits:[...edits.values()],before:steps[0].before,after:steps.at(-1).after});
      onChange([],false);
    });
    input.addEventListener('paste',event=>{
      event.preventDefault();if(input.readOnly)return;
      const value=event.clipboardData.getData('text/plain').replace(/\r\n?/g,'\n');
      const whole=input.selectionStart===0&&input.selectionEnd===input.value.length;
      const complete=whole&&/^\[\[[^\n]*\]\]\n⟦[^\n]*⟧\n/.test(value);
      if(core.scriptRange(doc,input.selectionStart,input.selectionEnd)&&!complete){replaceSelection(value);return;}
      if(input.selectionStart!==0||input.selectionEnd!==input.value.length){onNotice(core.scriptProtected);return;}
      try{
        const texts=core.unpackScript(rows,value);
        write(rows.map((row,i)=>({key:row.key,text:texts[i]})));
      }catch(error){onNotice(error.message);}
    });
    input.addEventListener('cut',event=>{
      event.preventDefault();event.clipboardData.setData('text/plain',input.value.slice(input.selectionStart,input.selectionEnd));
      if(!input.readOnly)replaceSelection('');
    });
    input.addEventListener('drop',event=>{event.preventDefault();onNotice(core.scriptProtected);});
    input.addEventListener('keydown',event=>{
      if(event.isComposing)return;
      const command=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
      if(command&&!event.altKey&&(key==='z'||key==='y')){event.preventDefault();event.stopPropagation();history(key==='z'&&!event.shiftKey);return;}
      if(command||event.altKey||event.shiftKey&&event.key!=='Tab')return;
      const range=core.scriptRange(doc,input.selectionStart,input.selectionEnd),collapsed=input.selectionStart===input.selectionEnd;
      let next;
      if(event.key==='Tab'){
        const index=doc.ranges.findIndex(r=>input.selectionStart>=r.from&&input.selectionStart<=r.end);
        next=doc.ranges[index+(event.shiftKey?-1:1)];
      }else if(collapsed&&range&&event.key==='ArrowRight'&&input.selectionStart===range.end)next=doc.ranges[doc.ranges.indexOf(range)+1];
      else if(collapsed&&range&&event.key==='ArrowLeft'&&input.selectionStart===range.start)next=doc.ranges[doc.ranges.indexOf(range)-1];
      if(next){event.preventDefault();const offset=event.key==='ArrowLeft'?next.end:next.start;input.setSelectionRange(offset,offset);}
    });
    input.addEventListener('dblclick',()=>{const range=doc.ranges.find(r=>input.selectionStart>=r.from&&input.selectionStart<=r.end);if(range)onLocate(range.key);});
    input.addEventListener('scroll',scroll);
    const resize=new ResizeObserver(scroll);resize.observe(input);
    return {element,input,
      refresh(nextRows,readText,nextFields,readOnly){
        if(composing)return;
        const marks=bookmark(),nextValues=new Map(nextRows.map(row=>[row.key,readText(row)]));
        const changed=nextRows.length!==rows.length||nextRows.some(row=>values.get(row.key)!==nextValues.get(row.key));
        if(changed){undo=[];redo=[];}
        rows=nextRows;values=nextValues;fields=nextFields;input.readOnly=readOnly;project(marks);
      },
      copy(full=false){return full?core.packScript(rows,text):doc.text;},
      destroy(){resize.disconnect();}
    };
  }
  global.MSWFindScriptEditor={create};
})(window);
