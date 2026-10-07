import {replyReferences,type ReplyReference} from './reply-assets';

/** Cache syntax only. Resolve paths and renew signed resources on every use. */
export class EmbedReferenceCache {
  private entries=new Map<string,{text:string;references:ReplyReference[];size:number}>();
  private characters=0;
  private hits=0;private sourceParses=0;private plainReads=0;
  constructor(private parse=replyReferences,private maximumCharacters=1_000_000,private maximumEntries=16){}
  status(){return {entries:this.entries.size,characters:this.characters,maxCharacters:this.maximumCharacters,maxEntries:this.maximumEntries,hits:this.hits,sourceParses:this.sourceParses,plainReads:this.plainReads};}
  get(source:string,text:string):readonly ReplyReference[]{
    const previous=this.entries.get(source);
    if(previous?.text===text){this.entries.delete(source);this.entries.set(source,previous);this.hits++;return previous.references;}
    if(previous){this.characters-=previous.size;this.entries.delete(source);}
    // Ordinary notes already have a cheap syntax-free result. Retaining
    // their whole text evicts the image candidates that need Markdown parsing.
    if(!text.includes('![')){this.plainReads++;return [];}
    this.sourceParses++;
    const references=this.parse(text).filter(reference=>reference.image);
    const size=text.length+references.reduce((sum,reference)=>sum+reference.source.length+reference.original.length+reference.label.length,0);
    if(size<=this.maximumCharacters){
      this.entries.set(source,{text,references,size});this.characters+=size;
      while(this.characters>this.maximumCharacters||this.entries.size>this.maximumEntries){const key=this.entries.keys().next().value!;this.characters-=this.entries.get(key)!.size;this.entries.delete(key);}
    }
    return references;
  }
  clear(){this.entries.clear();this.characters=0;}
}
