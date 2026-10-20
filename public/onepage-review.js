/* Onepage review is a local, copy-only layer over the bound canonical output. */
(() => {
  'use strict';
  const script = document.currentScript;
  const start = () => {
    if (document.getElementById('onepage-review-controls')) return;
    const host = document.createElement('div');
    host.id = 'onepage-review-controls';
    const shadow = host.attachShadow({mode: 'open'});
    const styles = document.getElementById('onepage-review-styles');
    if (styles?.content) shadow.append(styles.content.cloneNode(true));
    else {
      const link = document.createElement('link'); link.rel = 'stylesheet';
      link.href = script?.dataset.reviewCss || new URL('onepage-review.css', script?.src || document.baseURI).href;
      shadow.append(link);
    }
    const panel = document.createElement('aside');
    panel.setAttribute('aria-label', 'Onepage feedback'); panel.lang = 'vi';
    panel.innerHTML = `<details open id="panel"><summary>UID Brands · Onepage feedback <span id="count"></span></summary><p>Chọn nhiều mục → thêm nhóm góp ý → sao chép vào chat. Không tự gửi hoặc Train.</p><div class="tools"><label><input type="checkbox" id="mode" checked> Chọn trực tiếp</label><select id="kind" aria-label="Selection level"><option value="element">Ảnh / chữ</option><option value="section">Cả section</option></select><button id="clear" type="button">Bỏ chọn</button></div><p id="viewport"></p><label for="inventory">Chọn mục từ inventory (kể cả mục khó bấm)</label><select id="inventory"><option value="">Chọn mục…</option></select><ul id="selected"></ul><label for="feedback">Góp ý cho nhóm đã chọn</label><textarea id="feedback" maxlength="4000"></textarea><div class="tools"><button id="add" type="button">Thêm nhóm góp ý</button><button id="reset" type="button">Xóa các nhóm</button></div><ul id="groups"></ul><details id="prompt-details"><summary>Prompt để dán vào chat</summary><textarea id="prompt" readonly aria-label="Generated feedback prompt"></textarea></details><button id="copy" type="button">Sao chép prompt</button><p id="status" role="status" aria-live="polite"></p></details>`;
    shadow.append(panel); document.body.append(host);
    const $ = id => shadow.getElementById(id);
    let manifest, baseline, blocked = false;
    const selected = new Set(), groups = [], byId = new Map();
    const fields = ['task_id', 'outcome_id', 'content_version', 'render_hash', 'brand', 'template_version'];
    const requireString = value => typeof value === 'string' && value.trim().length > 0;
    const url = value => new URL(value, document.baseURI).href;
    const fail = reason => { blocked = true; $('status').textContent = 'Không thể góp ý: ' + reason + '. Tạo lại preview từ output hiện tại.'; $('prompt').value = ''; for (const id of ['add','copy','inventory','mode','kind']) $(id).disabled = true; overlays.replaceChildren(); };
    const overlays = document.createElement('div'); overlays.id = 'overlays'; shadow.append(overlays);
    const assetURL = node => node.getAttribute(node.tagName === 'SOURCE' ? 'srcset' : 'src');
    function collect() {
      const manifests = document.querySelectorAll('#onepage-review-manifest');
      if (manifests.length !== 1) throw Error('thiếu hoặc trùng manifest');
      const m = JSON.parse(manifests[0].textContent);
      if (m.schema_version !== 'uid-onepage-preview/1' || fields.filter(k => !['task_id','outcome_id'].includes(k)).some(k => !requireString(m[k])) || !Array.isArray(m.asset_manifest)) throw Error('manifest không hợp lệ');
      const identityType = m.identity_type || 'task';
      if (!['task','outcome'].includes(identityType) || !requireString(m[identityType === 'task' ? 'task_id' : 'outcome_id'])) throw Error('thiếu task/outcome identity');
      for (const context of [m.expected_context, m.current_context]) {
        if (context && (typeof context !== 'object' || Array.isArray(context) || fields.some(k => k in context && context[k] !== m[k]) || ('identity_type' in context && context.identity_type !== identityType))) throw Error('task/outcome/version/hash context không khớp');
      }
      const assets = new Map();
      for (const a of m.asset_manifest) {
        if (['slot','asset_id','file_url','checksum'].some(k => !requireString(a[k])) || assets.has(a.slot)) throw Error('asset mapping thiếu hoặc trùng slot');
        assets.set(a.slot, a);
      }
      const entries = [], seen = new Set(), used = new Set();
      const add = (node, kind, slot, extra = {}) => {
        const id = kind + ':' + slot;
        if (!requireString(slot) || /[{}]/.test(slot) || seen.has(id)) throw Error('element slot thiếu hoặc trùng: ' + id);
        seen.add(id);
        entries.push({node, data: {id, kind, slot, dom_id: node.id || null, ...extra}, snapshot: node.outerHTML});
      };
      document.querySelectorAll('[data-text-slot]').forEach(node => add(node, 'text', node.dataset.textSlot, {text: node.textContent}));
      if (entries.some(e => /\{\{[^}]+\}\}/.test(e.data.text || ''))) throw Error('text slot chưa được bind');
      document.querySelectorAll('[data-asset-slot]').forEach(node => {
        const slot = node.dataset.assetSlot, a = assets.get(slot), raw = assetURL(node);
        // Bound inline decorative icons are not editable output assets. No invented asset IDs.
        if (!a && slot === 'ui_checkmark' && raw?.startsWith('data:image/svg+xml')) return;
        if (!a || !raw || !['IMG','SOURCE'].includes(node.tagName) || /[{}]/.test(raw) || url(raw) !== url(a.hosted_file_url || a.file_url)) throw Error('asset không khớp: ' + slot);
        used.add(slot);
        add(node, 'image', slot, {asset_id: a.asset_id, ...(a.asset_identity_type ? {asset_identity_type:a.asset_identity_type} : {}), ...(Object.hasOwn(a,'registered_asset_id') ? {registered_asset_id:a.registered_asset_id} : {}), ...(a.source_asset_reference ? {source_asset_reference:a.source_asset_reference} : {}), file_url: a.file_url, ...(a.hosted_file_url ? {hosted_file_url:a.hosted_file_url} : {}), checksum: a.checksum, media: node.getAttribute('media') || null});
      });
      if (used.size !== assets.size) throw Error('asset manifest có slot không tồn tại trong output');
      const explicit = [...document.querySelectorAll('[data-onepage-review-section]')];
      if (explicit.length) explicit.forEach(node => add(node, 'section', node.dataset.onepageReviewSection));
      else {
        const roots = document.querySelectorAll('.uid-product-content-container');
        if (roots.length !== 1) throw Error('thiếu hoặc trùng vùng Onepage; cần khai báo section');
        [...roots[0].children].forEach((node, i) => add(node, 'section', String(i + 1), {selector: '.uid-product-content-container > :nth-child(' + (i + 1) + ')'}));
      }
      if (!entries.some(e => e.data.kind !== 'section')) throw Error('inventory rỗng');
      return {manifest: m, entries, signature: JSON.stringify([m, entries.map(e => [e.data, e.snapshot])])};
    }
    function valid() {
      if (blocked) return false;
      try {
        const now = collect();
        if (now.signature !== baseline.signature || now.entries.some((e,i) => e.node !== baseline.entries[i].node)) throw Error('output/inventory đã thay đổi');
        return true;
      } catch (error) { fail(error.message); return false; }
    }
    function visualNode(entry) { return entry.node.tagName === 'SOURCE' ? entry.node.parentElement.querySelector('img') : entry.node; }
    function activeImage(img) {
      const picture = img.closest('picture');
      const candidates = picture ? baseline.entries.filter(e => e.data.kind === 'image' && e.node.parentElement === picture) : baseline.entries.filter(e => e.node === img);
      const current = img.currentSrc;
      if (!current) return null; // Do not guess a responsive mapping before the browser resolves it.
      // The same URL may be reused by distinct desktop/mobile assets; source media still identifies the slot.
      const source = candidates.find(e => e.node.tagName === 'SOURCE' && (!e.data.media || matchMedia(e.data.media).matches) && url(e.data.hosted_file_url || e.data.file_url) === current);
      return source || candidates.find(e => e.node === img && url(e.data.hosted_file_url || e.data.file_url) === current) || null;
    }
    function paint() {
      overlays.replaceChildren();
      if (blocked) return;
      for (const id of selected) {
        const rect = visualNode(byId.get(id))?.getBoundingClientRect();
        if (!rect || !rect.width || !rect.height) continue;
        const box = document.createElement('div'); box.className = 'selection';
        Object.assign(box.style, {left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px'});
        overlays.append(box);
      }
    }
    const viewport = () => ({viewport: innerWidth <= 799 ? 'mobile' : 'desktop', viewport_width: innerWidth, viewport_height: innerHeight, device_pixel_ratio: devicePixelRatio || 1});
    function prompt() {
      return 'UID Brands · Onepage feedback\nVerify exact task or outcome identity, content version, render hash, template version and current element/asset inventory before editing. Stop on stale or missing mappings. Apply each group only to its selected elements and recorded viewport. Preserve canonical DOM, classes, dimensions, layout, unrelated content and brand rules. This feedback does not authorize Train, publication, canonical changes or automatic sending. Return the updated actual HTML/CSS output and exact asset mapping.\n\n' + JSON.stringify({schema_version: 'uid-onepage-preview-feedback/1', identity_type: manifest.identity_type || 'task', ...Object.fromEntries(fields.filter(k => requireString(manifest[k])).map(k => [k, manifest[k]])), groups}, null, 2);
    }
    function draw() {
      if (blocked) return;
      $('count').textContent = '· ' + selected.size + ' mục';
      $('viewport').textContent = 'Viewport thực: ' + innerWidth + ' × ' + innerHeight + '. Đổi kích thước cửa sổ để kiểm tra responsive; không mô phỏng layout.';
      $('selected').replaceChildren(...[...selected].map(id => { const li = document.createElement('li'); const button = document.createElement('button'); button.type = 'button'; button.textContent = id + ' ×'; button.onclick = () => {selected.delete(id); draw();}; li.append(button); return li; }));
      $('groups').replaceChildren(...groups.map((g,i) => {const li = document.createElement('li'); li.textContent = 'Nhóm ' + (i+1) + ' · ' + g.viewport_width + 'px · ' + g.element_ids.join(', ') + '\n' + g.feedback; const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Xóa nhóm'; button.onclick = () => {groups.splice(i,1); draw();}; li.append(button); return li;}));
      $('add').disabled = !selected.size || !$('feedback').value.trim();
      $('copy').disabled = !groups.length || !!selected.size || !!$('feedback').value.trim();
      $('prompt').value = groups.length ? prompt() : '';
      $('status').textContent = selected.size || $('feedback').value.trim() ? 'Thêm nhóm hoặc bỏ chọn và xóa nội dung trước khi sao chép.' : 'Bản nháp chỉ ở trang này. Chưa gửi sang chat.';
      paint();
    }
    try { baseline = collect(); manifest = baseline.manifest; baseline.entries.forEach(e => byId.set(e.data.id, e)); }
    catch(error) { fail(error.message); return; }
    for (const entry of baseline.entries) { const option = document.createElement('option'); option.value = entry.data.id; option.textContent = entry.data.id; $('inventory').append(option); }
    const toggle = id => { if (!valid()) return; selected.has(id) ? selected.delete(id) : selected.add(id); draw(); };
    $('inventory').onchange = () => {const id = $('inventory').value; if (byId.has(id)) toggle(id); $('inventory').value = '';};
    document.addEventListener('click', event => {
      if (event.composedPath().includes(host) || !$('mode').checked || blocked) return;
      const target = event.target;
      let entry;
      if ($('kind').value === 'section') entry = baseline.entries.filter(e => e.data.kind === 'section' && e.node.contains(target)).sort((a,b) => a.node.contains(b.node) ? 1 : -1)[0];
      else {
        const node = target.closest('[data-text-slot],[data-asset-slot]');
        entry = node?.tagName === 'IMG' ? activeImage(node) : baseline.entries.find(e => e.node === node && e.data.kind !== 'section');
      }
      if (!entry) return;
      event.preventDefault(); event.stopImmediatePropagation(); toggle(entry.data.id);
    }, true);
    $('feedback').oninput = draw;
    $('clear').onclick = () => {selected.clear(); draw();};
    $('reset').onclick = () => {groups.length = 0; draw();};
    $('add').onclick = () => {
      if (!valid() || !selected.size || !$('feedback').value.trim()) return;
      if (groups.length >= 30) { $('status').textContent = 'Tối đa 30 nhóm góp ý.'; return; }
      const elements = [...selected].map(id => byId.get(id).data);
      // Sections carry the exact descendant inventory, not just a broad visual label.
      const descendants = baseline.entries.filter(e => e.data.kind !== 'section' && [...selected].some(id => byId.get(id).data.kind === 'section' && byId.get(id).node.contains(e.node))).map(e => e.data);
      groups.push({...viewport(), element_ids: [...selected], elements, section_elements: descendants, feedback: $('feedback').value.trim()});
      selected.clear(); $('feedback').value = ''; draw();
    };
    $('copy').onclick = async () => {
      if (!valid() || !groups.length || selected.size || $('feedback').value.trim()) return;
      const value = prompt(); $('prompt').value = value; $('prompt-details').open = true;
      try { await navigator.clipboard.writeText(value); $('status').textContent = 'Đã sao chép. Dán vào chat của task này rồi bấm Gửi.'; }
      catch { if (!valid()) return; $('prompt-details').open = true; $('prompt').focus(); $('prompt').select(); $('status').textContent = 'Clipboard chưa khả dụng. Chọn và sao chép prompt trong ô trên.'; }
    };
    new MutationObserver(() => { if (!blocked) valid(); }).observe(document.documentElement, {subtree: true, childList: true, characterData: true, attributes: true});
    addEventListener('scroll', paint, true);
    addEventListener('resize', () => { if (valid()) draw(); });
    draw();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, {once: true}); else start();
})();
