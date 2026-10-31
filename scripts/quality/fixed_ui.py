"""Read-only Playwright capture/comparison for an already rendered fixed UI.
Capture source and candidate at identical viewport and interaction state. Caller owns
source provenance and actual native-handler testing. No auto-accept/rewrite baseline.
"""
import hashlib
import json

CAPTURE = r'''(root, permitted) => {
  const all = [root, ...root.querySelectorAll('*')];
  const ignored = new Set(['STYLE','SCRIPT']);
  return all.filter(n => !ignored.has(n.tagName)).map(n => {
    const c = getComputedStyle(n), r = n.getBoundingClientRect(), origin = root.getBoundingClientRect();
    const styles = Object.fromEntries([...c].map(p => [p,c.getPropertyValue(p)]));
    const allowedColors = permitted.filter(([selector,property]) => n.matches(selector) || (property==='color' && n.closest(selector))).map(([,property])=>property);
    const attributes = Object.fromEntries([...n.attributes].map(a => [a.name,a.value]));
    return {tag:n.tagName, attributes, text:[...n.childNodes].filter(c=>c.nodeType===3).map(c=>c.textContent),
      rect:[r.x-origin.x,r.y-origin.y,r.width,r.height].map(v=>Math.round(v*100)/100), styles, allowed_colors:allowedColors,
      pseudos:['::before','::after'].map(p=>{const pc=getComputedStyle(n,p);return {pseudo:p,styles:Object.fromEntries([...pc].map(k=>[k,pc.getPropertyValue(k)])),allowed_colors:allowedColors.filter(k=>k==='color')};}),
      state:{value:'value' in n?n.value:null,checked:'checked' in n?n.checked:null,
        selected:'selected' in n?n.selected:null,disabled:'disabled' in n?n.disabled:null,
        valid:'validity' in n?n.validity.valid:null,hidden:n.hidden,expanded:n.getAttribute('aria-expanded')},
      image:n.tagName==='IMG'?{complete:n.complete,width:n.naturalWidth,height:n.naturalHeight}:null};
  });
}'''
# Exact compiler mapping, not caller-provided CSS selectors/properties.
COLOR_TARGETS = {
    'preview_background': ['.tee-btn--preview','background-color'],
    'preview_text': ['.tee-btn--preview','color'],
    'cart_background': ['#teeAtcButton','background-color'],
    'cart_text': ['#teeAtcButton','color'],
    'upload_background': ['.tee-btn--upload','background-color'],
    'upload_text': ['.tee-btn--upload','color'],
}

def capture(page, selector, color_tokens=()):
    if any(k not in COLOR_TARGETS for k in color_tokens):
        raise ValueError('UNKNOWN_COLOR_TOKEN')
    root = page.locator(selector)
    if root.count() != 1:
        raise ValueError('EXACTLY_ONE_SOURCE_ROOT_REQUIRED')
    for key in color_tokens:
        if not root.locator(COLOR_TARGETS[key][0]).count():
            raise ValueError('BRAND_TARGET_MISSING')
    data = root.evaluate(CAPTURE, [COLOR_TARGETS[k] for k in color_tokens])
    if any(n['image'] and (not n['image']['complete'] or not n['image']['width']) for n in data):
        raise ValueError('IMAGE_BYTES_NOT_LOADED')
    return {'viewport':page.viewport_size,'nodes':data}

def style_differences(a, b):
    differences=[]
    allowed=set(a['allowed_colors']) & set(b.get('allowed_colors',[]))
    for prop in a['styles'].keys() | b.get('styles',{}).keys():
        av=a['styles'].get(prop);bv=b.get('styles',{}).get(prop)
        if av == bv or prop in allowed: continue
        # Chromium exposes this shorthand as well as all longhands. Comparing
        # longhands retains line/style/thickness checks without color duplication.
        if prop == 'text-decoration' and all(k in a['styles'] and k in b['styles'] for k in ('text-decoration-line','text-decoration-style','text-decoration-thickness','text-decoration-color')): continue
        # Only derivatives actually following both text colors; never background.
        if 'color' in allowed and prop.endswith('color') and prop != 'background-color' and av == a['styles'].get('color') and bv == b['styles'].get('color'): continue
        differences.append(prop)
    return differences

def compare(source, candidate):
    differences = []
    if source['viewport'] != candidate['viewport']: differences.append('VIEWPORT_MISMATCH')
    if len(source['nodes']) != len(candidate['nodes']): differences.append('NODE_COUNT_CHANGED')
    for i,(a,b) in enumerate(zip(source['nodes'],candidate['nodes'])):
        for key in a:
            if key == 'styles':
                differences.extend(f'NODE_{i}_STYLE_{p}_CHANGED' for p in style_differences(a,b))
            elif key == 'pseudos':
                for ap,bp in zip(a['pseudos'],b.get('pseudos',[])):
                    differences.extend(f'NODE_{i}_{ap["pseudo"]}_{p}_CHANGED' for p in style_differences(ap,bp))
                if len(a['pseudos']) != len(b.get('pseudos',[])): differences.append(f'NODE_{i}_PSEUDOS_CHANGED')
            elif a[key] != b.get(key): differences.append(f'NODE_{i}_{key.upper()}_CHANGED')
    digest = lambda x: hashlib.sha256(json.dumps(x,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return {'schema_version':'uid.fixed-ui-comparison.v1','status':'BLOCKED' if differences else 'STRUCTURE_STATE_STYLE_MATCH_NOT_VISUAL_QC',
            'source_sha256':digest(source),'candidate_sha256':digest(candidate),'differences':differences,
            'visual_qc_performed':False,'native_handler_parity':'CALLER_MUST_TEST_REAL_SOURCE_STATES',
            'limitations':'Compared only this viewport and captured state. Source approval, product truth, aesthetics and other states are not certified.'}
