const {test}=require('node:test'); const assert=require('node:assert/strict');
const {createLookup,validISBN}=require('./book-lookup.js');
const isbn='9780316003957';
const volume=(description, title='The Mysterious Benedict Society')=>({volumeInfo:{title,authors:['Trenton Lee Stewart'],description,industryIdentifiers:[{identifier:isbn}]}});
function mock(route){return async url=>{const data=route(url);return {ok:true,status:200,json:async()=>data};};}
test('validates ISBN checksums',()=>{assert.ok(validISBN(isbn));assert.ok(!validISBN('9780316003958'));});
test('uses a later matching Google record and caches success',async()=>{let n=0;const lookup=createLookup({fetcher:mock(()=>{n++;return {items:[volume(''),volume('Four gifted children face a dangerous mission.')]};})});assert.match((await lookup(isbn)).description,/Four/);const callsAfterSuccess=n;await lookup(isbn);assert.equal(n,callsAfterSuccess);});
test('follows Open Library work, including object description',async()=>{const lookup=createLookup({fetcher:mock(url=>url.includes('googleapis')?{items:[]}:url.includes('/isbn/')?{title:'The Mysterious Benedict Society',authors:[{key:'/authors/OL1A'}],works:[{key:'/works/OL1W'}]}:url.includes('/authors/')?{name:'Trenton Lee Stewart'}:{description:{value:'Four gifted children face a mission.'}})});assert.equal((await lookup(isbn)).source,'Open Library');});
test('title fallback rejects a different author',async()=>{const lookup=createLookup({fetcher:mock(url=>url.includes('q=isbn')?{items:[volume('')]}:url.includes('googleapis')?{items:[{volumeInfo:{title:'The Mysterious Benedict Society',authors:['Someone Else'],description:'Wrong plot'}}]}:{} )});assert.equal((await lookup(isbn)).description,'');});
test('title fallback retrieves matching description',async()=>{const lookup=createLookup({fetcher:mock(url=>url.includes('q=isbn')?{items:[volume('')]}:url.includes('googleapis')?{items:[volume('Correct plot')]}:{})});assert.equal((await lookup(isbn)).description,'Correct plot');});
test('temporary provider failure retries once and reports unavailable',async()=>{let n=0;const lookup=createLookup({delay:async()=>{},fetcher:async()=>{n++;return {ok:false,status:429}}});const result=await lookup(isbn);assert.equal(result.description,'');assert.equal(n,4);assert.equal(result.warnings.length,2);});
test('missing edition author is recovered from work and enables title/author fallback',async()=>{
 let fallback=false;
 const lookup=createLookup({fetcher:mock(url=>{
  if(url.includes('q=isbn'))return {items:[]};
  if(url.includes('/isbn/'))return {title:'The Widow',works:[{key:'/works/OL44328974W'}]};
  if(url.includes('/works/'))return {title:'The Widow',authors:[{author:{key:'/authors/OL39329A'}}]};
  if(url.includes('/authors/'))return {name:'John Grisham'};
  if(url.includes('googleapis')){fallback=true;return {items:[{volumeInfo:{title:'The Widow',authors:['John Grisham'],description:'A lawyer takes on an unexpected case.'}}]};}
  return {};
 })});
 const result=await lookup('9780385548984');assert.equal(result.author,'John Grisham');assert.equal(fallback,true);assert.equal(result.description,'A lawyer takes on an unexpected case.');
});
test('work author recovered even when edition already contains description',async()=>{
 const lookup=createLookup({fetcher:mock(url=>url.includes('googleapis')?{items:[]}:url.includes('/isbn/')?{title:'The Widow',description:'A lawyer takes a case.',works:[{key:'/works/OL44328974W'}]}:url.includes('/works/')?{authors:[{author:{key:'/authors/OL39329A'}}]}:{name:'John Grisham'})});
 const result=await lookup('9780385548984');assert.equal(result.author,'John Grisham');assert.equal(result.description,'A lawyer takes a case.');
});
test('plain title/author search recovers description after empty field search',async()=>{
 const queries=[];
 const lookup=createLookup({fetcher:mock(url=>{
  if(url.includes('googleapis')) {
   const q=new URL(url).searchParams.get('q');queries.push(q);
   if(q.startsWith('isbn:'))return {items:[volume('')]};
   if(q.startsWith('intitle:'))return {items:[]};
   return {items:[{volumeInfo:{title:'Wrong Book',authors:['Trenton Lee Stewart'],description:'Wrong synopsis'}},volume('Verified synopsis')]};
  }
  return {};
 })});
 const result=await lookup(isbn);assert.equal(result.description,'Verified synopsis');assert.ok(queries.includes('The Mysterious Benedict Society Trenton Lee Stewart'));
});

test('broad discovery accepts leading article variation but rejects wrong title or author',async()=>{
 const queries=[];
 const lookup=createLookup({fetcher:mock(url=>{
  if(url.includes('/isbn/'))return {title:'Uproar',authors:[{key:'/authors/OL1A'}]};
  if(url.includes('/authors/'))return {name:'Karim Dimechkie'};
  if(url.includes('googleapis')){
   const q=new URL(url).searchParams.get('q');queries.push(q);
   if(q!=='Dimechkie')return {items:[]};
   return {items:[
    {volumeInfo:{title:'The Uproar',authors:['Someone Else'],description:'Wrong author'}},
    {volumeInfo:{title:'Another Uproar',authors:['Karim Dimechkie'],description:'Wrong title'}},
    {volumeInfo:{title:'The Uproar',authors:['Karim Dimechkie'],description:'Verified description'}}
   ]};
  }return {};
 })});
 const result=await lookup('9780316581189');assert.equal(result.description,'Verified description');assert.ok(queries.includes('Uproar'));assert.ok(queries.includes('Dimechkie'));
});

test('Open Library starts before Google responds',async()=>{
 let resolveGoogle,editionStarted=false;
 const lookup=createLookup({fetcher:async url=>{
  if(url.includes('googleapis'))return new Promise(r=>resolveGoogle=()=>r({ok:true,status:200,json:async()=>({items:[volume('Verified source')]})}));
  editionStarted=true;return {ok:true,status:200,json:async()=>({})};
 }});
 const pending=lookup(isbn);assert.equal(editionStarted,true);resolveGoogle();assert.equal((await pending).description,'Verified source');
});
