"""Apply one desktop hero-title feedback group without promoting SBP drafts."""
from pathlib import Path
import copy, hashlib, html, json, re
from datetime import datetime, timezone

P = Path(__file__).resolve().parent
TARGET = 'task/libfile_51054066fdf48191a89e81d4b749e4f9/section/hero/title'
OLD = 'Their Sport. Your Support.'
NEW = 'A Personal Gift for the Sport They Love'
def digest(b): return 'sha256:' + hashlib.sha256(b).hexdigest()
def dump(p, d): p.write_text(json.dumps(d, ensure_ascii=False, indent=2))
def js(d): return json.dumps(d, ensure_ascii=False).replace('</', '<\\/')

bound = (P/'Sport-Lovers-Review.html').read_text()
old_public = (P/'dist/index.html').read_text()
D = json.loads(re.search(r'<script id="preview-data" type="application/json">(.*?)</script>', bound, re.S)[1])
M = D['manifest']; before = copy.deepcopy(M)
assert M['task_id'] == 'libfile_51054066fdf48191a89e81d4b749e4f9'
assert M['source_outcome'] == M['task_id'] and M['source_version'] == '3'
assert M['content_version'] == 'sha256:af66c9067ab31ec45702b9023b2c12e3d1aae367e7751ba2f5f7b36437eb1425'
assert M['render_hash'] == 'sha256:eecb7deefdf48c51ce9cb820fdae47fffbb660802bb1e9b76c9c083def6a656e'
e = next(e for e in M['elements'] if e['id'] == TARGET)
assert e['label'] == OLD
pattern = r'(<h1[^>]*data-review-id="' + re.escape(TARGET) + r'"[^>]*>)(.*?)(</h1>)'
match = re.search(pattern, bound, re.S)
assert match and match[2] == 'Their Sport.<br>Your Support.'
replacement = '<span class="copy-desktop">' + html.escape(NEW) + '</span><span class="copy-mobile">' + match[2] + '</span>'
bound = bound[:match.start(2)] + replacement + bound[match.end(2):]
assert '.copy-mobile{display:none}' in bound and '.copy-desktop{display:none}' in bound
D['copy']['hero']['title'] = NEW
M['viewport_copy']['hero/title'] = {'desktop': NEW, 'mobile': OLD}
e['label'] = NEW; e['viewport_labels'] = {'desktop': NEW, 'mobile': OLD}
revision = {
 'schema_version': 'uid-ldp-applied-feedback/1',
 'task_id': M['task_id'], 'source_outcome': M['source_outcome'], 'source_version': M['source_version'],
 'parent_content_version': before['content_version'], 'parent_render_hash': before['render_hash'],
 'groups': [{'viewport': 'desktop', 'viewport_width': 1440, 'preview_view': {'mode': 'landing'},
 'element_ids': [TARGET], 'feedback': 'Chỗ này cái title hơi cụt, viết anh content khác nha',
 'before': OLD, 'after': NEW,
 'resolution': 'Replace only desktop hero title. Preserve mobile title under explicit selected-viewport scope.'}],
 'sbp_drafts': 'Unapproved; no new SBP images or category changes included in this revision.',
 'preserved': 'All assets, other elements, layout, CSS and feedback runtime remain unchanged.'
}
M['revision'] = revision
M['content_version'] = digest(json.dumps({'copy': D['copy'], 'filters': D['filters'], 'niche_destinations': D['niche_destinations'], 'assets': M['asset_manifest'], 'catalog': D['catalog'], 'viewport_visibility': M['viewport_visibility'], 'viewport_copy': M['viewport_copy']}, sort_keys=True).encode())
css = re.search(r'<style>(.*?)</style>', bound, re.S)[1]
main = re.search(r'<main id="page">(.*?)</main>', bound, re.S)[1]
runtime = re.findall(r'<script>(.*?)</script>', bound, re.S)[-1]
M['render_hash'] = digest((main + css + runtime).encode())
M['created_at'] = datetime.now(timezone.utc).isoformat()
source = json.loads((P/'copy-destination-source-map.json').read_text())
source.update(copy=D['copy'], revision=revision, viewport_copy=M['viewport_copy'], content_version=M['content_version'], render_hash=M['render_hash'])
source['layout']['content_version'] = M['content_version']
M['layout_hash'] = digest(json.dumps(source['layout'], sort_keys=True).encode())
bound = re.sub(r'(<script id="preview-data" type="application/json">).*?(</script>)', lambda m:m[1]+js(D)+m[2], bound, flags=re.S)
public = re.sub(r'<script>const offlineAssets=.*?</script>', '', bound, flags=re.S)
public = re.sub(r'data-offline-src="([^"]+)"', r'src="\1"', public)
old_sections = dict(re.findall(r'<section id="([^"]+)"(.*?)</section>', old_public, re.S))
new_sections = dict(re.findall(r'<section id="([^"]+)"(.*?)</section>', public, re.S))
assert old_sections.keys() == new_sections.keys()
assert all(old_sections[k] == new_sections[k] for k in old_sections if k != 'hero')
assert re.sub(pattern, '', old_sections['hero']) == re.sub(pattern, '', new_sections['hero'])
assert css == re.search(r'<style>(.*?)</style>', old_public, re.S)[1]
assert runtime == re.findall(r'<script>(.*?)</script>', old_public, re.S)[-1]
assert before['asset_manifest'] == M['asset_manifest']
assert len(M['elements']) == 319 and {e['id'] for e in M['elements']} == {e['id'] for e in before['elements']}
for a,b in zip(before['elements'],M['elements']):
 if a['id'] != TARGET: assert a == b
(P/'Sport-Lovers-Review.html').write_text(bound)
(P/'dist/index.html').write_text(public)
dump(P/'preview-manifest.json', M)
dump(P/'preview-layout.json', source['layout'])
dump(P/'copy-destination-source-map.json', source)
dump(P/'applied-feedback-20261021-hero-title.json', revision)
print(json.dumps({'content_version':M['content_version'],'render_hash':M['render_hash'],'changed_element':e,'all_other_sections_identical':True,'sbp_drafts_included':False}))
