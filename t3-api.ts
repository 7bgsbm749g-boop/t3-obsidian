import {connectT3Rpc,type T3Api,type SocketFactory} from './t3-rpc';
import {normalizeV2Snapshot,v2Command} from './orchestration-v2';

/** All wire mutations use v2 RPC (projects have their own HTTP API). The old
 * path is an internal routing key for durable plugin commands, never sent. */
export function t3Api(raw:T3Api,origin:string,makeSocket?:SocketFactory):T3Api {
  const outputs=new Map<string,any>();
  const senderTitles=new Map<string,string|undefined>();let senderRefresh=-Infinity;
  const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  async function senderMessages(snapshot:any){
    const messages=snapshot.projection.messages;
    const ids=[...new Set<string>(messages.filter((m:any)=>m.createdBy==='agent'&&uuid.test(m.senderThreadId??'')).map((m:any)=>m.senderThreadId))].slice(-256);
    const age=Date.now()-senderRefresh;
    if(ids.length&&(age>=30_000||age>=1000&&ids.some(id=>!senderTitles.has(id)))){
      senderRefresh=Date.now();
      try{
        // Shell metadata resolves exact IDs without reading other conversations.
        const shell=await raw('/api/orchestration/shell');
        if(Array.isArray(shell?.threads)){
          const threads=[...shell.threads,...(Array.isArray(shell.archivedThreads)?shell.archivedThreads:[])];
          for(const id of ids){
            const title=threads.find((t:any)=>t.id===id)?.title;
            senderTitles.delete(id);
            senderTitles.set(id,typeof title==='string'&&title.trim()&&title.length<=160?title:undefined);
          }
          while(senderTitles.size>256)senderTitles.delete(senderTitles.keys().next().value!);
        }
      }catch{/* Missing sender metadata must not block reply recovery. */}
    }
    return messages.map((m:any)=>m.createdBy==='agent'&&uuid.test(m.senderThreadId??'')?{...m,senderThreadTitle:senderTitles.get(m.senderThreadId)}:m);
  }
  async function hydrate(snapshot:any){
    if(!snapshot?.projection)return snapshot;
    const messages=await senderMessages(snapshot);
    const items=snapshot.projection.turnItems??[],needed=items.filter((i:any)=>i.outputOmitted===true).slice(-40);
    let rpc:Awaited<ReturnType<typeof connectT3Rpc>>|undefined;
    try{
      for(const item of needed){
        const key=JSON.stringify([snapshot.projection.thread.id,item.id,item.updatedAt]);
        if(outputs.has(key))continue;
        rpc??=await connectT3Rpc(raw,origin,makeSocket);
        const result=await rpc.call('orchestration.getTurnItem',{threadId:snapshot.projection.thread.id,itemId:item.id,revision:item.updatedAt});
        if(result?.item?.id===item.id&&result.item.updatedAt===item.updatedAt)outputs.set(key,result.item);
      }
    }catch{/* A missing tool detail must not block canonical reply recovery. */}
    finally{rpc?.close();}
    while(outputs.size>256)outputs.delete(outputs.keys().next().value!);
    return {...snapshot,projection:{...snapshot.projection,messages,turnItems:items.map((i:any)=>outputs.get(JSON.stringify([snapshot.projection.thread.id,i.id,i.updatedAt]))??i)}};
  }
  return async(path,payload)=>{
    if(path==='/api/orchestration/dispatch'){
      const {__legacyV1,...saved}=payload;
      let command=v2Command(saved);
      if(command.type.startsWith('project.'))return raw('/api/projects/mutate',command);
      // V2 did not copy V1 command receipts. Reconcile migrated messages by
      // their preserved exact IDs before a saved V1 request can dispatch again.
      if(__legacyV1&&(command.type==='thread.create'||command.type==='message.dispatch')){
        let snapshot:any;
        try{snapshot=await raw(`/api/orchestration/threads/${encodeURIComponent(command.threadId)}/bounded`);}
        catch(error:any){if(error?.status!==404)throw error;}
        if(snapshot?.projection){
          const p=snapshot.projection;
          if(command.type==='thread.create'){
            if(p.thread.projectId!==command.projectId)throw Error('The saved thread belongs to another project. Nothing was sent.');
            return {sequence:snapshot.snapshotSequence};
          }
          let message=p.messages.find((m:any)=>m.id===command.messageId);
          let cursor=snapshot.historyCursor,more=snapshot.hasMoreHistory===true,pages=0;
          while(!message&&more){
            if(!cursor||++pages>100)throw Error('Cannot verify the old saved request. Check its T3 history before retrying.');
            const page=await raw(`/api/orchestration/threads/${encodeURIComponent(command.threadId)}/history?cursor=${encodeURIComponent(cursor)}`);
            const row=page.items?.find((r:any)=>r.item?.messageId===command.messageId);
            if(row)message={id:row.item.messageId,text:row.item.text,role:row.item.type==='user_message'?'user':'assistant'};
            cursor=page.nextCursor;more=page.hasMoreHistory===true;
          }
          if(message){
            if(message.role!=='user'||message.text!==command.text)throw Error('The saved message ID belongs to different content. Nothing was sent.');
            return {sequence:snapshot.snapshotSequence};
          }
        }
      }
      const rpc=await connectT3Rpc(raw,origin,makeSocket);
      try{
        if(command.type==='message.dispatch'&&command.attachments.some((a:any)=>typeof a.dataUrl==='string')){
          const uploads=command.attachments.filter((a:any)=>typeof a.dataUrl==='string');
          const result=await rpc.call('assets.persistChatAttachments',{threadId:command.threadId,messageId:command.messageId,attachments:uploads});
          if(!Array.isArray(result?.attachments)||result.attachments.length!==uploads.length)throw Error('T3 did not confirm the image upload. Retry the saved request.');
          const ids=new Map(uploads.map((a:any,i:number)=>[a.id,result.attachments[i].id]));
          let index=0;
          command={...command,attachments:command.attachments.map((a:any)=>typeof a.dataUrl==='string'?result.attachments[index++]:a),
            ...(command.context?{context:{...command.context,records:command.context.records.map((r:any)=>({...r,...(ids.has(r.attachmentId)?{attachmentId:ids.get(r.attachmentId)}:{})}))}}:{})};
        }
        return await rpc.call('orchestration.dispatchCommand',command);
      }finally{rpc.close();}
    }
    // turnLimit/reasoningMessages were v1 query options. V2 full reads are
    // authoritative; bounded/history endpoints use opaque v2 paging cursors.
    if(/^\/api\/orchestration\/threads\/[^/?]+(?:\?|$)/.test(path)){
      const root=path.split('?')[0],importOnly=new URLSearchParams(path.split('?')[1]).get('importRuns')==='true',snapshot=await raw(root+'/bounded'+(importOnly?'?compactTurnItems=1':''),payload);
      if(!snapshot?.projection||path.includes('turnLimit='))return normalizeV2Snapshot(importOnly?snapshot:await hydrate(snapshot));
      // Full recovery follows opaque cursors rather than asking for one
      // unbounded HTTP body. Keep the initial control-plane watermark so live
      // events committed during pagination still replay after this snapshot.
      const conversation=(item:any)=>['user_message','assistant_message'].includes(item.type);
      const rows=[...(snapshot.projection.visibleTurnItems??[])].filter(row=>!importOnly||conversation(row.item));
      let cursor=snapshot.historyCursor,more=snapshot.hasMoreHistory===true,pages=0;
      while(more){
        if(!cursor||++pages>100)throw Error('T3 history exceeded its recovery page limit.');
        const page=await raw(root+'/history?cursor='+encodeURIComponent(cursor)+(importOnly?'&view=conversation':''));
        if(!Array.isArray(page.items))throw Error('T3 returned an invalid history page.');
        rows.unshift(...page.items.filter((row:any)=>!importOnly||conversation(row.item)));cursor=page.nextCursor;more=page.hasMoreHistory===true;
      }
      const p=snapshot.projection,items=new Map<string,any>(),messages=new Map<string,any>();
      for(const row of rows)if(row.sourceThreadId===p.thread.id)items.set(row.item.id,row.item);
      for(const item of p.turnItems??[])if(!importOnly||conversation(item))items.set(item.id,item);
      for(const item of items.values())if(item.type==='user_message'||item.type==='assistant_message')messages.set(item.messageId,{id:item.messageId,threadId:p.thread.id,runId:item.runId,nodeId:item.nodeId,role:item.type==='user_message'?'user':'assistant',text:item.text,streaming:item.streaming===true,createdAt:item.startedAt??item.updatedAt,context:item.context,attachments:item.attachments??[],createdBy:item.createdBy,senderThreadId:item.senderThreadId});
      for(const message of p.messages)messages.set(message.id,message);
      const recovered={...snapshot,hasMoreHistory:false,projection:{...p,turnItems:[...items.values()].sort((a,b)=>a.ordinal-b.ordinal),messages:[...messages.values()].sort((a,b)=>(a.createdAt??'').localeCompare(b.createdAt??''))}};
      return normalizeV2Snapshot(importOnly?recovered:await hydrate(recovered));
    }
    return normalizeV2Snapshot(await raw(path,payload));
  };
}
