// ==UserScript==
// @name         ChatGPT DOM Compactor
// @namespace    https://
// @version      1.3
// @description  Riduci lag su chat lunghe tenendo solo gli ultimi N messaggi. Modalità HIDE (nasconde) o PURGE (rimuove dal DOM). Pulsante compatto, scorciatoia Ctrl+Shift+K, titolo scheda con conteggio.
// @author       Gianluca Passarella
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ===== Config =====
  const LS_PREFIX = 'cgpt_compactor_';
  const LS_KEEP   = LS_PREFIX + 'keep';
  const LS_MODE   = LS_PREFIX + 'mode'; // 'HIDE' | 'PURGE'
  const DEFAULT_KEEP = 50;
  const REAPPLY_MS   = 600; // debounce per re-applicare pulizia
  const MIN_KEEP     = 5;

  let KEEP = clampInt(readInt(LS_KEEP, DEFAULT_KEEP), MIN_KEEP, 9999);
  let MODE = readStr(LS_MODE, 'HIDE'); // default non distruttivo
  let active = true;                   // compattazione attiva?

  // ===== Utils =====
  function readInt(k, def) {
    const v = localStorage.getItem(k);
    const n = parseInt(v || '', 10);
    return Number.isFinite(n) ? n : def;
  }
  function readStr(k, def) {
    const v = localStorage.getItem(k);
    return v ? String(v) : def;
  }
  function save() {
    localStorage.setItem(LS_KEEP, String(KEEP));
    localStorage.setItem(LS_MODE, MODE);
  }
  function clampInt(n, lo, hi) { return Math.max(lo, Math.min(hi, n|0)); }
  const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // Messaggi: copriamo layout vecchio/nuovo
  function getMessageNodes() {
    // Nuova UI: article[data-testid^="conversation-turn-"]
    // Fallback: [data-message-author-role]
    const a = $all('article[data-testid^="conversation-turn-"]');
    return a.length ? a : $all('[data-message-author-role]');
  }

  function isComposerOrToolbar(node) {
    // Evita di toccare editor/toolbar/textarea/comandi
    if (!node) return false;
    const sel = 'form, textarea, [contenteditable], [data-testid="composer"], [data-testid="sticker-picker"], [data-testid="prompt-editor"]';
    return !!node.closest?.(sel);
  }

  // Aggiorna titolo tab con conteggio
  const originalTitle = document.title;
  function updateTitle(visibleCount) {
    document.title = `[${visibleCount}] ${originalTitle}`;
  }

  // ===== Compattazione =====
  let pending = null;

  function applyCompaction() {
    if (!active) { updateTitle(getMessageNodes().length); return; }

    const nodes = getMessageNodes();
    const total = nodes.length;
    if (total <= KEEP) {
      // nulla da fare
      nodes.forEach(n => { if (MODE === 'HIDE') n.style.display = ''; });
      updateTitle(total);
      return;
    }

    const cut = total - KEEP;
    let visible = 0;

    nodes.forEach((node, idx) => {
      if (isComposerOrToolbar(node)) return; // sicurezza extra

      if (idx < cut) {
        if (MODE === 'HIDE') {
          node.style.display = 'none';
        } else {
          // PURGE: rimuovi davvero
          try { node.remove(); } catch {}
        }
      } else {
        // ultimi KEEP
        if (MODE === 'HIDE') node.style.display = '';
        visible++;
      }
    });

    updateTitle(MODE === 'PURGE' ? getMessageNodes().length : Math.max(visible, KEEP));
  }

  function scheduleApply() {
    if (pending) return;
    pending = setTimeout(() => { pending = null; applyCompaction(); }, REAPPLY_MS);
  }

  // ===== UI minima (pulsante compatto) =====
  function injectStyles() {
    const css = `
      .cgpt-mini {
        position: fixed; right: 10px; bottom: 10px; z-index: 2147483647;
        display: inline-flex; gap: 6px; align-items: center;
        background: rgba(17,24,39,.92); color: #fff; padding: 6px 8px;
        border-radius: 10px; font: 12px/1 system-ui, -apple-system, Segoe UI, Roboto, Arial;
        box-shadow: 0 8px 24px rgba(0,0,0,.25);
      }
      .cgpt-mini button, .cgpt-mini select, .cgpt-mini input {
        font: inherit; color: inherit; background: #1f2937; border: 1px solid #374151;
        border-radius: 8px; padding: 4px 8px; cursor: pointer;
      }
      .cgpt-mini button.primary { background: #2563eb; border-color: #2563eb; }
      .cgpt-mini input[type="number"] { width: 64px; text-align: right; }
      .cgpt-mini label { opacity: .85; }
    `;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
  }

  function buildPanel() {
    const box = document.createElement('div');
    box.className = 'cgpt-mini';
    box.innerHTML = `
      <button class="primary" id="cgpt_toggle">${active ? 'Compatta ON' : 'Compatta OFF'}</button>
      <label>Ultimi</label>
      <input id="cgpt_keep" type="number" min="${MIN_KEEP}" step="5" value="${KEEP}">
      <select id="cgpt_mode" title="Modalità compattazione">
        <option value="HIDE"${MODE==='HIDE'?' selected':''}>HIDE</option>
        <option value="PURGE"${MODE==='PURGE'?' selected':''}>PURGE</option>
      </select>
      <button id="cgpt_reapply" title="Ri-applica adesso">↻</button>
    `;
    document.body.appendChild(box);

    box.querySelector('#cgpt_toggle').addEventListener('click', () => {
      active = !active;
      box.querySelector('#cgpt_toggle').textContent = active ? 'Compatta ON' : 'Compatta OFF';
      scheduleApply();
    });

    box.querySelector('#cgpt_keep').addEventListener('change', (e) => {
      const v = clampInt(parseInt(e.target.value, 10) || DEFAULT_KEEP, MIN_KEEP, 9999);
      KEEP = v; save(); scheduleApply();
    });

    box.querySelector('#cgpt_mode').addEventListener('change', (e) => {
      MODE = e.target.value === 'PURGE' ? 'PURGE' : 'HIDE';
      save(); scheduleApply();
    });

    box.querySelector('#cgpt_reapply').addEventListener('click', () => scheduleApply());
  }

  // ===== Observer =====
  let obs = null;
  function startObserver() {
    if (obs) return;
    obs = new MutationObserver((muts) => {
      // Se cambiano i messaggi o la conversazione, riapplica
      const relevant = muts.some(m => (m.addedNodes && m.addedNodes.length) || (m.removedNodes && m.removedNodes.length));
      if (relevant) scheduleApply();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  // ===== Hotkey =====
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
      active = !active;
      const btn = document.getElementById('cgpt_toggle');
      if (btn) btn.textContent = active ? 'Compatta ON' : 'Compatta OFF';
      scheduleApply();
    }
  });

  // ===== Boot =====
  function boot() {
    injectStyles();
    buildPanel();
    startObserver();

    // Se la chat è già lunga, attiva subito
    active = getMessageNodes().length > KEEP;
    scheduleApply();

    // Rileva cambio conversazione (navigazione interna SPA)
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) {
        lastPath = location.pathname;
        // aspetta che il nuovo DOM si carichi e applica
        setTimeout(() => scheduleApply(), 800);
      }
    }, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
