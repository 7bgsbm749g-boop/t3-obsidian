import {Language,defineLanguageFacet,languageDataProp} from '@codemirror/language';
import {Parser,Tree,NodeType,type Input,type TreeFragment,type PartialParse} from '@lezer/common';
/** Suppress Obsidian's default Markdown grammar without scanning large text. */
const data=defineLanguageFacet();
const top=NodeType.define({id:0,name:'PlainText',top:true,props:[[languageDataProp,data]]});
class PlainParser extends Parser {
  createParse(input:Input,_fragments:readonly TreeFragment[],ranges:readonly {from:number;to:number}[]):PartialParse {
    let stoppedAt:number|null=null,parsedPos=0;
    const end=ranges[ranges.length-1]?.to??input.length;
    return {get parsedPos(){return parsedPos;},get stoppedAt(){return stoppedAt;},stopAt(position){stoppedAt=position;},advance(){parsedPos=stoppedAt??end;return new Tree(top,[],[],parsedPos);}};
  }
}
export const codePlaintext=new Language(data,new PlainParser(),[],'plaintext');
