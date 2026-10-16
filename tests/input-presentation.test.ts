import {test} from 'node:test';
import assert from 'node:assert/strict';
import {visibleInlineInput,INLINE_REPLY_INSTRUCTION,THREAD_REPLY_INSTRUCTION} from '../input-presentation';
import {renderInlineTurn,type InlineThreadState} from '../inline-thread';
import {observeIncoming} from '../inline-steering';
import {obsidianFooter} from '../obsidian-prompt';

const footer='\n\nSent from Obsidian.\nObsidian vault: "QLO2"\nDestination note path: "/vault/Jobs/Note.md"';

test('generated footer and its reply instruction are hidden without changing user Markdown',()=>{
  const prompt='Use **this** image: [[Screenshot.png]]\n\nKeep the paragraph.';
  for(const instruction of ['',INLINE_REPLY_INSTRUCTION,THREAD_REPLY_INSTRUCTION]){
    const raw=prompt+(instruction?'\n\n'+instruction:'')+footer;
    assert.equal(visibleInlineInput(raw),prompt);
    assert.equal(visibleInlineInput(raw+'\n'),prompt);
    if(instruction)for(const ending of ['\n','\n\n','\n\n\n'])assert.equal(visibleInlineInput(prompt+'\n\n'+instruction+ending+footer),prompt);
  }
  const escaped='\n\nSent from Obsidian.\nObsidian vault: "Quoted \\"vault\\""\nDestination note path: "C:\\\\Vault\\\\Note.md"';
  assert.equal(visibleInlineInput(prompt+escaped),prompt);
});

test('ordinary instructions, malformed metadata, examples and nonterminal footers remain visible',()=>{
  for(const text of [
    INLINE_REPLY_INSTRUCTION,'Explain this:\n\n'+INLINE_REPLY_INSTRUCTION,
    'Example'+footer+'\n\nExplain these lines.',
    'Example'+footer.replace('"QLO2"','QLO2'),
    'Example'+footer.replace('"QLO2"','"bad\\q"'),
    'Example:\n\n```text\n'+footer.trimStart(),
    'Example:\n\n```text\n'+footer.trimStart()+'\n```',
    'Example:\n\n'+footer.trimStart().split('\n').map(line=>'> '+line).join('\n'),
    footer.trimStart(),
  ])assert.equal(visibleInlineInput(text),text);
});

for(const mode of ['remove','keep','collapse'] as const)test(`${mode} cleans canonical and recovered inputs while preserving identities, sender labels and exact raw records`,()=>{
  const user={id:'input',role:'user',turnId:'turn',text:'Please adjust.\n\n'+INLINE_REPLY_INSTRUCTION+footer,streaming:false};
  const state:InlineThreadState={title:'Example',messages:[
    {id:'before',role:'assistant',turnId:'turn',text:'Before input.',streaming:false},user,
    {id:'final',role:'assistant',turnId:'turn',text:'Final answer.',streaming:false},
  ],activities:[],latestTurn:{turnId:'turn',state:'completed',assistantMessageId:'final'}};
  const before=JSON.stringify(state);
  const inputs=observeIncoming(state,['turn']);
  const saved=JSON.stringify(inputs);
  for(const incoming of [inputs,JSON.parse(saved)]){
    const text=renderInlineTurn(state,'turn','thread','complete',mode,undefined,{messages:state.messages.filter(m=>m.role==='assistant'),steering:incoming});
    assert.match(text,/Please adjust\./);assert.match(text,/\[!t3-steering\] User/);
    assert.doesNotMatch(text,/Sent from Obsidian|Obsidian vault|Destination note path|Answer in the T3 thread/);
    assert.equal(incoming[0].messageId,'input');assert.equal(incoming[0].text,user.text);
  }
  assert.equal(JSON.stringify(state),before);assert.equal(JSON.stringify(inputs),saved);
});


test('new footer has exactly three lines and retains ordinary user delivery instructions',()=>{
  const footer=obsidianFooter('Vault café','Projects/Task.md');
  assert.equal(footer,'\n\nSent from Obsidian.\nVault: Vault café\nNote: Projects/Task.md');
  const text='Please explain.\n\n'+INLINE_REPLY_INSTRUCTION;
  assert.equal(visibleInlineInput(text+footer),text);
  assert.equal(visibleInlineInput('Please explain.'+footer),'Please explain.');
  assert.equal(visibleInlineInput('Example:\n\n```text'+footer+'\n```'),'Example:\n\n```text'+footer+'\n```');
  assert.equal(obsidianFooter('A\nVault: injected','Task\r.md'),'\n\nSent from Obsidian.\nVault: A Vault: injected\nNote: Task .md');
});
