import time,json
from pathlib import Path
results=[]
def state(code): return js(code)
def key(k,code=None):
 cdp('Input.dispatchKeyEvent',type='keyDown',text='\r' if k=='Enter' else '',key=k,code=code or k,windowsVirtualKeyCode={'Enter':13,'Escape':27,'Tab':9}.get(k,0))
 cdp('Input.dispatchKeyEvent',type='keyUp',key=k,code=code or k,windowsVirtualKeyCode={'Enter':13,'Escape':27,'Tab':9}.get(k,0))
def focus(sel):
 assert js('!!document.querySelector('+json.dumps(sel)+')'),sel
 js('document.querySelector('+json.dumps(sel)+').focus()')
def activate(sel):
 focus(sel);key('Enter');time.sleep(.25)
def check(label,code):
 value=js(code);assert value,(label,value);results.append(label)
 Path('/private/tmp/issue27-evidence/journeys.json').write_text(json.dumps(results,indent=2))
for width in (1280,320):
 cdp('Emulation.setDeviceMetricsOverride',width=width,height=720,deviceScaleFactor=1,mobile=False)
 for theme in ('light','dark'):
  for route in ('/','/archive','/category/agents-coding'):
   goto_url('http://127.0.0.1:3127'+route);wait_for_load()
   js("document.documentElement.dataset.theme="+json.dumps(theme))
   activate('.feed-story h3 a')
   check(f'{width}/{theme}/{route} story',"location.pathname.startsWith('/story/')")
   if js("!!document.querySelector('.related-story-list h3 a')"):
    activate('.related-story-list h3 a')
    check(f'{width}/{theme}/{route} next context',"!!document.querySelector('.back-link') && new URL(document.querySelector('.back-link').href).pathname==="+json.dumps(route))
   activate('.story-actions .share-trigger')
   check(f'{width}/{theme}/{route} menu focus',"document.activeElement.textContent==='Copy link'")
   check(f'{width}/{theme}/{route} popup bounds',"(()=>{const r=document.querySelector('.share-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()")
   js("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}})")
   key('Enter');time.sleep(.1)
   check(f'{width}/{theme}/{route} manual copy',"document.activeElement.classList.contains('share-manual') && document.querySelector('.share-feedback').textContent.includes('Couldn’t copy')")
   key('Escape');time.sleep(.05)
   check(f'{width}/{theme}/{route} Escape',"!document.querySelector('.share-panel')&&document.activeElement.classList.contains('share-trigger')")
   activate('.back-link')
   check(f'{width}/{theme}/{route} return',"location.pathname==="+json.dumps(route))
  goto_url('http://127.0.0.1:3127/');wait_for_load()
  activate('.feed-story .share-trigger')
  check(f'{width}/{theme} feed popup bounds',"(()=>{const r=document.querySelector('.share-panel').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})()")
  key('Escape')
  for route in ('/','/topics','/story/90000007','/story/90000008','/story/90000009','/story/90000010'):
   goto_url('http://127.0.0.1:3127'+route);wait_for_load()
   js("document.documentElement.style.fontSize='200%'")
   check(f'{width}/{theme}/{route} 200% text no overflow',"document.documentElement.scrollWidth<=innerWidth")
   js("document.documentElement.style.fontSize=''")
Path('/private/tmp/issue27-evidence/journeys.json').write_text(json.dumps(results,indent=2))
print(f'{len(results)} browser assertions passed')
# A delayed navigation must acknowledge the action while retaining the list.
goto_url('http://127.0.0.1:3127/');wait_for_load()
js("window.__nativeFetch=fetch;window.fetch=(...args)=>new Promise(resolve=>setTimeout(()=>resolve(window.__nativeFetch(...args)),2000))")
activate('a[href="/story/90000009"]')
check('delayed navigation exposes an announced busy state',"!!document.querySelector('[role=status].navigation-pending') && !!document.querySelector('a[aria-busy=true]')")
capture_screenshot('/private/tmp/issue27-evidence/navigation-pending-320.png')
time.sleep(2.5)
check('delayed navigation settles on the requested story',"location.pathname==='/story/90000009' && !document.querySelector('.navigation-pending')")
print('Delayed navigation feedback and completion passed')
