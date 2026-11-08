// Keep lightweight, addressable rows for navigation/filtering; materialize only
// the viewport and its buffer. Builders always read the current row descriptor.
(function(global){
  class CueListView {
    constructor(root){
      this.root=root;this.rows=new Map();this.byId=new Map();this.mounted=new Set();this.frame=0;
      this.evict=()=>{if(this.frame)return;this.frame=requestAnimationFrame(()=>{
        this.frame=0;const protectedNodes=this.protectedNodes(),bounds=root.getBoundingClientRect();
        const outside=[...this.mounted].map(row=>({row,rect:row.node.getBoundingClientRect()}))
          .filter(({rect})=>rect.bottom<bounds.top-600||rect.top>bounds.bottom+600);
        for(const {row,rect} of outside)this.unmount(row,rect.height,protectedNodes);
      });};
      root.addEventListener('scroll',this.evict,{passive:true});root.addEventListener('focusout',this.evict);
      this.observer=new IntersectionObserver(entries=>{
        const protectedNodes=this.protectedNodes();
        for(const entry of entries){const row=entry.target._cueViewRow;if(!row||row.node!==entry.target)continue;
          if(entry.isIntersecting)this.mount(row);else this.unmount(row,entry.boundingClientRect.height,protectedNodes);}
      },{root,rootMargin:'600px 0px'});
    }
    protectedNodes(){
      // Selection access may flush layout too: take one snapshot before the
      // batch writes, rather than asking the browser again for each card.
      const selection=global.getSelection();
      return [document.activeElement,...(selection&&!selection.isCollapsed?[selection.anchorNode,selection.focusNode]:[])];
    }
    shell(row){
      const node=document.createElement('div');node.className='cue cue-virtual';
      node.style.height=(row.height||86)+'px';row.describe(node);return node;
    }
    replace(row,node){
      const old=row.node;
      if(old){this.observer.unobserve(old);old.replaceWith(node);}
      row.node=node;node._cueViewRow=row;this.observer.observe(node);
      row.onReplace?.(old,node);
    }
    mount(row){
      if(row.mounted||!row.node.isConnected||row.node.classList.contains('hidden'))return row.node;
      const old=row.node,node=row.build();
      for(const name of ['hidden','selected','selected-extension','current-target','playhead-hit','temporary-visible','track-filter-single','fixed-locked','fixed-disabled'])
        node.classList.toggle(name,old.classList.contains(name));
      for(const name of ['subtitleTrackId','subtitleTrackIds'])if(old.dataset[name])node.dataset[name]=old.dataset[name];
      for(const role of ['main','extension'])node.querySelector('.multi-cue-column.'+role)?.classList.toggle('track-filtered-out',old.querySelector('.multi-cue-column.'+role)?.classList.contains('track-filtered-out')===true);
      row.mounted=true;this.mounted.add(row);this.replace(row,node);row.sync(node);return node;
    }
    unmount(row,measuredHeight,protectedNodes=this.protectedNodes()){
      const node=row.node;
      if(!row.mounted||protectedNodes.some(target=>target&&node.contains(target))||node.matches('.editing')||node.querySelector('.editing'))return;
      // Read all row geometry before replacing any nodes; alternating reads and
      // writes makes every offscreen eviction force another layout.
      const height=measuredHeight??node.getBoundingClientRect().height;if(height>0)row.height=height;
      const shell=this.shell(row);
      for(const name of ['subtitleTrackId','subtitleTrackIds'])if(node.dataset[name])shell.dataset[name]=node.dataset[name];
      for(const name of ['hidden','selected','selected-extension','current-target','playhead-hit','temporary-visible','track-filter-single','fixed-locked','fixed-disabled'])shell.classList.toggle(name,node.classList.contains(name));
      for(const role of ['main','extension'])for(const name of ['selected','related-selected','track-filtered-out','temporary-visible'])
        shell.querySelector('.'+role)?.classList.toggle(name,node.querySelector('.multi-cue-column.'+role)?.classList.contains(name)===true);
      row.mounted=false;this.mounted.delete(row);this.replace(row,shell);
    }
    update(descriptors,changed){
      const next=new Map();
      for(const descriptor of descriptors){
        let row=this.rows.get(descriptor.key);
        const refresh=row&&row.mounted&&(!changed||row.stamp!==descriptor.stamp||descriptor.ids.some(id=>changed.has(id)));
        if(!row){row={height:86,mounted:false};Object.assign(row,descriptor);row.node=this.shell(row);row.node._cueViewRow=row;}
        else Object.assign(row,descriptor);
        if(refresh){row.mounted=false;this.mounted.delete(row);this.replace(row,this.shell(row));}
        row.describe(row.node);if(row.mounted)row.sync(row.node);
        next.set(row.key,row);
      }
      for(const [key,row] of this.rows)if(!next.has(key)){this.observer.unobserve(row.node);this.mounted.delete(row);row.node.remove();}
      this.rows=next;
      this.byId=new Map([...next.values()].flatMap(row=>row.ids.map(id=>[id,row])));
      let cursor=this.root.querySelector(':scope > .cue');
      for(const row of next.values()){
        if(row.node===cursor)cursor=cursor.nextElementSibling;else this.root.insertBefore(row.node,cursor);
        this.observer.observe(row.node);
      }
    }
    ensure(node){const row=node?.closest('.cue')?._cueViewRow;return row?this.mount(row):node;}
    visibleRows(){return [...this.mounted].map(row=>row.node);}
    dispose(){cancelAnimationFrame(this.frame);this.root.removeEventListener('scroll',this.evict);this.root.removeEventListener('focusout',this.evict);this.observer.disconnect();for(const row of this.rows.values())row.node.remove();this.rows.clear();this.byId.clear();this.mounted.clear();}
  }
  global.MSWCueListView=CueListView;
})(window);
