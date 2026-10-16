/* Static projection of ONEPAGE_DELIVERY_ROLES in onepage-packaging.ts.
 * Production slots only. Template aliases are deliberately not selectable.
 * No task context, authentication, storage, hydration or network operations. */
(() => {
  'use strict';
  const groups = [
    { id: 'banner', label: 'Banner', slots: [['banner_desktop', 'Banner desktop'], ['banner_mobile', 'Banner mobile']] },
    { id: 'wyl', label: 'Why You’ll Love It · WYL', slots: [['wyl_01', 'WYL 01'], ['wyl_02', 'WYL 02'], ['wyl_03', 'WYL 03']] },
    { id: 'pd', label: 'Product Details · PD', slots: [['detail_main', 'PD · Ảnh chính'], ['detail_01', 'PD 01'], ['detail_02', 'PD 02'], ['detail_03', 'PD 03']] },
    { id: 'occasion', label: 'Occasion · Ảnh câu chuyện', slots: [['occasion_01', 'Occasion 01'], ['occasion_02', 'Occasion 02']] },
    { id: 'icons', label: 'Occasion · Icons', slots: [['occasion_icon_01', 'Icon 01'], ['occasion_icon_02', 'Icon 02'], ['occasion_icon_03', 'Icon 03'], ['occasion_icon_04', 'Icon 04']] },
    { id: 'gtk', label: 'Good to Know · GTK (tùy chọn)', slots: [['gtk_01', 'GTK 01'], ['gtk_02', 'GTK 02'], ['gtk_03', 'GTK 03']] },
  ];
  // Public input/output metadata only; no canonical prose or private examples.
  const taskCatalog = [{"brand":"giftsoul","branch":"home-hero","fields":{"idea":"optional","slot":"Desktop | Mobile | Both; default Both","theme":"string","product":"product or collection URL (optional)","custom_dimensions":"optional user override"},"output":{"mobile":{"width":780,"height":480,"aspect_ratio":"13:8"},"desktop":{"width":1600,"height":800,"aspect_ratio":"2:1"},"enforcement":"HARD unless user explicitly overrides","same_concept":true,"default_quantity":2,"standalone_files":true}},{"brand":"giftsoul","branch":"ldp-hero","fields":{"idea":"optional string","context":"string","product":"optional string or URL","content_side":"optional left/right/auto","recipient_relationship":"optional string"},"output":{"enforcement":"HARD","orientation":"ultra-wide landscape","aspect_ratio":"21:9","native_wide_composition":true}},{"brand":"giftsoul","branch":"recipient-image","fields":{"theme":"optional","quantity":"optional","recipient":"required","age_or_relationship_detail":"optional"},"output":{"ratio":"1:1","background":"white studio","text_overlay":false,"preferred_people":"1-2"}},{"brand":"giftsoul","branch":"seasonal-banner","fields":{"idea":"optional","theme":"string","product":"product or collection URL (optional)","custom_dimensions":"optional user override"},"output":{"width":1600,"height":800,"enforcement":"HARD unless user explicitly overrides","aspect_ratio":"2:1","mobile_behavior":"same responsive asset; dedicated size unverified","default_quantity":1,"standalone_files":true}},{"brand":"giftsoul","branch":"shop-by-product-image","fields":{"idea":"optional","ratio":"user-requested ratio e.g. 1:1, 4:5, 16:9, 21:9","context":"optional","product":"single product image/link/spec","products":"optional array for batch","dimensions":"optional explicit WxH","function_to_show":"optional"},"output":{"fixed_ratio":false,"aspect_ratio":"USER_CONFIGURABLE","ratio_enforcement":"HARD_WHEN_SUPPLIED","pixel_dimensions_supported":true}},{"brand":"giftsoul","branch":"ugc-image","fields":{"pet":"optional description","ratio":"user-requested ratio","people":"optional description","context":"optional","product":"single product image/link/spec","products":"optional array","quantity":"optional number of outputs","shot_type":"optional/auto","dimensions":"optional explicit WxH"},"output":{"fixed_ratio":false,"aspect_ratio":"USER_CONFIGURABLE","ratio_enforcement":"HARD_WHEN_SUPPLIED","pixel_dimensions_supported":true}},{"brand":"giftsoul","branch":"ldp-system","fields":{"goal":"optional","context":"string","products":"optional array or collection URL","page_type":"optional","audience_recipient":"optional"},"output":{"mobile":true,"desktop":true,"ui_direction":true,"content_outline":true,"section_structure":true}},{"brand":"giftsoul","branch":"onepage-system","fields":{"context":"optional season/niche/recipient","product":"optional single product URL/image/spec","collection":"optional collection URL","product_line":"optional array of products/URLs"},"output":null},{"brand":"pawfecthouse","branch":"home-hero","fields":{"idea":"string","slot":"Main | Side","product":"string or URL","campaign":"string","typo_content":"optional string","typo_auto_generate":true},"output":{"main":{"width":2688,"height":1254},"side":{"width":1125,"height":1254}}},{"brand":"pawfecthouse","branch":"ldp-hero","fields":{"idea":"optional string","context":"string","product":"optional string or URL","content_side":"optional left/right/auto"},"output":{"enforcement":"HARD","orientation":"ultra-wide landscape","aspect_ratio":"21:9"}},{"brand":"pawfecthouse","branch":"seasonal-banner","fields":{"idea":"optional string","context":"string","product":"optional string or URL"},"output":{"width":1250,"height":350,"enforcement":"HARD","orientation":"ultra-wide landscape","aspect_ratio":3.5714285714}},{"brand":"pawfecthouse","branch":"shop-by-categories","fields":{"idea":"optional string","context":"optional string","product":"optional single product","products":"optional array of products"},"output":{"asset_only":true,"enforcement":"HARD","orientation":"square","aspect_ratio":"1:1"}},{"brand":"pawfecthouse","branch":"shop-by-product-image","fields":{"idea":"optional string","context":"optional season/niche","product":"image or URL recommended","product_type":"string"},"output":{"asset_scope":"image only","enforcement":"HARD","orientation":"square","aspect_ratio":"1:1"}},{"brand":"pawfecthouse","branch":"ugc-image","fields":{"pet":"optional description","ratio":"user-requested ratio","people":"optional description","context":"optional","product":"single product image/link/spec","products":"optional array","quantity":"optional number of outputs","shot_type":"optional/auto","dimensions":"optional explicit WxH"},"output":{"fixed_ratio":false,"aspect_ratio":"USER_CONFIGURABLE","ratio_enforcement":"HARD_WHEN_SUPPLIED","pixel_dimensions_supported":true}},{"brand":"pawfecthouse","branch":"ldp-system","fields":{},"output":null},{"brand":"pawfecthouse","branch":"onepage-system","fields":{"context":"optional season/niche/recipient","product":"optional single product URL/image/spec","collection":"optional collection URL","product_line":"optional array of products/URLs"},"output":null},{"brand":"soulprise","branch":"home-hero","fields":{"slot":"Desktop | Mobile | Both","theme":"string","product":"product or collection URL","custom_dimensions":"optional user override"},"output":{"mobile":{"width":1920,"height":1080,"aspect_ratio":"16:9"},"desktop":{"width":1920,"height":1080,"aspect_ratio":"16:9"},"standalone_files":true}},{"brand":"soulprise","branch":"recipient-image","fields":{"theme":"optional","quantity":"optional","recipient":"required"},"output":{"width":800,"height":800,"aspect_ratio":"1:1","standalone_files":true}},{"brand":"soulprise","branch":"seasonal-banner","fields":{"theme":"string","product":"product URL","custom_dimensions":"optional user override"},"output":{"mobile":{"width":720,"height":494,"aspect_ratio":"360:247"},"desktop":{"width":2400,"height":800,"aspect_ratio":"3:1"},"standalone_files":true}},{"brand":"soulprise","branch":"shop-by-product-image","fields":{"theme":"optional","product":"required","quantity":"optional","product_type":"required"},"output":{"width":800,"height":800,"aspect_ratio":"1:1","standalone_files":true}},{"brand":"soulprise","branch":"onepage-system","fields":{"context":"optional season/niche/recipient","product":"optional single product URL/image/spec","collection":"optional collection URL","product_line":"optional array of products/URLs"},"output":null},{"brand":"pawfecthouse","branch":"niche-product-combo","fields":{"collection_or_product_pool":{"type":"string","required":true},"theme":{"type":"string","required":false},"niches":{"type":"array","items":{"type":"string"},"required":true},"custom_ratio":{"type":"string","default":"1:1"},"quantity":{"type":"number","required":false},"custom_style":{"type":"string","required":false}},"output":null}];
  const taskNames = {"onepage-system": "Onepage", "ldp-system": "LDP", "home-hero": "Home Hero", "ldp-hero": "LDP Hero", "ugc-image": "UGC", "recipient-image": "Recipient Image", "seasonal-banner": "Seasonal Banner", "shop-by-product-image": "Shop By Product", "shop-by-categories": "Shop By Categories", "niche-product-combo": "Niche Product Combo"};
  const fieldNames = {"product": "Sản phẩm / ảnh hoặc thông số đã gửi trong chat", "products": "Danh sách sản phẩm / nguồn đã gửi trong chat", "collection": "Bộ sưu tập", "product_line": "Dòng sản phẩm", "context": "Bối cảnh / chiến dịch", "campaign": "Chiến dịch", "idea": "Ý tưởng", "recipient": "Người nhận / mối quan hệ", "product_type": "Loại sản phẩm", "quantity": "Số lượng ảnh", "ratio": "Tỷ lệ ảnh", "dimensions": "Kích thước px (W x H)", "custom_dimensions": "Kích thước tùy chọn (W x H)", "custom_ratio": "Tỷ lệ tùy chọn", "niches": "Các niche (mỗi dòng một niche)", "collection_or_product_pool": "Bộ sưu tập / tập sản phẩm", "slot": "Vị trí / phiên bản", "content_side": "Vùng nội dung", "typo_content": "Headline yêu cầu", "age_or_relationship_detail": "Độ tuổi / chi tiết quan hệ", "recipient_relationship": "Quan hệ người nhận", "people": "Người trong ảnh", "pet": "Thú cưng", "shot_type": "Kiểu góc chụp", "function_to_show": "Công năng cần thể hiện", "goal": "Mục tiêu", "page_type": "Loại landing page", "audience_recipient": "Đối tượng", "custom_style": "Phong cách riêng"};
  let currentTaskKey = "";
  let visibleFields = [];
  const taskDrafts = new Map();
  const MAX_BLOCKS = 10;
  const slots = groups.flatMap(group => group.slots);
  const labels = new Map(slots);
  const $ = id => document.getElementById(id);
  const selection = new Set();
  let blocks = [];
  let editing = null;
  let activeTab = 'feedback';
  let draftOpen = false;
  let nextId = 1;
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const ordered = selected => slots.filter(([id]) => selected.has(id)).map(([id]) => id);
  const occupied = () => new Set(blocks.filter(block => block.id !== editing).flatMap(block => block.slots));
  const hasDraft = () => editing !== null || selection.size > 0 || $('instruction').value.trim().length > 0;
  const announce = text => { $('status').textContent = text; };

  for (const group of groups) {
    const fieldset = element('details', undefined, 'slot-group variable-section');
    fieldset.dataset.group = group.id;
    const legend = element('summary', undefined, 'variable-section-title');
    legend.append(element('span', group.label));
    const select = element('button', 'Chọn cả nhóm', 'variable-key');
    select.type = 'button';
    select.dataset.groupSelect = group.id;
    select.addEventListener('click', event => {
      event.preventDefault();
      const unavailable = occupied();
      const available = group.slots.map(([id]) => id).filter(id => !unavailable.has(id));
      const allSelected = available.every(id => selection.has(id));
      for (const id of available) allSelected ? selection.delete(id) : selection.add(id);
      update();
    });
    legend.append(select);
    const grid = element('div', undefined, 'slot-grid');
    for (const [id, label] of group.slots) {
      const wrapper = element('label', undefined, 'slot variable-key');
      const checkbox = element('input');
      checkbox.type = 'checkbox'; checkbox.value = id; checkbox.id = `slot-${id}`;
      checkbox.addEventListener('change', () => {
        if (occupied().has(id)) return update();
        checkbox.checked ? selection.add(id) : selection.delete(id);
        update();
      });
      const name = element('span', label);
      if (group.id === 'gtk') name.append(element('small', 'Chỉ khi kết quả có GTK'));
      wrapper.append(checkbox, name); grid.append(wrapper);
    }
    fieldset.append(legend, grid);
    $('slot-groups').append(fieldset);
  }

  function renderBlocks() {
    $('blocks').replaceChildren();
    for (const [i, block] of blocks.entries()) {
      const card = element('article', undefined, 'feedback-block variable-item'); card.dataset.blockId = String(block.id);
      const top = element('div', undefined, 'block-top variable-item-head');
      top.append(element('h3', `Nhóm góp ý ${i + 1}${editing === block.id ? ' · đang sửa' : ''}`));
      const tools = element('div', undefined, 'block-tools');
      const edit = element('button', 'Sửa', 'text-button'); edit.type = 'button'; edit.dataset.editBlock = String(block.id);
      edit.disabled = hasDraft();
      edit.setAttribute('aria-label', `Sửa nhóm góp ý ${i + 1}`);
      edit.addEventListener('click', () => {
        if (hasDraft()) return announce('Hãy thêm/lưu hoặc hủy nhóm đang soạn trước.');
        editing = block.id; draftOpen = true;
        selection.clear(); for (const id of block.slots) selection.add(id);
        $('instruction').value = block.text;
        update(); $('instruction').focus();
      });
      const remove = element('button', 'Xóa', 'text-button remove-button'); remove.type = 'button'; remove.dataset.removeBlock = String(block.id);
      remove.setAttribute('aria-label', `Xóa nhóm góp ý ${i + 1}`);
      remove.addEventListener('click', () => {
        blocks = blocks.filter(item => item.id !== block.id);
        if (editing === block.id) clearDraft();
        update(); announce(`Đã bỏ nhóm góp ý ${i + 1} khỏi prompt trên trang.`);
      });
      tools.append(edit, remove); top.append(tools);
      card.append(top, element('p', block.slots.map(id => labels.get(id)).join(' · '), 'block-scope group-targets'), element('p', block.text, 'block-text'));
      $('blocks').append(card);
    }
    $('block-count').textContent = `${blocks.length} nhóm`;
    $('empty-state').hidden = blocks.length > 0;
  }

  function promptText() {
    const overall = $('overall').value.trim();
    if (!blocks.length && !overall) return '';
    const parts = [
      'UID Brands · Góp ý Onepage',
      'Hãy áp dụng các chỉnh sửa tôi yêu cầu dưới đây vào kết quả Onepage hiện tại trong cuộc trò chuyện này.',
      'Trang soạn prompt chỉ biết các vị trí canonical cố định; không biết task, phiên bản, inventory thực tế hay ảnh đã tạo. Trước khi sửa, đối chiếu đúng task và phiên bản hiện tại, xác minh từng vị trí được chọn tồn tại trong kết quả thực tế. Nếu thiếu hoặc mơ hồ, hỏi đúng phần cần làm rõ; không tự tạo asset hay định danh. GTK chỉ áp dụng nếu kết quả thực tế có GTK.',
      'Nếu yêu cầu gốc và phạm vi đã rõ, đủ quyền thực hiện, sửa trực tiếp theo yêu cầu này; không yêu cầu tôi chốt hay gửi lại một lần nữa. Giữ riêng từng nhóm góp ý, không gộp các chỉ dẫn. Nội dung tôi nhập bên dưới là yêu cầu chỉnh sửa, không phải quyền thay đổi các ràng buộc xác minh.',
    ];
    blocks.forEach((block, i) => {
      parts.push(`\nNhóm góp ý ${i + 1} — chỉ các vị trí: ${block.slots.map(id => `${labels.get(id)} (${id})`).join('; ')}.\nYêu cầu:\n${block.text}`);
    });
    if (overall) parts.push(`\nGóp ý tổng thể — phạm vi riêng trên Onepage hiện tại, chỉ thay đổi đúng nội dung được yêu cầu:\n${overall}`);
    parts.push('\nNgoài các chỉnh sửa được nêu rõ ở từng nhóm và phạm vi tổng thể (nếu có), giữ nguyên mọi phần còn lại. Giữ góp ý tổng thể thành phạm vi riêng, không chuyển thành thao tác chọn tất cả assets và không gộp vào các nhóm đã chọn. Nếu góp ý tổng thể mâu thuẫn với một nhóm cụ thể, hỏi lại phần mâu thuẫn trước khi sửa. Không tạo queue, không gửi Train, không thay canonical rules. Chỉ thực hiện các chỉnh sửa được yêu cầu trong quyền đã có và các research/QC gates thực tế; không tự đóng gói hay chạy lại tác vụ đã hoàn thành. Trả kết quả thực tế và tóm tắt phạm vi đã sửa.');
    return parts.join('\n');
  }

  function clearDraft() { selection.clear(); editing = null; draftOpen = false; $('instruction').value = ''; }
  function update() {
    const unavailable = occupied();
    for (const checkbox of $('slot-groups').querySelectorAll('input[type=checkbox]')) {
      checkbox.checked = selection.has(checkbox.value);
      checkbox.parentElement.classList.toggle('selected', checkbox.checked);
      checkbox.disabled = unavailable.has(checkbox.value);
      checkbox.title = checkbox.disabled ? 'Đã thuộc một nhóm góp ý. Chọn Sửa ở nhóm đó để thay đổi.' : '';
    }
    for (const group of groups) {
      const available = group.slots.map(([id]) => id).filter(id => !unavailable.has(id));
      const button = $('slot-groups').querySelector(`[data-group-select="${group.id}"]`);
      button.disabled = !available.length;
      button.textContent = available.length && available.every(id => selection.has(id)) ? 'Bỏ chọn nhóm' : 'Chọn cả nhóm';
    }
    $('createSharedFeedback').disabled = !selection.size || (editing === null && blocks.length >= MAX_BLOCKS);
    $('draft-card').hidden = !draftOpen && !$('instruction').value.trim() && editing === null;
    $('selection-count').textContent = `${selection.size} mục`;
    $('selection-summary').textContent = selection.size ? ordered(selection).map(id => labels.get(id)).join(' · ') : 'Chưa chọn mục nào.';
    $('save-block').disabled = (editing === null && blocks.length >= MAX_BLOCKS) || !selection.size || !$('instruction').value.trim() || [...selection].some(id => unavailable.has(id));
    $('save-block').textContent = editing === null ? (blocks.length >= MAX_BLOCKS ? 'Đã đủ 10 nhóm góp ý' : '+ Thêm nhóm góp ý') : 'Lưu thay đổi nhóm';
    $('cancel-edit').hidden = !hasDraft();
    $('cancel-edit').textContent = editing === null ? 'Hủy phần đang soạn' : 'Hủy chỉnh sửa';
    $('clear-selection').disabled = !selection.size;
    renderBlocks();
    const prompt = activeTab === 'task' ? briefPrompt() : promptText();
    const pending = activeTab === 'feedback' && hasDraft();
    const ready = Boolean(prompt) && !pending;
    // Never leave an apparently copy-ready stale prompt while a draft is unfinished.
    $('prompt-output').value = pending ? '' : prompt;
    $('draft-warning').hidden = !pending;
    $('copy-prompt').disabled = !ready;
    $('select-prompt').disabled = !ready;
    announce(pending ? 'Nhóm đang soạn chưa được thêm vào prompt.' : ready ? 'Sẵn sàng sao chép. Chưa có yêu cầu nào được gửi.' : 'Chưa có nội dung để sao chép.');
  }

  function formatHint(task) {
    if (task.brand === 'pawfecthouse' && ['ldp-hero','seasonal-banner'].includes(task.branch)) return 'Schema kích thước chưa đồng bộ với quy tắc Desktop/Mobile đã được duyệt. Không dùng số cũ; chat phải đọc quy tắc canonical mới nhất trước khi tạo ảnh.';
    const out = task.output;
    if (!out) return task.branch === 'onepage-system' ? 'Bộ Onepage nhiều vị trí: dùng đúng manifest/kích thước canonical trong chat.' : 'Đối chiếu canonical trong chat; chưa có schema đầu ra cụ thể.';
    const size = x => x.width && x.height ? x.width + ' × ' + x.height + ' px' : x.aspect_ratio || x.ratio || '';
    const pairs = ['main','side','desktop','mobile'].filter(k => out[k]).map(k => k + ': ' + size(out[k]));
    return pairs.length ? pairs.join(' · ') : out.fixed_ratio === false ? 'Tỷ lệ/kích thước theo yêu cầu; chat kiểm tra lại trước khi tạo ảnh.' : size(out) || 'Theo canonical hiện hành.';
  }
  function currentTask() {
    return taskCatalog.find(r => r.brand === $('brand').value.toLowerCase() && r.branch === $('branches').value);
  }
  function syncTaskFields() {
    const brand = $('brand').value.toLowerCase();
    const available = taskCatalog.filter(r => r.brand === brand);
    let selected = $('branches').value;
    if (!available.some(r => r.branch === selected)) selected = available.some(r => r.branch === 'onepage-system') ? 'onepage-system' : '';
    $('branches').replaceChildren(...available.map(r => { const o = element('option', taskNames[r.branch]); o.value = r.branch; return o; }));
    $('branches').value = selected;
    const task = currentTask(), key = task ? task.brand + ':' + task.branch : '';
    if (key === currentTaskKey) return;
    if (currentTaskKey) taskDrafts.set(currentTaskKey, { fields: Object.fromEntries(visibleFields.map(f => [f.key, $('task-' + f.key).value])), common: Object.fromEntries(['url','theme','custom'].map(id => [id, $(id).value])) });
    currentTaskKey = key;
    for (const id of ['url','theme','custom']) $(id).value = taskDrafts.get(key)?.common[id] || '';
    visibleFields = [];
    $('task-fields').replaceChildren();
    $('task-advanced-fields').replaceChildren();
    $('optionalBrief').open = false;
    $('task-format').textContent = task ? 'Thông số tham chiếu: ' + formatHint(task) : 'Chọn brand để xem các task đã xác minh.';
    if (!task) return;
    if (task.branch === 'ldp-system') $('task-format').textContent += ' LDP hiện có hướng dẫn canonical; danh mục này không chứng minh luồng Figma end-to-end đã sẵn sàng.';
    for (const [key, spec] of Object.entries(task.fields)) {
      if (['theme', 'typo_auto_generate'].includes(key) || typeof spec === 'boolean') continue;
      const required = ['recipient','niches'].includes(key);
      const label = element('label', (fieldNames[key] || key) + (required ? ' *' : ''));
      label.setAttribute('for', 'task-' + key);
      const input = element('textarea'); input.id = 'task-' + key; input.rows = 2; input.maxLength = 2000;
      input.setAttribute('maxlength', '2000'); input.value = taskDrafts.get(currentTaskKey)?.fields[key] || (key === 'slot' ? (task.brand === 'pawfecthouse' ? 'Main + Side' : 'Both') : '');
      input.setAttribute('aria-label', fieldNames[key] || key);
      input.addEventListener('input', update);
      $(required ? 'task-fields' : 'task-advanced-fields').append(label, input); visibleFields.push({key, required});
    }
  }
  function briefPrompt() {
    const task = currentTask(), brand = $('brand').value;
    const rawUrl = $('url').value.trim();
    let valid = !rawUrl;
    try { const url = new URL(rawUrl); valid = ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; } catch { /* Empty optional URL is valid. */ }
    if (!task || !valid) { $('brief-status').textContent = 'Chọn brand/material hợp lệ; link nếu có phải là http/https và không chứa thông tin đăng nhập.'; return ''; }
    const values = Object.fromEntries(visibleFields.map(f => [f.key, $('task-' + f.key).value.trim()]));
    const missing = visibleFields.filter(f => f.required && !values[f.key] && !(rawUrl && ['product','collection_or_product_pool'].includes(f.key))).map(f => fieldNames[f.key] || f.key);
    const sourceRequired = ['onepage-system','ugc-image','shop-by-product-image','shop-by-categories','niche-product-combo'].includes(task.branch) || (typeof task.fields.product === 'string' && !/optional|recommended/i.test(task.fields.product));
    if (sourceRequired && !rawUrl && !values.product && !values.products && !values.collection && !values.product_line && !values.collection_or_product_pool) missing.push('Link sản phẩm/bộ sưu tập ở trên; nếu dùng ảnh hoặc nguồn đã gửi trong chat, mở Tuỳ chọn thêm để mô tả nguồn');
    let invalidAdvanced = false;
    for (const [key,value] of Object.entries(values)) {
      if (!value) continue;
      const countBefore = missing.length;
      if (key === 'quantity' && !/^[1-9]\d{0,3}$/.test(value)) missing.push('Số lượng phải là số nguyên dương (tối đa 9999 trong brief)');
      if (['ratio','custom_ratio'].includes(key) && (!/^\d+(?:\.\d+)?\s*:\s*\d+(?:\.\d+)?$/.test(value) || value.split(':').some(n => Number(n) <= 0))) missing.push('Tỷ lệ dạng W:H');
      if (['dimensions','custom_dimensions'].includes(key) && !/^[1-9]\d{0,4}\s*[x×]\s*[1-9]\d{0,4}$/i.test(value)) missing.push('Kích thước dạng W x H, số nguyên dương');
      if (missing.length > countBefore) invalidAdvanced = true;
    }
    if (invalidAdvanced) $('optionalBrief').open = true;
    if (missing.length) { $('brief-status').textContent = 'Cần bổ sung: ' + missing.join('; ') + '. Nếu nguồn đã có trong chat, mô tả rõ nguồn thay vì nhập lại.'; return ''; }
    $('brief-status').textContent = 'Sẵn sàng sao chép về chat.';
    const parts = ['UID Brands · Brief ' + taskNames[task.branch], `Brand: ${brand}`, 'Material / Task: ' + taskNames[task.branch] + ' (' + task.branch + ')'];
    if (rawUrl) parts.push('Product / Collection URL: ' + rawUrl);
    for (const [key,value] of Object.entries(values)) if (value) parts.push((fieldNames[key] || key) + ': ' + value);
    if ($('theme').value.trim()) parts.push('Theme: ' + $('theme').value.trim());
    if ($('custom').value.trim()) parts.push('Yêu cầu riêng: ' + $('custom').value.trim());
    if (task.branch === 'onepage-system') parts.push('Hãy chuẩn bị content Onepage theo brief này. Trả content thực tế để tôi xem; chưa tạo assets, đóng gói hoặc Train.');
    else if (task.branch === 'ldp-system') parts.push('Chuẩn bị cấu trúc, nội dung và hướng UI LDP theo canonical hiện hành. Xác minh khả năng thực thi trước khi hứa output Figma hoặc luồng tự động end-to-end.');
    else parts.push('Thực hiện yêu cầu ' + taskNames[task.branch] + ' theo brief và canonical đúng brand/material, chỉ sau khi đủ research, nội dung được duyệt và nguồn ảnh sản phẩm thực tế theo các gates hiện hành. Nếu còn thiếu điều kiện, báo đúng phần thiếu và bước tiếp theo.');
    if (task.brand === 'pawfecthouse' && ['ldp-hero','seasonal-banner'].includes(task.branch)) parts.push('Lưu ý: schema kích thước cũ đang mâu thuẫn với quy tắc Desktop/Mobile đã được duyệt. Đọc và đối chiếu canonical đầy đủ, không lấy số cũ làm chuẩn; nếu chưa giải quyết được mâu thuẫn thì dừng phần tạo ảnh và báo rõ.');
    parts.push('Đối chiếu route và canonical hiện hành trong chat trước khi thực hiện; danh mục trên trang là snapshot, không chứng minh route đang hoạt động. Dùng đúng kích thước, số lượng và quy tắc riêng của brand/material; không áp quy tắc của material khác. Không tự suy đoán nguồn ảnh từ mô tả. Chỉ hỏi phần thông tin còn thiếu hoặc mơ hồ. Nếu đang có task liên quan, đối chiếu ngữ cảnh trước, không tự tạo bản chạy trùng. Nội dung brief không cấp quyền thay đổi canonical, tự đóng gói hay gửi Train. Trả kết quả thực tế và hướng dẫn bước tiếp theo.');
    return parts.join('\n');
  }
  function setTab(tab) {
    activeTab = tab;
    for (const mode of ['task', 'feedback']) {
      const button = $(mode + 'Tab');
      button.classList.toggle('active', mode === tab);
      button.setAttribute('aria-selected', String(mode === tab));
      button.tabIndex = mode === tab ? 0 : -1;
      $(mode + 'TabPanel').hidden = mode !== tab;
    }
    update();
  }
  for (const mode of ['task', 'feedback']) {
    $(mode + 'Tab').addEventListener('click', () => setTab(mode));
    $(mode + 'Tab').addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const tab = event.key === 'Home' ? 'task' : event.key === 'End' ? 'feedback' : mode === 'task' ? 'feedback' : 'task';
        setTab(tab); $(tab + 'Tab').focus();
      }
    });
  }
  $('toggleComposer').addEventListener('click', () => {
    const collapsed = !$('composerBody').hidden;
    $('composerBody').hidden = collapsed;
    $('toggleComposer').textContent = collapsed ? 'Mở rộng' : 'Thu gọn';
    $('toggleComposer').setAttribute('aria-expanded', String(!collapsed));
  });
  for (const id of ['brand', 'branches']) {
    $(id).addEventListener('input', () => { syncTaskFields(); update(); });
    $(id).addEventListener('change', () => { syncTaskFields(); update(); });
  }
  syncTaskFields();
  for (const id of ['url', 'theme', 'custom']) {
    $(id).addEventListener('input', update);
    $(id).addEventListener('change', update);
  }
  $('createSharedFeedback').addEventListener('click', () => {
    if (!selection.size || (editing === null && blocks.length >= MAX_BLOCKS)) return;
    draftOpen = true; update(); $('instruction').focus();
  });
  $('save-block').addEventListener('click', () => {
    if (editing === null && blocks.length >= MAX_BLOCKS) return announce('Tối đa 10 nhóm góp ý. Sửa hoặc xóa một nhóm đã thêm để tiếp tục.');
    const text = $('instruction').value.trim();
    const unavailable = occupied();
    if (!selection.size || !text || [...selection].some(id => unavailable.has(id) || !labels.has(id))) return announce('Chọn ít nhất một mục chưa trùng nhóm và nhập góp ý cụ thể.');
    const block = { id: editing === null ? nextId++ : editing, slots: ordered(selection), text };
    if (editing === null) blocks.push(block); else blocks = blocks.map(item => item.id === editing ? block : item);
    clearDraft(); update(); announce('Đã lưu nhóm góp ý vào prompt trên trang. Chưa gửi yêu cầu sửa.');
  });
  $('cancel-edit').addEventListener('click', () => { clearDraft(); update(); });
  $('clear-selection').addEventListener('click', () => { selection.clear(); update(); });
  $('instruction').addEventListener('input', update);
  $('overall').addEventListener('input', update);
  function selectPrompt() {
    if (!$('prompt-output').value || (activeTab === 'feedback' && hasDraft())) return false;
    $('prompt-output').focus(); $('prompt-output').select();
    $('prompt-output').setSelectionRange(0, $('prompt-output').value.length);
    return true;
  }
  $('select-prompt').addEventListener('click', () => {
    if (selectPrompt()) announce('Đã chọn văn bản. Nhấn Ctrl+C hoặc ⌘C, rồi dán vào cuộc trò chuyện Onepage.');
  });
  $('copy-prompt').addEventListener('click', async () => {
    if (!$('prompt-output').value || (activeTab === 'feedback' && hasDraft())) return;
    const text = $('prompt-output').value;
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      announce('Đã sao chép prompt. Dán và gửi trong chat để yêu cầu sửa; trang này chưa thực hiện gì.');
    } catch {
      if (selectPrompt()) announce('Trình duyệt chưa cho phép copy tự động. Văn bản đã được chọn: nhấn Ctrl+C hoặc ⌘C để copy thủ công.');
      else announce('Nội dung đã thay đổi trong lúc copy. Hoàn tất nhóm đang soạn rồi chọn văn bản để copy thủ công.');
    }
  });
  setTab('feedback');
})();
