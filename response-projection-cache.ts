import {projectResponses,type LocalResponse,type ResponseProjection} from './native-response-projection';

/** Reuse a validated local projection only for identical fresh saved bytes
 * and identical ordered response identities/bodies. Never cache syntax trees
 * or use this cache to validate changed ordinary text. */
export class ResponseProjectionCache {
  private entries=new Map<string,{responses:LocalResponse[];projection:ResponseProjection;characters:number}>();
  private characters=0;
  private hits=0;
  private projections=0;
  constructor(private maxCharacters=4_000_000,private maxEntries=16){}
  private copy(projection:ResponseProjection):ResponseProjection{return {...projection,ranges:projection.ranges.map(range=>({...range}))};}
  project(path:string,saved:string,responses:readonly LocalResponse[]):ResponseProjection {
    const old=this.entries.get(path);
    if(old&&old.projection.saved===saved&&old.responses.length===responses.length&&responses.every((response,index)=>response.id===old.responses[index].id&&response.body===old.responses[index].body)){
      this.entries.delete(path);this.entries.set(path,old);this.hits++;return this.copy(old.projection);
    }
    this.projections++;
    const projection=projectResponses(saved,responses);
    if(old){this.characters-=old.characters;this.entries.delete(path);}
    const characters=saved.length+projection.display.length+responses.reduce((sum,response)=>sum+response.body.length,0);
    if(characters<=this.maxCharacters&&this.maxEntries>0){
      this.entries.set(path,{responses:responses.map(response=>({...response})),projection:this.copy(projection),characters});this.characters+=characters;
      while(this.characters>this.maxCharacters||this.entries.size>this.maxEntries){const first=this.entries.keys().next().value!;this.characters-=this.entries.get(first)!.characters;this.entries.delete(first);}
    }
    return projection;
  }
  status(){return {entries:this.entries.size,characters:this.characters,maxCharacters:this.maxCharacters,maxEntries:this.maxEntries,hits:this.hits,projections:this.projections};}
  clear(){this.entries.clear();this.characters=0;}
}
