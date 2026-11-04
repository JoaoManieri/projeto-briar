export type HistoryFile = {path:string; additions:number; deletions:number};
export type Commit = {sha:string; parents:string[]; message:string; author:string; date:string; files?:HistoryFile[]};
export type Branch = {name:string; sha:string};
export type History = {repository:string; defaultBranch:string; branches:Branch[]; tags:Branch[]; commits:Commit[]};
export const palette = ["#65d8bc","#ab9bf2","#e3a585","#dfc872","#85b5ef","#e795bd","#a6c878"];
export function orderCommits(commits:Commit[]) {
  const byId=new Map(commits.map(c=>[c.sha,c]));
  const counts=new Map(commits.map(c=>[c.sha,0]));
  for(const c of commits) for(const p of c.parents) if(byId.has(p)) counts.set(p,counts.get(p)!+1);
  const queue=commits.filter(c=>counts.get(c.sha)===0);
  const result:Commit[]=[];
  while(queue.length){
    queue.sort((a,b)=>Date.parse(b.date)-Date.parse(a.date)||a.sha.localeCompare(b.sha));
    const c=queue.shift()!; result.push(c);
    for(const p of c.parents) if(byId.has(p)){counts.set(p,counts.get(p)!-1); if(counts.get(p)===0)queue.push(byId.get(p)!);}
  }
  if(result.length!==commits.length)throw new Error("O histórico contém um ciclo entre commits.");
  return result;
}
export function ancestors(sha:string,commits:Commit[]) {
  const byId=new Map(commits.map(c=>[c.sha,c])); const ids=new Set<string>(); const stack=[sha];
  while(stack.length){const id=stack.pop()!;if(ids.has(id))continue;ids.add(id);for(const p of byId.get(id)?.parents||[])stack.push(p);}
  return ids;
}
export type GraphEdge = {fromRow:number; fromCol:number; toRow:number; toCol:number; via:number; dangling:boolean; dashed:boolean};
export type GraphLayout = {rows:Commit[]; cols:Map<string,number>; rowOf:Map<string,number>; edges:GraphEdge[]; width:number};

/**
 * Lane layout in the style of GitKraken: lanes are reused once a branch line ends.
 * `seed` reserves column 0 for the given commit (HEAD or WIP) so the current branch stays leftmost.
 */
export function layoutGraph(commits:Commit[], seed?:string|null):GraphLayout {
  const rows=orderCommits(commits);
  const known=new Set(rows.map(c=>c.sha));
  const lanes:(string|null)[]=[];
  if(seed&&known.has(seed))lanes[0]=seed;
  const cols=new Map<string,number>(), rowOf=new Map<string,number>();
  const pending:{fromRow:number;fromCol:number;via:number;parent:string|null;dashed:boolean}[]=[];
  let width=1;
  const free=(skip=-1)=>{let i=lanes.findIndex((v,k)=>v===null&&k!==skip);if(i<0){i=lanes.length;lanes.push(null);}return i;};
  rows.forEach((c,row)=>{
    let col=lanes.indexOf(c.sha);
    if(col<0)col=free();
    for(let j=0;j<lanes.length;j++)if(lanes[j]===c.sha)lanes[j]=null;
    cols.set(c.sha,col);rowOf.set(c.sha,row);
    const dashed=c.sha==='WIP';
    c.parents.forEach((p,k)=>{
      if(!known.has(p)){pending.push({fromRow:row,fromCol:col,via:col,parent:null,dashed:true});return;}
      let via:number;
      if(k===0){via=col;lanes[col]=p;}
      else{const existing=lanes.indexOf(p);if(existing>=0)via=existing;else{via=free(col);lanes[via]=p;}}
      pending.push({fromRow:row,fromCol:col,via,parent:p,dashed});
    });
    while(lanes.length&&lanes[lanes.length-1]===null)lanes.pop();
    width=Math.max(width,col+1,lanes.length);
  });
  const edges=pending.map(e=>e.parent===null
    ?{fromRow:e.fromRow,fromCol:e.fromCol,toRow:e.fromRow+1,toCol:e.fromCol,via:e.via,dangling:true,dashed:true}
    :{fromRow:e.fromRow,fromCol:e.fromCol,toRow:rowOf.get(e.parent)!,toCol:cols.get(e.parent)!,via:e.via,dangling:false,dashed:e.dashed});
  return {rows,cols,rowOf,edges,width};
}
