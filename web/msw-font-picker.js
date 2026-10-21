// One editable combobox per script; the authenticated local service owns enumeration.
(function(global) {
  'use strict';
  function create(inputs, load) {
    const menu=document.createElement('div');menu.id='style-local-fonts';menu.className='msw-font-menu';menu.hidden=true;
    const list=document.createElement('div');list.setAttribute('role','listbox');list.id='style-font-options';menu.append(list);document.body.append(menu);
    let families=[],loaded=false,error='',active=null,query='',index=-1,options=[];
    const states=new Map(inputs.map(input=>[input,{value:'',mixed:false}]));
    const script=input=>input.dataset.fontScript||'han';
    const entry=value=>families.find(f=>f.family.toLocaleLowerCase()===value.toLocaleLowerCase())||families.find(f=>f.aliases.some(a=>a.toLocaleLowerCase()===value.toLocaleLowerCase()));
    const label=(font,input)=>script(input)==='latin'?font.family:font.label;
    const canonical=input=>entry(input.value.trim())?.family||input.value.trim();
    const close=()=>{if(active){active.setAttribute('aria-expanded','false');active.removeAttribute('aria-activedescendant');}menu.hidden=true;active=null;};
    function sync(input,value,mixed=false) {
      states.set(input,{value:String(value??''),mixed});
      input.value=mixed?'':label(entry(String(value??''))||{family:value||'',label:value||''},input);
      input.placeholder=mixed?'多个值':script(input)==='han'?'输入或选择字体':'沿用汉字字体';
    }
    function position() {
      if(!active)return;
      const r=active.getBoundingClientRect();menu.style.width=Math.min(Math.max(220,r.width),innerWidth-16)+'px';
      menu.style.left=Math.max(8,Math.min(r.left,innerWidth-menu.offsetWidth-8))+'px';
      menu.style.top=Math.max(8,Math.min(r.bottom+4,innerHeight-menu.offsetHeight-8))+'px';
    }
    function highlight() {
      [...list.children].forEach((b,i)=>b.classList.toggle('is-current',i===index));
      if(index>=0){active.setAttribute('aria-activedescendant',list.children[index].id);list.children[index].scrollIntoView({block:'nearest'});}
      else active?.removeAttribute('aria-activedescendant');
    }
    function choose(font) {
      const input=active;if(!input)return;
      input.value=font.family;close();input.dispatchEvent(new Event('change',{bubbles:true}));
    }
    function draw() {
      if(!active)return;
      const q=query.toLocaleLowerCase();
      options=families.filter(f=>(f.scripts?.includes(script(active))||(script(active)==='han'?f.cjk:script(active)==='latin'?f.latin:false))&&[f.family,f.label,...f.aliases].some(n=>n.toLocaleLowerCase().includes(q)))
        .sort((a,b)=>label(a,active).localeCompare(label(b,active),'zh-CN'));
      index=-1;list.replaceChildren(...options.map((f,i)=>{
        const b=document.createElement('button');b.type='button';b.id='style-font-option-'+i;b.setAttribute('role','option');
        b.textContent=label(f,active);b.title=f.family;b.style.fontFamily=JSON.stringify(f.family)+', sans-serif';
        b.setAttribute('aria-selected',String(f.family===canonical(active)));
        b.onpointerdown=e=>e.preventDefault();b.onclick=()=>choose(f);return b;
      }));
      if(!options.length){const note=document.createElement('span');note.className='msw-font-note';note.textContent=!loaded?'正在读取字体…':error||'没有匹配的字体，可直接输入名称';list.append(note);}
      position();
    }
    function open(input) {if(input.disabled)return;if(active&&active!==input)close();active=input;query='';menu.hidden=false;input.setAttribute('aria-expanded','true');draw();}
    for(const input of inputs) {
      input.setAttribute('role','combobox');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');
      input.autocomplete='off';input.spellcheck=false;input.classList.add('msw-font-input');input.maxLength=128;
      input.addEventListener('focus',()=>open(input));
      input.addEventListener('click',()=>{if(active!==input)open(input);});
      input.addEventListener('input',()=>{if(active!==input)open(input);query=input.value.trim();draw();});
      input.addEventListener('change',()=>{input.value=canonical(input);close();},true);
      input.addEventListener('blur',()=>{close();const s=states.get(input);sync(input,s.value,s.mixed);});
      input.addEventListener('keydown',e=>{
        if(e.isComposing||e.keyCode===229)return;
        if(['ArrowDown','ArrowUp','Enter','Escape'].includes(e.key))e.stopPropagation();
        if(e.key==='Escape'){e.preventDefault();const s=states.get(input);sync(input,s.value,s.mixed);close();}
        else if(e.key==='ArrowDown'||e.key==='ArrowUp'){
          e.preventDefault();if(active!==input)open(input);if(options.length){index=(index+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;highlight();}
        }else if(e.key==='Enter'){
          e.preventDefault();if(active===input&&index>=0)choose(options[index]);else {input.dispatchEvent(new Event('change',{bubbles:true}));close();}
        }
      });
    }
    document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target)&&!inputs.includes(e.target))close();},true);
    global.addEventListener('resize',close);
    document.addEventListener('scroll',e=>{
      if(!active||menu.contains(e.target))return;
      const r=active.getBoundingClientRect();
      if(!r.width||!r.height||r.bottom<=0||r.top>=innerHeight)close();else position();
    },true);
    Promise.resolve().then(load).then(data=>{if(!Array.isArray(data?.families))throw Error('字体列表不可用');families=data.families;loaded=true;for(const [input,s] of states)if(document.activeElement!==input)sync(input,s.value,s.mixed);draw();})
      .catch(()=>{loaded=true;error='暂无法读取本机字体，可直接输入名称';draw();});
    return {sync,canonical,close};
  }
  global.MSWFontPicker={create};
})(window);
