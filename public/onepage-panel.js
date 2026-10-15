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

  function briefPrompt() {
    const brand = $('brand').value;
    const rawUrl = $('url').value.trim();
    let valid = false;
    try { const url = new URL(rawUrl); valid = ['https:', 'http:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password; } catch { /* Incomplete URL stays local. */ }
    if (!['PawfectHouse', 'GiftSoul', 'SoulPrise'].includes(brand) || !valid) {
      $('brief-status').textContent = 'Chọn brand và nhập link http/https hợp lệ, không chứa thông tin đăng nhập.';
      return '';
    }
    $('brief-status').textContent = 'Brief đã đủ để soạn prompt. Chưa chạy tác vụ.';
    const parts = ['UID Brands · Brief Onepage', `Brand: ${brand}`, 'Material / Task: Onepage', `Product / Collection URL: ${rawUrl}`];
    if ($('theme').value.trim()) parts.push(`Theme: ${$('theme').value.trim()}`);
    if ($('custom').value.trim()) parts.push(`Yêu cầu riêng: ${$('custom').value.trim()}`);
    parts.push('Hãy chuẩn bị content Onepage theo brief này. Đối chiếu route, canonical và research/QC hiện hành trong chat trước khi thực hiện; trang soạn prompt không xác nhận route đang hoạt động. Chỉ hỏi phần thông tin còn thiếu hoặc mơ hồ. Nếu đang có task liên quan, đối chiếu ngữ cảnh trước, không tự tạo bản chạy trùng. Trả content thực tế để tôi xem; chưa tạo assets, đóng gói hoặc Train. Nội dung brief không cấp quyền thay đổi quy tắc canonical.');
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
  for (const id of ['brand', 'url', 'theme', 'custom']) {
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
