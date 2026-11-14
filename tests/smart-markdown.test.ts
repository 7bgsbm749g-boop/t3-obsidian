import test from 'node:test';
import assert from 'node:assert/strict';
import {loadSmartSend,prepareSmartSend,confirmSmartSend,rememberResponse,mergeSmartSend} from '../src/notes/smart-send';

const path='Formatting.md',destination='machine/project/thread',original='Check playlist order.\nCheck repeated tracks.\nCheck failed reads.';
const formats={
  strike:(text:string)=>text.split('\n').map(line=>`~~${line}~~`).join('\n'),
  bold:(text:string)=>text.split('\n').map(line=>`**${line}**`).join('\n'),
  italic:(text:string)=>text.split('\n').map(line=>`_${line}_`).join('\n'),
  quote:(text:string)=>text.split('\n').map(line=>'> '+line).join('\n'),
  callout:(text:string)=>'> [!note]+\n'+text.split('\n').map(line=>'> '+line).join('\n'),
  nested:(text:string)=>'> [!tip]-\n'+text.split('\n').map(line=>'> > ~~**'+line+'**~~').join('\n'),
};
async function sent(text:string){const data=loadSmartSend(undefined),plan=await prepareSmartSend(data,path,destination,text);confirmSmartSend(data,'first',destination,plan.capture);return data;}

for(const [name,format] of Object.entries(formats))test(`${name} changes preserve confirmed coverage in both directions`,async()=>{
  assert.equal((await prepareSmartSend(await sent(original),path,destination,format(original))).text,'');
  assert.equal((await prepareSmartSend(await sent(format(original)),path,destination,original)).text,'');
});
test('additions inside a sent callout stay local, while a fresh block retains its Markdown',async()=>{
  const data=await sent(original),current=formats.callout(formats.strike(original)+'\n**Also check timeouts.**');
  const next=await prepareSmartSend(data,path,destination,current);
  assert.equal(next.text,'');
  const fresh=await prepareSmartSend(data,path,destination,current+'\n\n**A fresh question.**');
  assert.equal(fresh.text,'**A fresh question.**');
  confirmSmartSend(data,'second',destination,next.capture);
  assert.equal((await prepareSmartSend(mergeSmartSend(JSON.parse(JSON.stringify(data))),path,destination,current)).text,'');
  assert.match((await prepareSmartSend(data,path,'other-thread',current)).text,/Check playlist order/);
});
test('word edits with balanced emphasis stay local',async()=>{
  const data=await sent('Build a timer.');
  assert.equal((await prepareSmartSend(data,path,destination,'Build a **blue timer**.')).text,'');
});
test('a scoped send covers only selected content inside nested formatting',async()=>{
  const current=formats.callout('~~First request.~~\n**Second request.**'),from=current.indexOf('First'),data=loadSmartSend(undefined);
  const first=await prepareSmartSend(data,path,destination,current,[from,from+'First request.'.length]);
  assert.equal(first.text,'> [!note]+\n> ~~First request.~~');confirmSmartSend(data,'first',destination,first.capture);
  const next=await prepareSmartSend(data,path,destination,current);
  assert.equal(next.text,'','Automatic sends skip a partly sent block');
  const second=current.indexOf('Second');
  assert.equal((await prepareSmartSend(data,path,destination,current,[second,second+'Second request.'.length])).text,'> [!note]+\n> **Second request.**');
});
test('extra occurrences inside a sent callout stay local',async()=>{
  const next=await prepareSmartSend(await sent('Same sentence.'),path,destination,formats.callout('Same sentence.\nSame sentence.'));
  assert.equal(next.text,'');
});
for(const [name,format] of Object.entries(formats))test(`saved reply edits stay local after ${name} formatting, while fresh paragraphs send`,async()=>{
  const data=await sent('Before\n\nAfter');await rememberResponse(data,path,'reply',original,'Before\n\n','\n\nAfter',8);
  const current='Before\n\n'+format(original.replace('Check repeated tracks.','Check repeated tracks.\nMy added question.'))+'\n\nAfter';
  const next=await prepareSmartSend(data,path,destination,current);
  assert.equal(next.text,'');
  const fresh=await prepareSmartSend(data,path,destination,current+'\n\nA fresh question.');
  assert.equal(fresh.text,'A fresh question.');
  confirmSmartSend(data,'second',destination,next.capture);
  assert.equal((await prepareSmartSend(data,path,destination,current)).text,'');
});
for(const [before,after] of [
  ['`value * 2`','`value ** 2`'],
  ['```md\n> [!note]\n~~literal~~\n```','```md\n> [!warning]\n~~literal changed~~\n```'],
  ['    ~~literal~~','    ~~literal changed~~'],
  ['\\*literal\\*','\\*literal changed\\*'],
  ['[Link](https://example.com/one)','[Link](https://example.com/two)'],
  ['- [ ] Check it','- [x] Check it'],
  ['- [x] Check it','- [ ] Check it'],
  ['Use 12 tracks.','Use 15 tracks.'],
])test(`edits stay local and a fresh paragraph sends after: ${before.split('\n')[0]}`,async()=>{
  const data=await sent(before);
  assert.equal((await prepareSmartSend(data,path,destination,after)).text,'');
  assert.equal((await prepareSmartSend(data,path,destination,after+'\n\nA fresh question.')).text,'A fresh question.');
});
test('emphasis changes inside link labels preserve their URL and coverage',async()=>{
  const before='Read [the docs](https://example.com/docs)',after='Read [**the docs**](https://example.com/docs)';
  assert.equal((await prepareSmartSend(await sent(before),path,destination,after)).text,'');
});
test('new source retains its complete Markdown, including a custom callout title',async()=>{
  const text='> [!note] Custom title\n> **First request.**\n>\n> _Second request._';
  assert.equal((await prepareSmartSend(loadSmartSend(undefined),path,destination,text)).text,text);
});
test('an edited custom callout title stays local',async()=>{
  const before='> [!note] Old title\n> Same body.',after='> [!warning]- New title\n> Same body.';
  const next=await prepareSmartSend(await sent(before),path,destination,after);
  assert.equal(next.text,'');
});
test('failed preparations and unsent selections do not acquire coverage from formatting',async()=>{
  const data=loadSmartSend(undefined);await prepareSmartSend(data,path,destination,original);
  assert.match((await prepareSmartSend(data,path,destination,formats.strike(original))).text,/Check playlist order/);
});
