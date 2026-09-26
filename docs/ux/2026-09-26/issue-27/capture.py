from pathlib import Path
import json
import time
out=Path('/private/tmp/issue27-evidence')/phase
out.mkdir(parents=True,exist_ok=True)
results=[]
for width in (1280,320):
 cdp('Emulation.setDeviceMetricsOverride',width=width,height=720,deviceScaleFactor=1,mobile=False)
 for theme in ('dark','light'):
  for name,route in [('home','/'),('latest','/archive'),('topic','/category/agents-coding'),('topics','/topics'),('story','/story/90000001')]:
   goto_url('http://127.0.0.1:3127'+route)
   wait_for_load()
   js("document.documentElement.dataset.theme='"+theme+"';localStorage.setItem('hacksnap-theme','"+theme+"')")
   js('document.fonts.ready')
   time.sleep(.25)
   capture_screenshot(str(out/f'{name}-{width}-{theme}.png'),full=True)
   results.append({'page':name,'width':width,'theme':theme,'metrics':js('''JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,title:document.querySelector('h1')?.textContent,tldr:document.querySelector('#article-heading')?.getBoundingClientRect().top,lead:document.querySelector('.feed-story h3')?.getBoundingClientRect().x,sidebar:document.querySelector('.topic-sidebar')?.getBoundingClientRect().x,topicsBottom:document.querySelector('.topic-directory')?.getBoundingClientRect().bottom})''')})
(out/'metrics.json').write_text(json.dumps(results,indent=2))
print(results)
