// Chamada ao servidor Git local (server/index.mjs). Sem corpo vira GET; com corpo, POST JSON.
// repo: raiz da aba que faz o pedido (cabeçalho X-Briar-Repo); sem ele, vale a aba ativa.
export async function api(route:string,body?:unknown,signal?:AbortSignal,repo?:string){
  const r=await fetch('/api/'+route,{method:body===undefined?'GET':'POST',headers:{'X-Pindorama-Client':'local',...(repo?{'X-Briar-Repo':encodeURIComponent(repo)}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});
  const data=await r.json();
  if(!r.ok)throw new Error(data.error||'O servidor Git não respondeu.');
  return data;
}
