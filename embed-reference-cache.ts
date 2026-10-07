import {replyReferences,type ReplyReference} from './reply-assets';

/** Cache syntax only. Resolve paths and renew signed resources on every use. */
export class EmbedReferenceCache {
  private entries=new Map<string,{text:string;references:ReplyReference[];size:number}>();
  private characters=0;
  constructor(private parse=replyReferences,private maximumCharacters=1_000_000,private maximumEntries=16){}
  get(source:string,text:string):readonly ReplyReference[]{
    const previous=this.entries.get(source);
    if(previous?.text===text){this.entries.delete(source);this.entries.set(source,previous);return previous.references;}
    if(previous){this.characters-=previous.size;this.entries.delete(source);}
    const references=text.includes('![')?this.parse(text).filter(reference=>reference.image):[];
    const size=text.length+references.reduce((sum,reference)=>sum+reference.source.length+reference.original.length+reference.label.length,0);
    if(size<=this.maximumCharacters){
      this.entries.set(source,{text,references,size});this.characters+=size;
      while(this.characters>this.maximumCharacters||this.entries.size>this.maximumEntries){const key=this.entries.keys().next().value!;this.characters-=this.entries.get(key)!.size;this.entries.delete(key);}
    }
    return references;
  }
  clear(){this.entries.clear();this.characters=0;}
}
