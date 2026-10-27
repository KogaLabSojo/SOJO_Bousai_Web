import { WAREHOUSE, buildWarehousePages } from '../content/warehouse.js';

/**
 * 防災倉庫パネル：説明 → 収納品を1件ずつ確認できるガイド。
 */
export class WarehouseGuide {
  constructor(root) {
    this.root = root;
    this.pages = buildWarehousePages(WAREHOUSE);
    this.index = 0;
    this.checked = new Set();
    this._bind();
    this.render();
  }

  _bind() {
    this.root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-wh]');
      if (!btn) return;
      const action = btn.dataset.wh;
      if (action === 'prev') this.go(-1);
      else if (action === 'next') this.go(1);
      else if (action === 'check') this.toggleCheck();
      else if (action === 'jump' && btn.dataset.to != null) this.jump(+btn.dataset.to);
    });
  }

  reset() {
    this.index = 0;
    this.checked.clear();
    this.render();
  }

  go(delta) {
    this.index = Math.max(0, Math.min(this.pages.length - 1, this.index + delta));
    this.render();
  }

  jump(i) {
    this.index = Math.max(0, Math.min(this.pages.length - 1, i));
    this.render();
  }

  toggleCheck() {
    const page = this.pages[this.index];
    if (page?.kind !== 'item') return;
    if (this.checked.has(page.key)) this.checked.delete(page.key);
    else {
      this.checked.add(page.key);
      // 確認したら次へ（最後以外）
      if (this.index < this.pages.length - 1) this.index += 1;
    }
    this.render();
  }

  render() {
    const page = this.pages[this.index];
    const total = this.pages.length;
    const itemPages = this.pages.filter((p) => p.kind === 'item');
    const checkedCount = itemPages.filter((p) => this.checked.has(p.key)).length;
    const atFirst = this.index === 0;
    const atLast = this.index === total - 1;

    let main = '';
    if (page.kind === 'intro') {
      main = `
        <div class="wh-card wh-card-intro">
          <p class="wh-kicker">はじめに ${this.index + 1} / ${WAREHOUSE.intro.length}</p>
          <h3>${esc(page.title)}</h3>
          <p class="wh-body">${esc(page.body)}</p>
        </div>`;
    } else {
      const done = this.checked.has(page.key);
      main = `
        <div class="wh-card wh-card-item${done ? ' is-checked' : ''}">
          <p class="wh-kicker">${esc(page.category)}　${page.indexInCategory} / ${page.categoryTotal}</p>
          <p class="wh-code">${esc(page.code)}</p>
          <h3 class="wh-name">${esc(page.name)}</h3>
          <p class="wh-qty">数量：<b>${esc(page.qty)}</b></p>
          <button type="button" class="wh-check-btn${done ? ' active' : ''}" data-wh="check">
            ${done ? '✓ 確認済み（タップで解除）' : 'この物品を確認した'}
          </button>
        </div>`;
    }

    this.root.innerHTML = `
      <div class="wh-progress" aria-label="進捗">
        <div class="wh-progress-bar"><i style="width:${((this.index + 1) / total) * 100}%"></i></div>
        <div class="wh-progress-meta">
          <span>${this.index + 1} / ${total}</span>
          <span>確認 ${checkedCount} / ${itemPages.length}</span>
        </div>
      </div>
      ${main}
      <div class="wh-nav">
        <button type="button" data-wh="prev" ${atFirst ? 'disabled' : ''}>← 前へ</button>
        <button type="button" class="primary" data-wh="next" ${atLast ? 'disabled' : ''}>
          ${page.kind === 'intro' ? '次へ →' : atLast ? '終わり' : '次の物品 →'}
        </button>
      </div>
      <details class="wh-overview">
        <summary>一覧から選ぶ（${itemPages.length}点）</summary>
        <div class="wh-overview-list">
          ${this._overviewHtml()}
        </div>
      </details>
    `;
  }

  _overviewHtml() {
    let html = '';
    let pageIndex = 0;
    for (const step of WAREHOUSE.intro) {
      const i = pageIndex++;
      html += `<button type="button" class="wh-overview-link${i === this.index ? ' current' : ''}" data-wh="jump" data-to="${i}">📖 ${esc(step.title)}</button>`;
    }
    for (const cat of WAREHOUSE.categories) {
      html += `<p class="wh-overview-cat">${esc(cat.label)}</p>`;
      for (const item of cat.items) {
        const i = pageIndex++;
        const key = `${cat.id}:${item.code}`;
        const done = this.checked.has(key);
        html += `<button type="button" class="wh-overview-link${i === this.index ? ' current' : ''}${done ? ' done' : ''}" data-wh="jump" data-to="${i}">
          <span>${done ? '✓' : '○'}</span>
          <span>${esc(item.name)}</span>
          <small>${esc(item.qty)}</small>
        </button>`;
      }
    }
    return html;
  }
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
