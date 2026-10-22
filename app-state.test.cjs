const {test}=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const vm=require('node:vm');
const html=fs.readFileSync(__dirname+'/index.html','utf8'); const script=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
function memoryStorage(){const data=new Map();return {getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,value)};}
function app(lookup, storage=memoryStorage()) {
 const els=new Map();
 const node=()=>({value:'',style:{},textContent:'',disabled:false,innerHTML:'',scrollHeight:0,offsetHeight:100,
  listeners:{},addEventListener(type,fn){(this.listeners[type] ||= []).push(fn)},dispatchEvent(event){for(const fn of this.listeners[event.type] || [])fn(event)},scrollIntoView(){},appendChild(){},querySelector(){return node()},closest(){return node()}});
 const el=id=>{if(!els.has(id))els.set(id,node());return els.get(id);};
 const context=vm.createContext({localStorage:storage,confirm:()=>true,
  document:{getElementById:el,querySelector:()=>el('button'),createElement:()=>node()},
  BookLookup:{createLookup:()=>lookup},console,setTimeout,clearTimeout,AbortController,
  fetch:async()=>({ok:true,json:async()=>({summary:'A concise summary.'})})});
 vm.runInContext(script,context);return {el,run:s=>vm.runInContext(s,context),context,storage};
}
const book={title:'Book',author:'Author',description:'A real source description.',source:'Test',warnings:[]};
test('repeated blur does not erase description or repeat successful lookup',async()=>{let n=0;const a=app(async()=>{n++;return book});a.el('isbn').value='9780316003957';await a.run('handleISBN()');await a.run('handleISBN()');assert.equal(n,1);assert.equal(a.el('sourceDescription').value,book.description);});
test('older lookup cannot overwrite a newer scanned book',async()=>{let resolve;const a=app(isbn=>isbn==='9780316003957'?new Promise(r=>resolve=r):Promise.resolve({...book,title:'New book'}));a.el('isbn').value='9780316003957';const old=a.run('handleISBN()');a.el('isbn').value='9780385548984';await a.run('handleISBN()');resolve(book);await old;assert.equal(a.el('title').value,'New book');});
test('generation transmits source and queue accepts only short summaries',async()=>{let sent;const a=app(async()=>book);a.context.fetch=async(u,o)=>{sent=JSON.parse(o.body);return {ok:true,json:async()=>({summary:'A concise summary.'})};};a.el('isbn').value='9780316003957';await a.run('handleISBN()');await a.run('generateSummary()');assert.equal(sent.description,book.description);a.el('summary').value='x'.repeat(261);a.run('addCard({preventDefault(){}})');assert.equal(a.run('cardQueue.length'),0);a.el('summary').value='A concise summary.';a.run('addCard({preventDefault(){}})');assert.equal(a.run('cardQueue.length'),1);assert.equal(a.el('sourceDescription').value,'');});

test('resubmitting ISBN during lookup does not start another provider request',async()=>{
 let n=0,resolve;const a=app(()=>{n++;return new Promise(r=>resolve=r)});
 a.el('isbn').value='9780064407663';const first=a.run('handleISBN()');
 await a.run('handleISBN()');assert.equal(n,1);resolve(book);await first;
 assert.equal(a.el('title').value,'Book');assert.equal(a.el('sourceDescription').value,book.description);
});
test('failed retry retains metadata already found for the same ISBN',async()=>{
 let n=0;const a=app(async()=>++n===1?{...book,description:''}:{title:'',author:'',description:'',source:'',warnings:['timeout']});
 a.el('isbn').value='9780064407663';await a.run('handleISBN()');await a.run('handleISBN()');
 assert.equal(a.el('title').value,'Book');assert.equal(a.el('author').value,'Author');
 a.el('isbn').value='9780385548984';await a.run('handleISBN()');assert.equal(a.el('title').value,'');
});

test('manual title author search fills actual description without requiring ISBN',async()=>{
 let input;const a=app(async query=>{input=query;return book});
 a.el('title').value='Book';a.el('author').value='Author';await a.run('handleTitleAuthor()');
 assert.equal(input.title,'Book');assert.equal(input.author,'Author');assert.equal(a.el('sourceDescription').value,book.description);
});
test('failed database lookup never invokes paid web search',async()=>{
 let paidCalls=0;const a=app(async()=>({title:'',author:'',description:'',warnings:[]}));
 a.context.fetch=async()=>{paidCalls++;throw new Error('Paid search must not run');};
 a.el('isbn').value='9781665932578';await a.run('handleISBN()');assert.equal(paidCalls,0);
 a.el('title').value='Book';a.el('author').value='Author';await a.run('handleTitleAuthor()');assert.equal(paidCalls,0);
});
test('photo fallback is offered only after lookup returns no description',async()=>{
 let n=0;const a=app(async()=>++n===1?book:{...book,description:''});
 assert.equal(a.run('photoEligible'),false);
 a.el('isbn').value='9780316003957';await a.run('handleISBN()');assert.equal(a.run('photoEligible'),false);
 a.el('isbn').value='9781665932578';await a.run('handleISBN()');assert.equal(a.run('photoEligible'),true);
 assert.equal(a.el('descriptionPhotoFallback').hidden,false);
});
test('photo text populates review box without calling AI, then becomes summary source',async()=>{
 const a=app(async()=>({...book,description:''}));
 let terminated=0,aiCalls=0,sent;
 const text='Three friends discover a hidden letter and follow its clues through their town to solve a long forgotten mystery.';
 a.context.Tesseract={createWorker:async()=>({recognize:async()=>({data:{text,confidence:94}}),terminate:async()=>{terminated++;}})};
 a.context.fetch=async(u,o)=>{aiCalls++;sent=JSON.parse(o.body);return {ok:true,json:async()=>({summary:'Three friends follow a mysterious letter.'})};};
 a.run('prepareDescriptionImage=async()=>({})');
 a.el('isbn').value='9781665932578';await a.run('handleISBN()');
 await a.run("readDescriptionPhoto({type:'image/jpeg',size:1000})");
 assert.equal(aiCalls,0);assert.equal(terminated,1);assert.equal(a.el('sourceDescription').value,text);assert.equal(a.el('sourceDetails').open,true);assert.equal(a.run('photoEligible'),false);
 await a.run('generateSummary()');assert.equal(sent.description,text);assert.equal(aiCalls,1);
});
test('photo reading cannot overwrite a newer scanned book',async()=>{
 const a=app(async isbn=>isbn==='9781665932578'?{...book,description:''}:book);
 let resolveText,notifyStart;const started=new Promise(r=>notifyStart=r);
 a.context.Tesseract={createWorker:async()=>({recognize:()=>{notifyStart();return new Promise(r=>resolveText=r)},terminate:async()=>{}})};
 a.run('prepareDescriptionImage=async()=>({})');
 a.el('isbn').value='9781665932578';await a.run('handleISBN()');
 const pending=a.run("readDescriptionPhoto({type:'image/jpeg',size:1000})");await started;
 a.el('isbn').value='9780316003957';await a.run('handleISBN()');
 resolveText({data:{text:'Old book description that must never overwrite the newly scanned book and its source description.',confidence:99}});await pending;
 assert.equal(a.el('sourceDescription').value,book.description);assert.equal(a.run('ocrBusy'),false);
});
test('unreadable photo keeps fallback available and does not create a description',async()=>{
 const a=app(async()=>({...book,description:''}));
 a.context.Tesseract={createWorker:async()=>({recognize:async()=>({data:{text:'12345',confidence:20}}),terminate:async()=>{}})};
 a.run('prepareDescriptionImage=async()=>({})');
 a.el('isbn').value='9781665932578';await a.run('handleISBN()');await a.run("readDescriptionPhoto({type:'image/jpeg',size:1000})");
 assert.equal(a.el('sourceDescription').value,'');assert.equal(a.run('photoEligible'),true);assert.match(a.el('descriptionPhotoStatus').textContent,/Not enough text/);assert.equal(a.run('ocrBusy'),false);
});

function queueCard(a,title='Book'){a.el('title').value=title;a.el('author').value='Author';a.el('summary').value='A concise summary.';a.run('addCard({preventDefault(){}})');}
test('queue survives a new page instance and preserves all card fields',()=>{
 const a=app(async()=>book);queueCard(a);queueCard(a,'Second book');
 const b=app(async()=>book,a.storage);assert.equal(b.run('cardQueue.length'),2);
 assert.equal(b.run('cardQueue[0].summary'),'A concise summary.');assert.equal(b.el('cardCount').textContent,2);
 assert.match(b.el('queueStorageStatus').textContent,/Restored 2/);
});
test('delete and confirmed clear persist, while cancelled clear keeps saved cards',()=>{
 const a=app(async()=>book);queueCard(a);queueCard(a,'Second book');a.run('deleteCard(0)');
 assert.equal(app(async()=>book,a.storage).run('cardQueue[0].title'),'Second Book');
 a.context.confirm=()=>false;a.run('clearCards()');assert.equal(app(async()=>book,a.storage).run('cardQueue.length'),1);
 a.context.confirm=()=>true;a.run('clearCards()');assert.equal(app(async()=>book,a.storage).run('cardQueue.length'),0);
});
test('refresh during editing retains original, saving edit replaces instead of duplicating',()=>{
 const a=app(async()=>book);queueCard(a);a.run('editCard(0)');
 assert.equal(a.run('cardQueue.length'),1);assert.equal(app(async()=>book,a.storage).run('cardQueue[0].title'),'Book');
 a.el('summary').value='An edited summary.';a.run('addCard({preventDefault(){}})');
 const b=app(async()=>book,a.storage);assert.equal(b.run('cardQueue.length'),1);assert.equal(b.run('cardQueue[0].summary'),'An edited summary.');
});
test('scanning another ISBN cancels editing and preserves original card',async()=>{
 const a=app(async()=>({...book,title:'Next book'}));queueCard(a);a.run('editCard(0)');
 a.el('isbn').value='9780316003957';await a.run('handleISBN()');a.el('summary').value='New summary.';a.run('addCard({preventDefault(){}})');
 assert.equal(app(async()=>book,a.storage).run('cardQueue.length'),2);
});
test('storage failures warn clearly without preventing queue use',()=>{
 const a=app(async()=>book,{getItem(){throw Error('Denied')},setItem(){throw Error('Full')}});
 assert.match(a.el('queueStorageStatus').textContent,/could not be loaded/);queueCard(a);
 assert.equal(a.run('cardQueue.length'),1);assert.match(a.el('queueStorageStatus').textContent,/could not be saved/);
});
test('damaged or invalid saved cards do not crash startup or overwrite saved raw data',()=>{
 for(const raw of ['{broken',JSON.stringify({version:1,cards:[{title:'Book',author:'Author',summary:'x'.repeat(261)}]})]){
  const storage=memoryStorage();storage.setItem('ShelfTalker.printQueue.v1',raw);const a=app(async()=>book,storage);
  assert.equal(a.run('cardQueue.length'),0);assert.match(a.el('queueStorageStatus').textContent,/could not be loaded/);
  assert.equal(storage.getItem('ShelfTalker.printQueue.v1'),raw);
 }
});

test('editing title or removing illustrator preserves description, summary and source',async()=>{
 let n=0;const a=app(async()=>{n++;return {...book,author:'Author, Illustrator'}});
 a.el('isbn').value='9780316003957';await a.run('handleISBN()');await a.run('generateSummary()');
 const summary=a.el('summary').value,source=a.el('bookSource').textContent;
 a.el('author').value='Author';a.el('author').dispatchEvent({type:'input'});
 a.el('title').value='Corrected title';a.el('title').dispatchEvent({type:'input'});
 assert.equal(a.el('sourceDescription').value,book.description);assert.equal(a.run('currentBookDescription'),book.description);
 assert.equal(a.el('summary').value,summary);assert.equal(a.el('bookSource').textContent,source);
 await a.run('handleISBN()');assert.equal(n,1);assert.equal(a.el('title').value,'Corrected title');
 a.run('addCard({preventDefault(){}})');const b=app(async()=>book,a.storage);
 assert.equal(b.run('cardQueue[0].author'),'Author');assert.equal(b.run('cardQueue[0].title'),'Corrected Title');assert.equal(b.run('cardQueue[0].summary'),summary);
});
test('metadata edit preserves OCR description and generated summary',async()=>{
 const a=app(async()=>({...book,description:''}));a.el('title').value='Book';a.el('author').value='Author, Illustrator';
 a.el('sourceDescription').value='A description read from the book photo.';a.el('sourceDescription').dispatchEvent({type:'input'});
 a.el('summary').value='A reviewed summary.';a.el('author').value='Author';a.el('author').dispatchEvent({type:'input'});
 assert.equal(a.el('sourceDescription').value,'A description read from the book photo.');assert.equal(a.el('summary').value,'A reviewed summary.');
});
test('metadata correction blocks pending lookup from overwriting edited fields',async()=>{
 let resolve;const a=app(()=>new Promise(r=>resolve=r));a.el('isbn').value='9780316003957';const pending=a.run('handleISBN()');
 a.el('title').value='My corrected title';a.el('title').dispatchEvent({type:'input'});resolve(book);await pending;
 assert.equal(a.el('title').value,'My corrected title');assert.equal(a.el('generateButton').disabled,false);
});
test('changing ISBN still clears previous source and summary',async()=>{
 const a=app(async()=>book);a.el('isbn').value='9780316003957';await a.run('handleISBN()');a.el('summary').value='Previous summary';
 a.el('isbn').value='9780385548984';a.el('isbn').dispatchEvent({type:'input'});
 assert.equal(a.el('sourceDescription').value,'');assert.equal(a.el('summary').value,'');assert.equal(a.run('currentBookDescription'),'');
});
