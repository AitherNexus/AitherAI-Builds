const $=id=>document.getElementById(id),chat=$('chat'),welcome=$('welcome'),input=$('input'),form=$('composer'),history=$('history'),sidebar=$('sidebar'),backdrop=$('backdrop'),settingsModal=$('settingsModal'),sendBtn=$('send'),stopBtn=$('stop'),mic=$('mic'),providerSelect=$('providerSelect'),modelSelect=$('modelSelect');
const CHATS_KEY='aither_chats_v8',ACTIVE_KEY='aither_active_v7',THEME_KEY='aither_theme_v7';
const DEFAULT_BACKEND='https://aitherbackend.onrender.com';
let chats=JSON.parse(localStorage.getItem(CHATS_KEY)||'[]'),activeId=localStorage.getItem(ACTIVE_KEY)||null,dark=localStorage.getItem(THEME_KEY)!=='light',busy=false,controller=null,lastUserMessage='';

function base(v){return(v||'').trim().replace(/\/+$/,'')}
function backend(){return base(new URLSearchParams(location.search).get('api'))||DEFAULT_BACKEND}
function api(p){return backend()+p}
function save(){localStorage.setItem(CHATS_KEY,JSON.stringify(chats));if(activeId)localStorage.setItem(ACTIVE_KEY,activeId)}
function active(){return chats.find(c=>c.id===activeId)}
function newid(){return crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random()}
function title(t){return t.trim().replace(/\s+/g,' ').slice(0,42)||'New chat'}
function theme(){document.body.classList.toggle('light',!dark);$('theme').textContent=dark?'☀️':'🌙';localStorage.setItem(THEME_KEY,dark?'dark':'light')}
function newChat(){if(busy)return;const c={id:newid(),title:'New chat',messages:[]};chats.unshift(c);activeId=c.id;save();render();renderHistory();closeSidebar();input.focus()}
function ensure(){if(!active())newChat();return active()}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function markdown(s){let x=escapeHtml(s);const blocks=[];x=x.replace(/```([\w+-]*)\n?([\s\S]*?)```/g,(_,lang,code)=>{const i=blocks.push(`<pre><div class="code-head"><span>${escapeHtml(lang||'code')}</span><button class="copy-code" type="button">Copy</button></div><code>${code.trim()}</code></pre>`)-1;return `@@CODE${i}@@`});x=x.replace(/`([^\`]+)`/g,'<code>$1</code>').replace(/^### (.*)$/gm,'<h3>$1</h3>').replace(/^## (.*)$/gm,'<h2>$1</h2>').replace(/^# (.*)$/gm,'<h1>$1</h1>').replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>').replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>').replace(/\n/g,'<br>');blocks.forEach((b,i)=>x=x.replace(`@@CODE${i}@@`,b));return x}
function bubble(role,text,index=-1,image=null){const r=document.createElement('div');r.className='msg '+role;const a=document.createElement('div');a.className='avatar';a.textContent=role==='user'?'🙂':'A';const w=document.createElement('div');w.className='message-wrap';const n=document.createElement('div');n.className='sender';n.textContent=role==='user'?'You':'Aither AI';const b=document.createElement('div');b.className='bubble';b.innerHTML=role==='assistant'?markdown(text):escapeHtml(text).replace(/\n/g,'<br>');w.append(n,b);if(role==='assistant'&&index>=0){const tools=document.createElement('div');tools.className='message-tools';const copy=document.createElement('button');copy.type='button';copy.textContent='Copy';copy.onclick=()=>navigator.clipboard?.writeText(text);const regen=document.createElement('button');regen.type='button';regen.textContent='Regenerate';regen.onclick=()=>regenerate(index);tools.append(copy,regen);w.append(tools)}r.append(a,w);chat.append(r);return r}
function typing(){const r=bubble('assistant','');r.classList.add('typing-row');r.querySelector('.bubble').innerHTML='<span></span><span></span><span></span>';return r}
function render(){const c=active();chat.replaceChildren();const ms=c?.messages||[];welcome.hidden=ms.length>0;ms.forEach((m,i)=>bubble(m.role,m.content,i));bindMessageTools();requestAnimationFrame(()=>chat.scrollTo({top:chat.scrollHeight,behavior:'smooth'}))}
function bindMessageTools(){chat.querySelectorAll('.copy-code').forEach(btn=>btn.onclick=()=>{const code=btn.closest('pre').querySelector('code').innerText;navigator.clipboard?.writeText(code);btn.textContent='Copied';setTimeout(()=>btn.textContent='Copy',1200)})}
function renderHistory(){history.replaceChildren();chats.forEach(c=>{const wrap=document.createElement('div');wrap.className='history-row';const b=document.createElement('button');b.type='button';b.className='history-item '+(c.id===activeId?'active':'');b.textContent=c.title||'New chat';b.onclick=()=>{if(busy)return;activeId=c.id;save();render();renderHistory();closeSidebar()};const del=document.createElement('button');del.type='button';del.className='history-delete';del.textContent='×';del.title='Delete chat';del.onclick=e=>{e.stopPropagation();if(busy)return;chats=chats.filter(x=>x.id!==c.id);if(activeId===c.id)activeId=chats[0]?.id||null;if(!chats.length)newChat();else{save();render();renderHistory()}};wrap.append(b,del);history.append(wrap)})}
function resize(){input.style.height='auto';input.style.height=Math.min(input.scrollHeight,170)+'px'}
function connection(ok,text){$('connectionText').textContent=text;$('connectionCard').classList.toggle('offline',!ok);$('statusDot').classList.toggle('offline',!ok);$('headerStatus').textContent=busy?'Thinking…':ok?'Ready':'Offline';$('settingsPill').textContent=ok?'Online':'Offline';$('settingsStatus').textContent=text}
let healthRetryTimer=null,healthCheckInFlight=false;
async function check(){if(healthCheckInFlight)return false;healthCheckInFlight=true;try{const r=await fetch(api('/api/health'),{cache:'no-store',signal:AbortSignal.timeout(15000)});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d?.detail||d?.error||('HTTP '+r.status));const ok=d?.status==='healthy'||d?.ok===true||d?.configured===true;if(ok){if(healthRetryTimer){clearTimeout(healthRetryTimer);healthRetryTimer=null}connection(true,'Connected')}else connection(false,'Aither AI server is reachable');return ok}catch(e){const timedOut=e.name==='TimeoutError'||e.name==='AbortError';connection(false,timedOut?'Server may be waking up • you can start chatting':'Server unavailable • retrying in background');if(healthRetryTimer)clearTimeout(healthRetryTimer);healthRetryTimer=setTimeout(()=>{healthRetryTimer=null;check()},5000);return false}finally{healthCheckInFlight=false}}
function busyState(v){busy=v;input.disabled=false;sendBtn.hidden=v;stopBtn.hidden=!v;$('mic').disabled=false;$('headerStatus').textContent=v?'Thinking…':'Ready'}
async function callBackend(messages){const provider=providerSelect?.value||'mincapi';const model=modelSelect?.value||'auto';const r=await fetch(api('/api/ai/chat'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages,provider,model}),signal:controller.signal});const d=await r.json().catch(()=>({}));if(!r.ok)throw Error(d?.detail||d?.error||'Aither AI returned HTTP '+r.status);return d}
const PROVIDERS=[
 {id:'gemini',label:'Gemini',fallback:['gemini-2.5-flash','gemini-2.5-flash-lite']},
 {id:'openrouter',label:'Open Router',fallback:['openrouter/free']},
 {id:'pollinations',label:'Pollinations AI',fallback:['openai/gpt-oss-20b','openai/gpt-4o-mini','google/gemini-2.5-flash-lite','deepseek/deepseek-v4-flash','deepseek/deepseek-v4.1-flash','mistralai/mistral-small-3.2','mistralai/mistral-small-4','qwen/qwen3-coder-30b-a3b-instruct','google/gemma-4-26b-a4b-it','google/gemma-4-31b-it','meta/llama-3.3-70b-instruct','meta/llama-4-maverick','meta/llama-4-scout','amazon/nova-micro-v1','z-ai/glm-5.3-flash']},
 {id:'llama4',label:'Meta Llama 4',fallback:[]},
 {id:'llama3',label:'Meta Llama 3',fallback:['meta/llama-3.3-70b-instruct']},
 {id:'mincapi',label:'Mincapi',fallback:['auto','instant','low-reasoning','high-reasoning','agent-swarm']}
];
let availableModels={};
function prettyModel(model){return String(model).replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}
function modelId(item){return typeof item==='string'?item:item?.id||''}
function modelLabel(item){return typeof item==='string'?prettyModel(item):(item?.name||prettyModel(item?.id||''))}
function isFreeModel(provider,item){
 const id=modelId(item);
 if(provider==='mincapi')return true;
 if(provider==='gemini')return /gemini-(2\.5-flash|2\.5-flash-lite|flash-latest)/i.test(id);
 if(provider==='openrouter')return id==='openrouter/free'||/:free$/.test(id)||(typeof item==='object'&&item?.pricing?.prompt==='0'&&item?.pricing?.completion==='0');
 if(provider==='llama4'||provider==='llama3')return true;
 if(provider==='pollinations'||provider==='llama3')return true;
 return false;
}
function syncModelOptions(preferredModel){
 if(!providerSelect||!modelSelect)return;
 const provider=providerSelect.value;
 const serverModels=availableModels[provider];
 let models=serverModels?.length?[...serverModels]:(PROVIDERS.find(p=>p.id===provider)?.fallback||[]);
 
 // Gemini's configured model is the source of truth: AitherBackend exposes the exact
 // settings.gemini_model value, so don't replace it with a hard-coded browser guess.
 // Other providers continue to be filtered to models explicitly identified as free.
 if(!(provider==='gemini'&&serverModels?.length))models=models.filter(item=>isFreeModel(provider,item));
 const previous=preferredModel||localStorage.getItem('aither_selected_model_name')||modelSelect.value;
 modelSelect.replaceChildren();
 const groups=new Map();
 models.forEach(item=>{const id=modelId(item);if(!id)return;let parent=modelSelect;if(item&&typeof item==='object'&&item.category){if(!groups.has(item.category)){const group=document.createElement('optgroup');group.label=item.category;groups.set(item.category,group);modelSelect.append(group)}parent=groups.get(item.category)}const option=document.createElement('option');option.value=id;option.textContent=(provider==='pollinations'&&typeof item==='object'&&item?.free===true)?modelLabel(item)+' · Free':modelLabel(item);parent.append(option)});
 modelSelect.value=models.some(item=>modelId(item)===previous)?previous:(modelId(models[0])||'');
 if(!models.length){const empty=document.createElement('option');empty.value='';empty.textContent='No models available';modelSelect.append(empty)}
 const status=$('modelStatus');if(status){const hasLive=Boolean(serverModels?.length);status.textContent=models.length+' model choice'+(models.length===1?'':'s')+' · '+(hasLive?'live catalog':'fallback list');status.title=hasLive?'Loaded from AitherBackend':'Using built-in fallback choices; availability may vary'}
 localStorage.setItem('aither_selected_model_name',modelSelect.value);
 localStorage.setItem('aither_selected_provider',provider);
}
async function loadModels(){
 const refreshButton=$('refreshModels');if(refreshButton){refreshButton.disabled=true;refreshButton.textContent='…';}
 if(!providerSelect||!modelSelect)return;
 let providersFromServer={};
 // Render built-in choices before waiting for the live catalog, so settings work immediately.
 const savedProviderNow=localStorage.getItem('aither_selected_provider')||'gemini';
 providerSelect.replaceChildren();
 PROVIDERS.forEach(p=>{const option=document.createElement('option');option.value=p.id;option.textContent=p.label;providerSelect.append(option)});
 providerSelect.value=PROVIDERS.some(p=>p.id===savedProviderNow)?savedProviderNow:'gemini';
 syncModelOptions(localStorage.getItem('aither_selected_model_name')||'');
 try{
  const r=await fetch(api('/api/ai/models'),{cache:'no-store',signal:AbortSignal.timeout(4500)});
  const data=await r.json();
  if(!r.ok)throw Error(data?.detail||'Could not load models');
  providersFromServer=data.providers||{mincapi:data.models||[]};
 }catch(e){/* Keep provider choices visible; built-in fallback choices remain available. */}
 availableModels=providersFromServer;
 const savedProvider=localStorage.getItem('aither_selected_provider');
 const legacy=(localStorage.getItem('aither_selected_model')||'').split(':');
 const legacyProvider=legacy.length>1?legacy[0]:null;
 const initial=PROVIDERS.some(p=>p.id===savedProvider)?savedProvider:(PROVIDERS.some(p=>p.id===legacyProvider)?legacyProvider:'gemini');
 providerSelect.replaceChildren();
 PROVIDERS.forEach(p=>{const option=document.createElement('option');option.value=p.id;option.textContent=p.label;providerSelect.append(option)});
 providerSelect.value=initial;
 const savedModel=localStorage.getItem('aither_selected_model_name')||(legacyProvider===initial?legacy.slice(1).join(':'):'');
 syncModelOptions(savedModel);
 const refreshButton=$('refreshModels');if(refreshButton){refreshButton.disabled=false;refreshButton.textContent='↻';}
}

async function send(text){text=text.trim();if(!text||busy)return;const c=ensure();c.messages.push({role:'user',content:text});lastUserMessage=text;if(c.messages.length===1)c.title=title(text);save();render();renderHistory();input.value='';resize();busyState(true);const loader=typing();controller=new AbortController();try{const d=await callBackend(c.messages);const reply=d?.reply?.trim();if(!reply)throw Error('Aither AI returned an empty response.');loader.remove();c.messages.push({role:'assistant',content:reply});save();render();connection(true,'Connected • '+(d.provider||'Aither AI server'))}catch(e){loader.remove();if(e.name!=='AbortError'){c.messages.push({role:'assistant',content:'⚠️ '+e.message});save();render();connection(false,e.message)}}finally{controller=null;busyState(false);input.focus()}}
async function regenerate(index){if(busy)return;const c=active();if(!c)return;let userIndex=index-1;while(userIndex>=0&&c.messages[userIndex].role!=='user')userIndex--;if(userIndex<0)return;c.messages=c.messages.slice(0,userIndex+1);save();render();busyState(true);const loader=typing();controller=new AbortController();try{const d=await callBackend(c.messages);loader.remove();c.messages.push({role:'assistant',content:d.reply||'No response.'});save();render();connection(true,'Connected • '+(d.provider||d.model||'Aither AI'))}catch(e){loader.remove();if(e.name!=='AbortError'){c.messages.push({role:'assistant',content:'⚠️ '+e.message});save();render()}}finally{controller=null;busyState(false)}}
function stop(){if(controller)controller.abort()}
function openSidebar(){sidebar.classList.add('open');backdrop.hidden=false}function closeSidebar(){sidebar.classList.remove('open');backdrop.hidden=true}function openSettings(){settingsModal.hidden=false;closeSidebar();check()}function closeSettings(){settingsModal.hidden=true;input.focus()}function forceUpdate(){const u=new URL(location.href);u.searchParams.set('aither_update',Date.now());location.replace(u.href)}
function exportChat(){const c=active();if(!c)return;const text=(c.messages||[]).map(m=>`${m.role==='user'?'You':'Aither AI'}:\n${m.content}`).join('\n\n');const blob=new Blob([text],{type:'text/plain'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=(c.title||'aither-chat').replace(/[^a-z0-9]+/gi,'-').toLowerCase()+'.txt';a.click();URL.revokeObjectURL(url)}
form.addEventListener('submit',e=>{e.preventDefault();send(input.value)});input.addEventListener('input',resize);input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit()}});$('newChat').onclick=newChat;$('newChatSide').onclick=newChat;$('menu').onclick=openSidebar;$('closeSidebar').onclick=closeSidebar;backdrop.onclick=closeSidebar;$('settings').onclick=openSettings;$('closeSettings').onclick=closeSettings;$('forceUpdate').onclick=forceUpdate;$('stop').onclick=stop;$('theme').onclick=()=>{dark=!dark;theme()};$('clearChats').onclick=()=>{if(confirm('Delete all saved Aither AI chats from this device?')){chats=[];activeId=null;localStorage.removeItem(ACTIVE_KEY);newChat();closeSettings()}};document.querySelectorAll('.chips button').forEach(b=>b.onclick=()=>send(b.dataset.prompt));settingsModal.addEventListener('click',e=>{if(e.target===settingsModal)closeSettings()});document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!settingsModal.hidden)closeSettings();else closeSidebar()}});

const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;if(Recognition){const rec=new Recognition();rec.lang='en-US';rec.interimResults=false;rec.onstart=()=>mic.textContent='🔴';rec.onend=()=>mic.textContent='🎤';rec.onresult=e=>{input.value=e.results[0][0].transcript;resize();input.focus()};mic.onclick=()=>{try{rec.start()}catch{}}}else mic.onclick=()=>alert('Voice input is not supported in this browser.');

providerSelect?.addEventListener('change',async()=>{
 syncModelOptions();
});$('refreshModels')?.addEventListener('click',()=>loadModels());modelSelect?.addEventListener('change',()=>localStorage.setItem('aither_selected_model_name',modelSelect.value));loadModels();theme();if(!chats.length){const c={id:newid(),title:'New chat',messages:[]};chats=[c];activeId=c.id;save()}else if(!active())activeId=chats[0].id;render();renderHistory();resize();check();
