# Run against the production build with:
# browser-use < docs/ux/2026-10-01/topics-left/check-skip-navigation.py
new_tab('http://127.0.0.1:3156/')
try:
    for javascript_disabled in [False, True]:
        cdp('Emulation.setScriptExecutionDisabled', value=javascript_disabled)
        for width in [1280, 320]:
            cdp('Emulation.setDeviceMetricsOverride', width=width, height=900,
                deviceScaleFactor=1, mobile=False)
            for route, target in [('/', 'browse-content'), ('/about', 'main')]:
                goto_url('http://127.0.0.1:3156' + route)
                wait_for_load()
                press_key('Tab')
                assert js("document.activeElement.classList.contains('skip-link')")
                assert js("document.activeElement.getAttribute('href')") == '#' + target
                press_key('Enter')
                assert js('document.activeElement.id') == target
                press_key('Tab')
                assert not js("!!document.activeElement.closest('.topic-sidebar, .site-header')")
                assert not js("document.activeElement.classList.contains('skip-link')")
                print('PASS', route, width, 'JavaScript disabled:', javascript_disabled)
finally:
    cdp('Emulation.setScriptExecutionDisabled', value=False)
    cdp('Emulation.clearDeviceMetricsOverride')
