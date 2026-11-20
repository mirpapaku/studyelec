/* 전기기사 PWA v5 - 필기(16,706) + 실기(2,928) + 전트키 이론 완전통합 앱 (studygas 구조 기반 · 노란색 테마) */
let W_QUESTIONS = [];
let P_QUESTIONS = [];
let CHAPTERS_META = [];
let SILGI_CATS = [];
let W_PUBS_META = [];
let TOPIC_SILGI_IDS = {};
let TOPIC_SILGI_TOTAL = {};
let THEORY_MAP = null;

const CHAPTER_MAP = {};
const W_BY_ID = {};
const P_BY_ID = {};
const CK_BY_ID = {};
let totalLinkedW = 0;

const memStore = {};
function safeGet(key, fallback) {
  try {
    if (window.localStorage) {
      const v = localStorage.getItem(key);
      if (v !== null) return v;
    }
  } catch (e) {}
  return Object.prototype.hasOwnProperty.call(memStore, key) ? memStore[key] : fallback;
}
function safeSet(key, val) {
  memStore[key] = String(val);
  try {
    if (window.localStorage) localStorage.setItem(key, String(val));
  } catch (e) {}
}
function safeRemove(key) {
  delete memStore[key];
  try {
    if (window.localStorage) localStorage.removeItem(key);
  } catch (e) {}
}

function syncThemeColorMeta(isDark) {
  const meta = document.getElementById('metaThemeColor');
  if (meta) meta.setAttribute('content', isDark ? '#141108' : '#ca8a04');
}

const isMobileInit = window.innerWidth <= 768;

let state = {
  mode: 'written',            // 'written' | 'practical' | 'unified' | 'theory'
  subj: 'all',
  ch: 'all',
  prios: new Set(),
  pkind: 'all',
  silgiCat: 'all',
  unifiedOrder: 'paired',
  dupMode: 'all',
  onlyLinked: false,
  studyMode: true,
  autoPracDrawer: false,
  filterCollapsed: safeGet('elec_filter_collapsed', '0') === '1',
  zenMode: false,
  bmOnly: false,
  ckFilterId: null,
  mockIds: null,
  mockModeType: null,
  openPracSolIds: {},
  page: 1,
  filtered: [],
  theoryPartId: 'circuit'
};

let bookmarks = new Set();
try {
  bookmarks = new Set(JSON.parse(safeGet('elec_unified_bm_v5', '[]')));
} catch (e) {}

let userAnswers = {};
let pracInputs = {};
let pracGrades = {};
try {
  pracInputs = JSON.parse(safeGet('elec_unified_prac_inputs_v5', '{}')) || {};
  pracGrades = JSON.parse(safeGet('elec_unified_prac_grades_v5', '{}')) || {};
} catch (e) { pracInputs = {}; pracGrades = {}; }

const PRIO_LABELS = {
  '1': ['다산에듀', 'b-p1'],
  '2': ['김영북스', 'b-p2'],
  '3': ['한솔아카데미', 'b-p3'],
  '4': ['테스트나라', 'b-p4'],
  '5': ['핵담', 'b-p5'],
  '6': ['전기요금', 'b-p2'],
  '7': ['파워텔', 'b-p3'],
  '8': ['엔지니어랩', 'b-p4'],
  '9': ['엔트', 'b-p5'],
  '10': ['전자문제집', 'b-p3']
};
const KIND_LABELS = {
  dasan: ['실기·다산', 'b-pw'],
  hansol: ['실기·한솔', 'b-pvp'],
  seoulgong: ['실기·서울공과', 'b-pve'],
  testnara: ['실기·테스트나라', 'b-pw']
};
const SUBJ_NAMES = {
  all: '전체 과목',
  '1': '1과목 전기자기학',
  '2': '2과목 전력공학',
  '3': '3과목 전기기기',
  '4': '4과목 회로·제어',
  '5': '5과목 설비기준(KEC)'
};
const CIRCLES = ['①', '②', '③', '④', '⑤'];

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s) {
  return esc(s).replace(/"/g, '&quot;');
}

function renderMath(root) {
  if (!root) return;
  if (typeof renderMathInElement === 'function') {
    try {
      renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true }
        ],
        throwOnError: false
      });
    } catch (e) {}
  }
}

/* =========================================================================
 * LOCAL PDF STORAGE (IndexedDB) — Both Silgi Short-Answer PDF & Theory PDF
 * ========================================================================= */
const PDF_DB_NAME = 'elec_v5_pdf_store_db';
const PDF_STORE = 'pdfs';
const pdfViewerState = {
  docs: { silgi: null, theory: null },
  meta: { silgi: null, theory: null },
  pages: { silgi: 1, theory: 1 },
  zoom: 1.0,
  activeKind: 'silgi',
  renderToken: 0
};

const LocalPdfStore = {
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(PDF_DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(PDF_STORE)) {
          req.result.createObjectStore(PDF_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async save(kind, file) {
    const buffer = await file.arrayBuffer();
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PDF_STORE, 'readwrite');
      tx.objectStore(PDF_STORE).put({ name: file.name, size: file.size, buffer, savedAt: Date.now() }, kind);
      tx.oncomplete = () => resolve({ name: file.name, size: file.size, buffer });
      tx.onerror = () => reject(tx.error);
    });
  },
  async get(kind) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PDF_STORE, 'readonly');
      const req = tx.objectStore(PDF_STORE).get(kind);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async remove(kind) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(PDF_STORE, 'readwrite');
      tx.objectStore(PDF_STORE).delete(kind);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
};

function ensurePdfWorker() {
  if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
    return true;
  }
  return false;
}

async function loadPdfRecord(kind, rec) {
  if (!rec || !rec.buffer) return false;
  if (!ensurePdfWorker()) return false;
  try {
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(rec.buffer.slice(0)) }).promise;
    pdfViewerState.docs[kind] = doc;
    pdfViewerState.meta[kind] = { name: rec.name, size: rec.size, numPages: doc.numPages };
    updatePdfBadges();
    return true;
  } catch (e) {
    console.error('PDF load failed:', e);
    return false;
  }
}

function updatePdfBadges() {
  // Silgi Short-Answer PDF bar
  const sDoc = pdfViewerState.docs.silgi;
  const sMeta = pdfViewerState.meta.silgi;
  const sBadge = document.getElementById('silgiPdfBadge');
  const sStatus = document.getElementById('silgiPdfStatus');
  const sOpen = document.getElementById('btnOpenSilgiPdf');
  const sRem = document.getElementById('btnRemoveSilgiPdf');
  if (sBadge && sStatus) {
    if (sDoc && sMeta) {
      sBadge.textContent = '✅ 단답 PDF 연결됨';
      sStatus.textContent = `${sMeta.name} (${sMeta.numPages}쪽 · ${(sMeta.size / 1048576).toFixed(1)}MB)`;
      if (sOpen) sOpen.style.display = 'inline-flex';
      if (sRem) sRem.style.display = 'inline-flex';
    } else {
      sBadge.textContent = '📄 실기 단답 PDF 공간';
      sStatus.textContent = '추후 실기 단답·요약 PDF를 여기에 1회 연결해 두면 오프라인에서도 바로 펼쳐볼 수 있습니다.';
      if (sOpen) sOpen.style.display = 'none';
      if (sRem) sRem.style.display = 'none';
    }
  }
  // Theory PDF bar
  const tDoc = pdfViewerState.docs.theory;
  const tMeta = pdfViewerState.meta.theory;
  const tBadge = document.getElementById('theoryPdfBadge');
  const tStatus = document.getElementById('theoryPdfStatus');
  const tOpen = document.getElementById('btnOpenTheoryPdf');
  const tRem = document.getElementById('btnRemoveTheoryPdf');
  if (tBadge && tStatus) {
    if (tDoc && tMeta) {
      tBadge.textContent = '✅ 전트키 PDF 연결됨';
      tStatus.textContent = `${tMeta.name} (${tMeta.numPages}쪽 · ${(tMeta.size / 1048576).toFixed(1)}MB)`;
      if (tOpen) tOpen.style.display = 'inline-flex';
      if (tRem) tRem.style.display = 'inline-flex';
    } else {
      tBadge.textContent = '전트키 PDF 미연결';
      tStatus.textContent = '전트키 이론 PDF를 기기에 1회 연결하면 치트키별 본문이 바로 열립니다';
      if (tOpen) tOpen.style.display = 'none';
      if (tRem) tRem.style.display = 'none';
    }
  }
}

async function handlePdfUpload(kind, file) {
  if (!file) return;
  try {
    const rec = await LocalPdfStore.save(kind, file);
    pdfViewerState.pages[kind] = 1;
    const ok = await loadPdfRecord(kind, rec);
    if (ok) openPdfModal(kind, 1);
  } catch (e) {
    alert('PDF 저장 중 오류가 발생했습니다.');
  }
}

async function removePdf(kind) {
  await LocalPdfStore.remove(kind);
  pdfViewerState.docs[kind] = null;
  pdfViewerState.meta[kind] = null;
  updatePdfBadges();
}

function openPdfModal(kind, targetPage) {
  pdfViewerState.activeKind = kind;
  if (typeof targetPage === 'number' && targetPage >= 1) pdfViewerState.pages[kind] = targetPage;
  const modal = document.getElementById('pdfModal');
  const doc = pdfViewerState.docs[kind];
  const meta = pdfViewerState.meta[kind];
  const titleEl = document.getElementById('pdfModalTitle');
  const ctrlEl = document.getElementById('pdfModalCtrl');
  const emptyEl = document.getElementById('pdfEmptyBox');
  const emptyMsg = document.getElementById('pdfEmptyMsg');
  const wrap = document.getElementById('pdfCanvasWrap');

  if (doc && meta) {
    titleEl.textContent = `📄 ${meta.name}`;
    ctrlEl.style.display = 'flex';
    emptyEl.style.display = 'none';
    modal.classList.add('open');
    renderPdfPage();
  } else {
    titleEl.textContent = kind === 'silgi' ? '📄 실기 단답·요약 PDF 공간' : '📖 전트키 이론 PDF 뷰어';
    ctrlEl.style.display = 'none';
    emptyEl.style.display = 'block';
    emptyMsg.innerHTML = kind === 'silgi'
      ? '아직 연결된 <strong>실기 단답·요약 PDF</strong>가 없습니다.<br>단답 정리 PDF가 준비되면 아래 버튼으로 기기에 1회 연결해 오프라인으로 열람할 수 있습니다.'
      : '아직 연결된 <strong>전트키 이론 PDF</strong>가 없습니다.<br>개인 소장 이론 PDF를 연결하면 치트키별 해당 페이지가 바로 열립니다.';
    wrap.innerHTML = '';
    modal.classList.add('open');
  }
}

function closePdfModal() {
  document.getElementById('pdfModal').classList.remove('open');
}

function stepPdfPage(delta) {
  const k = pdfViewerState.activeKind;
  pdfViewerState.pages[k] = (pdfViewerState.pages[k] || 1) + delta;
  renderPdfPage();
}

function jumpPdfPage(p) {
  if (Number.isNaN(p) || p < 1) return;
  pdfViewerState.pages[pdfViewerState.activeKind] = p;
  renderPdfPage();
}

function zoomPdf(delta) {
  pdfViewerState.zoom = Math.max(0.6, Math.min(2.2, Math.round((pdfViewerState.zoom + delta) * 100) / 100));
  renderPdfPage();
}

async function renderPdfPage() {
  const k = pdfViewerState.activeKind;
  const doc = pdfViewerState.docs[k];
  const wrap = document.getElementById('pdfCanvasWrap');
  if (!doc || !wrap) return;
  const token = ++pdfViewerState.renderToken;
  const total = doc.numPages;
  const pg = Math.max(1, Math.min(total, pdfViewerState.pages[k] || 1));
  pdfViewerState.pages[k] = pg;

  document.getElementById('pdfPageInput').value = String(pg);
  document.getElementById('pdfPageTotal').textContent = `/ ${total}쪽`;
  document.getElementById('pdfZoomLbl').textContent = `${Math.round(pdfViewerState.zoom * 100)}%`;
  document.getElementById('btnPdfPrev').disabled = pg <= 1;
  document.getElementById('btnPdfNext').disabled = pg >= total;

  wrap.innerHTML = '<div style="padding:20px; color:var(--muted);">페이지 렌더링 중...</div>';
  try {
    const page = await doc.getPage(pg);
    if (token !== pdfViewerState.renderToken) return;
    const baseVp = page.getViewport({ scale: 1.0 });
    const availW = Math.max(280, Math.min(840, wrap.clientWidth - 24));
    const scale = (availW / baseVp.width) * pdfViewerState.zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = page.getViewport({ scale: scale * dpr });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
    canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
    wrap.innerHTML = '';
    wrap.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  } catch (e) {
    wrap.innerHTML = '<div style="padding:20px; color:var(--muted);">페이지를 표시하지 못했습니다.</div>';
  }
}

/* =========================================================================
 * ZOOM MODAL
 * ========================================================================= */
function openZoomModal(htmlContent) {
  document.getElementById('zoomBody').innerHTML = htmlContent;
  document.getElementById('zoomModal').classList.add('open');
}
function closeZoomModal() {
  document.getElementById('zoomModal').classList.remove('open');
}

/* =========================================================================
 * INITIALIZATION & DASHBOARD
 * ========================================================================= */
function init() {
  loadStyles();
  const isDarkInit = safeGet('elec_dark', '0') === '1';
  if (isDarkInit) document.body.classList.add('dark');
  syncThemeColorMeta(isDarkInit);

  const savedPageSize = safeGet('elec_page_size', isMobileInit ? '20' : '50');
  const selPs = document.getElementById('selPageSize');
  if (selPs) selPs.value = savedPageSize;

  // Populate 24 linked chapters
  const chSel = document.getElementById('selChapter');
  CHAPTERS_META.forEach(c => {
    const o = document.createElement('option');
    o.value = String(c.id);
    o.textContent = c.title;
    chSel.appendChild(o);
  });

  // Populate Written Publisher multi-select pills
  const wPubRow = document.getElementById('writtenPubRow');
  if (wPubRow) {
    W_PUBS_META.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pill';
      btn.setAttribute('data-prio', String(p.code));
      btn.textContent = `${p.name}(${p.count.toLocaleString()})`;
      btn.onclick = () => setPrio(String(p.code));
      wPubRow.appendChild(btn);
    });
  }

  // Populate Silgi 8 standard categories
  const scSel = document.getElementById('selSilgiCat');
  if (scSel) {
    SILGI_CATS.forEach(cat => {
      const o = document.createElement('option');
      o.value = cat;
      o.textContent = cat;
      scSel.appendChild(o);
    });
  }

  const kpiEl = document.getElementById('kpiLinkedCount');
  if (kpiEl) kpiEl.textContent = `필기 ${totalLinkedW.toLocaleString()}문항 ↔ 실기 ${P_QUESTIONS.length.toLocaleString()}문항`;

  renderDashboard();
  populateSessions();
  syncFilterPanelUI();
  syncTopButtonsUI();
  applyFilters();

  // Restore saved local PDFs asynchronously
  Promise.all([
    LocalPdfStore.get('silgi').then(r => r && loadPdfRecord('silgi', r)).catch(() => {}),
    LocalPdfStore.get('theory').then(r => r && loadPdfRecord('theory', r)).catch(() => {})
  ]).finally(updatePdfBadges);
}

function renderDashboard() {
  const cGrid = document.getElementById('dashChapterGrid');
  if (cGrid) {
    const wCntMap = {}, pCntMap = {};
    W_QUESTIONS.forEach(q => { if (q.ch) wCntMap[q.ch] = (wCntMap[q.ch] || 0) + 1; });
    P_QUESTIONS.forEach(q => { if (q.ch) pCntMap[q.ch] = (pCntMap[q.ch] || 0) + 1; });
    cGrid.innerHTML = CHAPTERS_META.map(c => {
      const wCnt = wCntMap[c.id] || 0;
      const pCnt = pCntMap[c.id] || 0;
      return `<button type="button" class="dash-item" onclick="jumpToChapter(${c.id})">
        <div class="dash-item-title"><span>${esc(c.title)}</span><span>${(wCnt + pCnt).toLocaleString()}</span></div>
        <div class="dash-item-sub">필기 ${wCnt.toLocaleString()}문항 · 실기 ${pCnt.toLocaleString()}문항</div>
      </button>`;
    }).join('');
  }

  const sGrid = document.getElementById('dashSessionGrid');
  if (sGrid) {
    const sesMap = new Map();
    P_QUESTIONS.forEach(pq => {
      const key = `${pq.yr}_${pq.rd}`;
      if (!sesMap.has(key)) sesMap.set(key, { yr: pq.yr, rd: pq.rd, lbl: pq.ses_short, pubs: new Set(), cnt: 0 });
      const e = sesMap.get(key);
      e.pubs.add(pq.src);
      e.cnt++;
    });
    const sorted = [...sesMap.values()].sort((a, b) => (b.yr - a.yr) || (b.rd - a.rd));
    sGrid.innerHTML = sorted.map(info => `
      <button type="button" class="dash-item" onclick="jumpToPracSession('${escAttr(info.lbl)}')">
        <div class="dash-item-title"><span>${info.yr}-${info.rd}회</span><span>${info.cnt}문항</span></div>
        <div class="dash-item-sub">${info.pubs.size}개 교재 수록</div>
      </button>
    `).join('');
  }
}

function jumpToChapter(chId) {
  if (state.mode === 'theory') switchMode('unified');
  document.getElementById('selChapter').value = String(chId);
  state.ch = String(chId);
  state.ckFilterId = null;
  document.getElementById('dashboardPanel').classList.remove('open');
  document.getElementById('btnDashboard').classList.remove('active');
  state.page = 1;
  applyFilters();
}

function jumpToPracSession(sesShort) {
  document.getElementById('dashboardPanel').classList.remove('open');
  document.getElementById('btnDashboard').classList.remove('active');
  switchMode('practical');
  const sel = document.getElementById('selSession');
  if (sel) {
    // Select first option matching sesShort
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === sesShort || sel.options[i].value.startsWith(sesShort)) {
        sel.selectedIndex = i;
        break;
      }
    }
  }
  state.page = 1;
  applyFilters();
}

function populateSessions() {
  const sel = document.getElementById('selSession');
  if (!sel) return;
  const prevVal = sel.value;
  sel.innerHTML = '<option value="all">전체 회차·단원</option>';
  const seen = new Set();
  if (state.mode === 'practical') {
    P_QUESTIONS.forEach(q => {
      if (q.ses_short && !seen.has(q.ses_short)) {
        seen.add(q.ses_short);
        const opt = document.createElement('option');
        opt.value = q.ses_short;
        opt.textContent = `${q.ses_short} 실기`;
        sel.appendChild(opt);
      }
    });
  } else if (state.mode === 'written') {
    W_QUESTIONS.forEach(q => {
      if (q.sses && !seen.has(q.sses)) {
        seen.add(q.sses);
        const opt = document.createElement('option');
        opt.value = q.sses;
        opt.textContent = q.sses;
        sel.appendChild(opt);
      }
    });
  } else {
    // Unified: use year_round short labels
    [...W_QUESTIONS, ...P_QUESTIONS].forEach(q => {
      const lbl = q._type === 'p' ? q.ses_short : (q.rd === 12 ? `${q.yr}년 1·2회 통합` : `${q.yr}년 ${q.rd}회`);
      if (lbl && !seen.has(lbl)) {
        seen.add(lbl);
        const opt = document.createElement('option');
        opt.value = lbl;
        opt.textContent = lbl;
        sel.appendChild(opt);
      }
    });
  }
  if (seen.has(prevVal)) sel.value = prevVal;
}

function stepSelect(selectId, delta) {
  const sel = document.getElementById(selectId);
  if (!sel || sel.options.length <= 1) return;
  let nextIdx = sel.selectedIndex + delta;
  if (nextIdx < 0) nextIdx = sel.options.length - 1;
  if (nextIdx >= sel.options.length) nextIdx = 0;
  sel.selectedIndex = nextIdx;
  if (selectId === 'selChapter') onChapterChange();
  else applyFilters();
}

function onChapterChange() {
  state.ch = document.getElementById('selChapter').value;
  state.mockIds = null;
  state.ckFilterId = null;
  state.page = 1;
  applyFilters();
}

function onPageSizeChange() {
  const v = document.getElementById('selPageSize').value;
  safeSet('elec_page_size', v);
  state.page = 1;
  renderPage();
}

let searchTimer = null;
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.page = 1;
    applyFilters();
  }, 180);
}

/* =========================================================================
 * MODE SWITCHING (Written / Practical / Unified / Theory)
 * ========================================================================= */
function switchMode(mode) {
  state.mode = mode;
  state.mockIds = null;
  state.ckFilterId = null;
  state.page = 1;

  document.getElementById('tabWritten')?.classList.toggle('active', mode === 'written');
  document.getElementById('tabPrac')?.classList.toggle('active', mode === 'practical');
  document.getElementById('tabLinked')?.classList.toggle('active', mode === 'unified');
  document.getElementById('tabTheory')?.classList.toggle('active', mode === 'theory');

  const isTheory = mode === 'theory';
  document.getElementById('theoryPanel')?.classList.toggle('show', isTheory);
  const quizArea = document.getElementById('quizMainArea');
  if (quizArea) quizArea.style.display = isTheory ? 'none' : 'block';

  if (isTheory) {
    renderTheoryPanel();
    return;
  }

  document.getElementById('writtenFilters').style.display = (mode === 'written' || mode === 'unified') ? 'block' : 'none';
  const btnOL = document.getElementById('btnOnlyLinked');
  if (btnOL) btnOL.style.display = (mode === 'practical') ? 'none' : '';
  document.getElementById('pracFilters').style.display = (mode === 'practical' || mode === 'unified') ? 'block' : 'none';
  document.getElementById('unifiedFilters').style.display = mode === 'unified' ? 'block' : 'none';
  document.getElementById('btnAutoPrac').style.display = mode === 'practical' ? 'none' : 'inline-flex';

  populateSessions();
  applyFilters();
}

/* =========================================================================
 * THEORY (전트키 이론) PANEL
 * ========================================================================= */
function renderTheoryPanel() {
  if (!THEORY_MAP) return;
  updatePdfBadges();
  const parts = THEORY_MAP.parts || [];
  const tabsEl = document.getElementById('theoryPartTabs');
  if (tabsEl) {
    tabsEl.innerHTML = parts.map(p => {
      const pname = p.name || p.title || p.id;
      return `<button type="button" class="pill ${p.id === state.theoryPartId ? 'active' : ''}" onclick="setTheoryPart('${p.id}')">${esc(pname)}</button>`;
    }).join('');
  }
  const kw = (document.getElementById('txtTheorySearch')?.value || '').trim().toLowerCase();
  const listEl = document.getElementById('theoryChapterList');
  if (!listEl) return;

  const activePart = parts.find(p => p.id === state.theoryPartId) || parts[0];
  if (!activePart) return;

  const chs = activePart.chapters || [];
  const html = chs.map(ch => {
    const cks = (ch.cheatkeys || []).filter(ck => {
      if (!kw) return true;
      return `${ch.title} ${ck.title} 치트키 ${ck.number}`.toLowerCase().includes(kw);
    });
    if (!cks.length) return '';
    return `<div class="theory-ch-card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
        <strong style="font-size:14px;">${esc(ch.label || '')} ${esc(ch.title)}</strong>
        <span style="font-size:11.5px; color:var(--muted);">p.${ch.startPage}~${ch.endPage} · ${ch.questionCount || 0}문항</span>
      </div>
      <div class="theory-ck-grid">
        ${cks.map(ck => `
          <div class="theory-ck-btn">
            <div class="theory-ck-title">치트키 ${ck.number}. ${esc(ck.title)}</div>
            <div class="theory-ck-sub">p.${ck.startPage}~${ck.endPage} · 연계 필기 ${ck.questionCount || 0}문항</div>
            <div style="display:flex; gap:5px; margin-top:6px;">
              <button type="button" class="btn" style="padding:2px 7px; font-size:11px;" onclick="openPdfModal('theory', ${ck.startPage || 1})">📖 이론 PDF (p.${ck.startPage})</button>
              <button type="button" class="btn active" style="padding:2px 7px; font-size:11px;" onclick="jumpToCheatkeyQuestions('${ck.id}')">📝 연계 기출 풀기</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }).join('');

  listEl.innerHTML = html || '<div class="q-card" style="text-align:center; padding:24px; color:var(--muted);">검색 조건에 맞는 치트키가 없습니다.</div>';
}

function setTheoryPart(partId) {
  state.theoryPartId = partId;
  renderTheoryPanel();
}

function jumpToCheatkeyQuestions(ckId) {
  switchMode('written');
  resetAllFilters();
  state.ckFilterId = ckId;
  state.page = 1;
  applyFilters();
}

/* =========================================================================
 * FILTER CONTROLS & TOP BUTTONS
 * ========================================================================= */
function toggleFilterPanel() {
  state.filterCollapsed = !state.filterCollapsed;
  safeSet('elec_filter_collapsed', state.filterCollapsed ? '1' : '0');
  syncFilterPanelUI();
}

function syncFilterPanelUI() {
  const card = document.getElementById('filterCard');
  const bar = document.getElementById('filterCollapsedBar');
  const btn = document.getElementById('btnToggleFilter');
  const mobBtn = document.getElementById('mobFilterBtn');
  if (state.filterCollapsed) {
    card.classList.add('hidden');
    bar.classList.add('show');
    btn.textContent = '🔽 필터 열기';
    btn.classList.add('active');
    if (mobBtn) { mobBtn.textContent = '🔽 필터열기'; mobBtn.classList.add('active'); }
  } else {
    card.classList.remove('hidden');
    bar.classList.remove('show');
    btn.textContent = '🔼 필터 숨김';
    btn.classList.remove('active');
    if (mobBtn) { mobBtn.textContent = '🔼 필터숨김'; mobBtn.classList.remove('active'); }
  }
  updateFilterSummaryChips();
}

function updateFilterSummaryChips() {
  const el = document.getElementById('filterSummaryChips');
  if (!el) return;
  const modeLbl = state.mode === 'written' ? '📝 필기 기출' : (state.mode === 'practical' ? '🔧 실기 통합' : '🔗 필기+실기 함께보기');
  const subjLbl = SUBJ_NAMES[state.subj] || '전체 과목';
  const chSel = document.getElementById('selChapter');
  const chLbl = (chSel && chSel.value !== 'all') ? chSel.options[chSel.selectedIndex].text : '';
  const kw = document.getElementById('txtSearch')?.value.trim() || '';

  let html = `<span class="badge b-p1">${esc(modeLbl)}</span><span class="badge b-subj">${esc(subjLbl)}</span>`;
  if (chLbl) html += `<span class="badge b-ch">${esc(chLbl)}</span>`;
  if (state.ckFilterId && CK_BY_ID[state.ckFilterId]) html += `<span class="badge badge-ck">📖 ${esc(CK_BY_ID[state.ckFilterId].title)}</span>`;
  if (state.mode !== 'practical' && state.prios.size > 0) {
    Array.from(state.prios).forEach(p => {
      const [lbl, cls] = PRIO_LABELS[p] || [p, 'b-p2'];
      html += `<span class="badge ${cls}">${lbl}</span>`;
    });
  }
  if (state.mode !== 'written' && state.pkind !== 'all') html += `<span class="badge b-pw">${(KIND_LABELS[state.pkind] || ['실기'])[0]}</span>`;
  if (state.onlyLinked) html += `<span class="badge b-link">🔥 실기연계만</span>`;
  if (state.dupMode !== 'all') html += `<span class="badge b-uniq">${state.dupMode === 'dedup' ? '중복소거' : '고유1회'}</span>`;
  if (kw) html += `<span class="badge b-dup">검색: "${esc(kw)}"</span>`;
  html += `<span style="margin-left:4px; color:var(--text);">총 <strong>${state.filtered.length.toLocaleString()}문항</strong></span>`;
  el.innerHTML = html;
}

function toggleZenMode() {
  state.zenMode = !state.zenMode;
  document.body.classList.toggle('zen-mode', state.zenMode);
}
function toggleDashboard() {
  const p = document.getElementById('dashboardPanel');
  const b = document.getElementById('btnDashboard');
  p.classList.toggle('open');
  b.classList.toggle('active', p.classList.contains('open'));
}
function toggleSettings() {
  const p = document.getElementById('settingsPanel');
  const b = document.getElementById('btnSettings');
  p.classList.toggle('open');
  b.classList.toggle('active', p.classList.contains('open'));
}

function updateStyles() {
  const qf = parseFloat(document.getElementById('rngQFont').value);
  const sync = document.getElementById('chkSyncExp').checked;
  let ef = parseFloat(document.getElementById('rngExpFont').value);
  if (sync) { ef = Math.max(11.5, qf - 1.5); document.getElementById('rngExpFont').value = ef; }
  const qeg = document.getElementById('rngQExpGap').value;
  const qg = document.getElementById('rngQGap').value;
  const lh = document.getElementById('rngLineH').value;

  document.documentElement.style.setProperty('--q-font', qf + 'px');
  document.documentElement.style.setProperty('--exp-font', ef + 'px');
  document.documentElement.style.setProperty('--q-exp-gap', qeg + 'px');
  document.documentElement.style.setProperty('--q-gap', qg + 'px');
  document.documentElement.style.setProperty('--line-h', lh);

  document.getElementById('valQFont').textContent = qf + 'px';
  document.getElementById('valExpFont').textContent = ef + 'px';
  document.getElementById('valQExpGap').textContent = qeg + 'px';
  document.getElementById('valQGap').textContent = qg + 'px';
  document.getElementById('valLineH').textContent = lh;
  safeSet('elec_unified_styles_v5', JSON.stringify({ qf, ef, qeg, qg, lh, sync }));
}

function loadStyles() {
  try {
    const saved = JSON.parse(safeGet('elec_unified_styles_v5', 'null'));
    if (saved) {
      document.getElementById('rngQFont').value = saved.qf ?? 15.5;
      document.getElementById('rngExpFont').value = saved.ef ?? 14;
      document.getElementById('rngQExpGap').value = saved.qeg ?? 12;
      document.getElementById('rngQGap').value = saved.qg ?? 16;
      document.getElementById('rngLineH').value = saved.lh ?? 1.62;
      document.getElementById('chkSyncExp').checked = saved.sync ?? true;
    }
  } catch (e) {}
  updateStyles();
}

function resetStyles() {
  safeRemove('elec_unified_styles_v5');
  document.getElementById('rngQFont').value = 15.5;
  document.getElementById('rngExpFont').value = 14;
  document.getElementById('rngQExpGap').value = 12;
  document.getElementById('rngQGap').value = 16;
  document.getElementById('rngLineH').value = 1.62;
  document.getElementById('chkSyncExp').checked = true;
  updateStyles();
}

function toggleDark() {
  const isDark = document.body.classList.toggle('dark');
  safeSet('elec_dark', isDark ? '1' : '0');
  syncThemeColorMeta(isDark);
}

function setSubj(val, el) {
  state.subj = val;
  state.mockIds = null;
  state.ckFilterId = null;
  document.querySelectorAll('[data-subj]').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  state.page = 1;
  applyFilters();
}

function syncPrioButtonsUI() {
  const isAll = state.prios.size === 0;
  document.querySelectorAll('[data-prio]').forEach(b => {
    const v = b.getAttribute('data-prio');
    b.classList.toggle('active', v === 'all' ? isAll : state.prios.has(v));
  });
}

function setPrio(val) {
  if (val === 'all') {
    state.prios.clear();
  } else {
    if (state.prios.has(val)) state.prios.delete(val);
    else state.prios.add(val);
    if (state.prios.size >= W_PUBS_META.length) state.prios.clear();
  }
  state.mockIds = null;
  syncPrioButtonsUI();
  state.page = 1;
  applyFilters();
}

function setPKind(val, el) {
  state.pkind = val;
  state.mockIds = null;
  document.querySelectorAll('[data-pkind]').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  state.page = 1;
  applyFilters();
}

function setUnifiedOrder(val, el) {
  state.unifiedOrder = val;
  document.querySelectorAll('[data-uorder]').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  state.page = 1;
  applyFilters();
}

function setDupMode(val, el) {
  state.dupMode = val;
  state.mockIds = null;
  document.querySelectorAll('[data-dup]').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  state.page = 1;
  applyFilters();
}

function toggleOnlyLinked() {
  state.onlyLinked = !state.onlyLinked;
  document.getElementById('btnOnlyLinked').classList.toggle('active', state.onlyLinked);
  state.page = 1;
  applyFilters();
}

function toggleStudyMode() {
  state.studyMode = !state.studyMode;
  if (!state.studyMode) state.openPracSolIds = {};
  syncTopButtonsUI();
  renderPage();
}

function toggleAutoPracDrawer() {
  state.autoPracDrawer = !state.autoPracDrawer;
  syncTopButtonsUI();
  renderPage();
}

function syncTopButtonsUI() {
  const btnStudy = document.getElementById('btnStudyMode');
  const mobStudy = document.getElementById('mobStudyBtn');
  if (btnStudy) {
    btnStudy.textContent = state.studyMode ? '📖 해설표시: ON' : '📝 시험모드 (정답숨김)';
    btnStudy.classList.toggle('active', state.studyMode);
    btnStudy.classList.toggle('warn-active', !state.studyMode);
  }
  if (mobStudy) {
    mobStudy.textContent = state.studyMode ? '📖 해설ON' : '📝 시험모드';
    mobStudy.classList.toggle('active', state.studyMode);
  }
  const btnAuto = document.getElementById('btnAutoPrac');
  const mobAuto = document.getElementById('mobAutoPracBtn');
  if (btnAuto) {
    btnAuto.classList.toggle('prac-active', state.autoPracDrawer);
    btnAuto.textContent = state.autoPracDrawer ? '🔗 실기연계 자동펼침: ON' : '🔗 실기연계 자동펼침';
  }
  if (mobAuto) mobAuto.classList.toggle('active', state.autoPracDrawer);
}

function toggleBookmarkOnly() {
  state.bmOnly = !state.bmOnly;
  document.getElementById('btnBmOnly').classList.toggle('active', state.bmOnly);
  state.page = 1;
  applyFilters();
}

function resetAllFilters() {
  state.subj = 'all';
  state.ch = 'all';
  state.prios.clear();
  state.pkind = 'all';
  state.dupMode = 'all';
  state.onlyLinked = false;
  state.bmOnly = false;
  state.ckFilterId = null;
  state.mockIds = null;

  document.querySelectorAll('[data-subj]').forEach(b => b.classList.toggle('active', b.getAttribute('data-subj') === 'all'));
  syncPrioButtonsUI();
  document.querySelectorAll('[data-pkind]').forEach(b => b.classList.toggle('active', b.getAttribute('data-pkind') === 'all'));
  document.querySelectorAll('[data-dup]').forEach(b => b.classList.toggle('active', b.getAttribute('data-dup') === 'all'));
  document.getElementById('btnOnlyLinked')?.classList.remove('active');
  document.getElementById('btnBmOnly')?.classList.remove('active');
  document.getElementById('selChapter').value = 'all';
  document.getElementById('selSession').value = 'all';
  if (document.getElementById('selSilgiCat')) document.getElementById('selSilgiCat').value = 'all';
  document.getElementById('txtSearch').value = '';
  state.page = 1;
  applyFilters();
}

function startMockExam() {
  const pick = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
  if (state.mode === 'theory') switchMode('written');
  if (state.mode === 'practical') {
    const pool = P_QUESTIONS.filter(q => q.rep);
    const selected = pick(pool, 18);
    state.mockIds = new Set(selected.map(q => q.id));
    state.mockModeType = 'practical';
  } else {
    if (state.mode !== 'written') switchMode('written');
    const pool = W_QUESTIONS.filter(q => q.rep);
    const bySubj = { '1': [], '2': [], '3': [], '4': [], '5': [] };
    pool.forEach(q => { if (bySubj[q.s]) bySubj[q.s].push(q); });
    const selected = [
      ...pick(bySubj['1'], 20), ...pick(bySubj['2'], 20), ...pick(bySubj['3'], 20),
      ...pick(bySubj['4'], 20), ...pick(bySubj['5'], 20)
    ];
    state.mockIds = new Set(selected.map(q => q.id));
    state.mockModeType = 'written';
  }
  state.studyMode = false;
  state.openPracSolIds = {};
  userAnswers = {};
  syncTopButtonsUI();
  state.page = 1;
  applyFilters();
}

/* =========================================================================
 * FILTERING ENGINE
 * ========================================================================= */
function filterSingleQuestion(q, ses, ch, silgiCat, kw) {
  if (state.subj !== 'all' && q.s !== state.subj) return false;
  if (ch !== 'all' && String(q.ch) !== ch) return false;
  if (state.dupMode === 'dedup' && !q.rep) return false;
  if (state.dupMode === 'unique' && q.dc > 1) return false;
  if (state.bmOnly && !bookmarks.has(q.id)) return false;

  if (q._type === 'w') {
    if (state.ckFilterId && q.ck !== state.ckFilterId) return false;
    if (state.prios.size > 0 && !state.prios.has(String(q.p))) return false;
    if (state.onlyLinked && !q.tid) return false;
    if (ses !== 'all') {
      if (state.mode === 'unified') {
        const shortLbl = q.rd === 12 ? `${q.yr}년 1·2회 통합` : `${q.yr}년 ${q.rd}회`;
        if (shortLbl !== ses) return false;
      } else if (q.sses !== ses) return false;
    }
    if (kw && !q._search.includes(kw)) return false;
  } else {
    if (state.pkind !== 'all' && q.kind !== state.pkind) return false;
    if (silgiCat !== 'all' && q.cat !== silgiCat) return false;
    if (ses !== 'all' && q.ses_short !== ses && q.ses !== ses) return false;
    if (kw && !q._search.includes(kw)) return false;
  }
  return true;
}

function applyFilters() {
  if (state.mode === 'theory') return;
  const ses = document.getElementById('selSession')?.value || 'all';
  const ch = document.getElementById('selChapter')?.value || 'all';
  const silgiCat = document.getElementById('selSilgiCat')?.value || 'all';
  const kw = (document.getElementById('txtSearch')?.value || '').trim().toLowerCase();

  if (state.mockIds) {
    const src = state.mockModeType === 'practical' ? P_QUESTIONS : W_QUESTIONS;
    state.filtered = src.filter(q => state.mockIds.has(q.id));
  } else if (state.mode === 'written') {
    state.filtered = W_QUESTIONS.filter(q => filterSingleQuestion(q, ses, ch, silgiCat, kw));
  } else if (state.mode === 'practical') {
    state.filtered = P_QUESTIONS.filter(q => filterSingleQuestion(q, ses, ch, silgiCat, kw));
  } else {
    const wList = W_QUESTIONS.filter(q => filterSingleQuestion(q, ses, ch, silgiCat, kw));
    const pList = P_QUESTIONS.filter(q => filterSingleQuestion(q, ses, ch, silgiCat, kw));
    const pAllowedSet = new Set(pList.map(q => q.id));

    if (state.unifiedOrder === 'paired') {
      const combined = [];
      const usedP = new Set();
      const wWithLinks = wList.filter(w => w.tid && (TOPIC_SILGI_IDS[w.tid] || []).some(pid => pAllowedSet.has(pid)));
      const wWithoutLinks = wList.filter(w => !w.tid || !(TOPIC_SILGI_IDS[w.tid] || []).some(pid => pAllowedSet.has(pid)));

      wWithLinks.forEach(w => {
        combined.push(w);
        let added = 0;
        for (const pid of (TOPIC_SILGI_IDS[w.tid] || [])) {
          if (pAllowedSet.has(pid) && !usedP.has(pid)) {
            usedP.add(pid);
            const pq = P_BY_ID[pid];
            if (pq) { combined.push({ ...pq, _pairedWith: w.id }); added++; }
            if (added >= 2) break;
          }
        }
      });
      wWithoutLinks.forEach(w => combined.push(w));
      pList.forEach(p => { if (!usedP.has(p.id)) combined.push(p); });
      state.filtered = combined;
    } else if (state.unifiedOrder === 'interleave') {
      const combined = [];
      let wi = 0, pi = 0;
      while (wi < wList.length || pi < pList.length) {
        for (let k = 0; k < 3 && wi < wList.length; k++) combined.push(wList[wi++]);
        if (pi < pList.length) combined.push(pList[pi++]);
      }
      state.filtered = combined;
    } else {
      state.filtered = [...wList, ...pList];
    }
  }

  updateFilterSummaryChips();
  renderPage();
}

/* =========================================================================
 * INTERACTIONS (Bookmarks, Options, Prac Inputs, Self-Grading, Jump)
 * ========================================================================= */
function toggleBm(id) {
  if (bookmarks.has(id)) bookmarks.delete(id);
  else bookmarks.add(id);
  safeSet('elec_unified_bm_v5', JSON.stringify([...bookmarks]));
  renderPage();
}

function pickOption(qid, optIdx) {
  userAnswers[qid] = String(optIdx);
  renderPage();
}

function toggleEl(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.toggle('show');
    if (el.classList.contains('show')) renderMath(el);
  }
}

function togglePracSol(qid, btnId, panelId) {
  const panel = document.getElementById(panelId);
  const btn = document.getElementById(btnId);
  if (!panel) return;
  const nowOpen = !panel.classList.contains('show');
  state.openPracSolIds[qid] = nowOpen;
  panel.classList.toggle('show', nowOpen);
  if (nowOpen) renderMath(panel);
  if (btn) {
    btn.classList.toggle('warn-active', nowOpen);
    btn.textContent = nowOpen ? '정답·해설 닫기 ▴' : '정답·해설 보기 ▾';
  }
}

function onPracInput(el) {
  const key = el.getAttribute('data-ans-id');
  if (!key) return;
  pracInputs[key] = el.value;
  safeSet('elec_unified_prac_inputs_v5', JSON.stringify(pracInputs));
}

function setPracGrade(qid, val) {
  if (pracGrades[qid] === val) delete pracGrades[qid];
  else pracGrades[qid] = val;
  safeSet('elec_unified_prac_grades_v5', JSON.stringify(pracGrades));
  renderPage();
}

function openResetModal() { document.getElementById('resetModal').classList.add('open'); }
function closeResetModal() { document.getElementById('resetModal').classList.remove('open'); }
function confirmResetPracAnswers() {
  pracInputs = {};
  pracGrades = {};
  safeRemove('elec_unified_prac_inputs_v5');
  safeRemove('elec_unified_prac_grades_v5');
  closeResetModal();
  renderPage();
}

function jumpToQuestionById(qid, targetMode) {
  if (state.mode !== targetMode) switchMode(targetMode);
  resetAllFilters();
  const pageSize = parseInt(document.getElementById('selPageSize').value, 10) || 20;
  const idx = state.filtered.findIndex(q => q.id === qid);
  if (idx >= 0) {
    state.page = Math.floor(idx / pageSize) + 1;
    renderPage();
    setTimeout(() => {
      const card = document.getElementById('card_' + qid);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }
}

/* =========================================================================
 * RENDERERS (Practical Images, Sol Panel, Linked Drawers, Question Cards)
 * ========================================================================= */
function renderSilgiImages(imgs) {
  if (!imgs || !imgs.length) return '';
  return `<div class="silgi-img-gallery">${imgs.map(im => {
    const src = typeof im === 'string' ? im : im.src;
    const cap = typeof im === 'string' ? '' : (im.caption || '');
    return `<figure class="silgi-fig">
      <img src="${escAttr(src)}" alt="${escAttr(cap || '실기 도면')}" loading="lazy" decoding="async" onclick="openZoomModal('<img src=&quot;${escAttr(src)}&quot; style=&quot;max-width:100%;height:auto;&quot;>')">
      ${cap ? `<figcaption>${esc(cap)}</figcaption>` : ''}
    </figure>`;
  }).join('')}</div>`;
}

function renderPracSolPanel(pq, panelId, isOpen) {
  const hasAns = (pq.ans && pq.ans.trim()) || (pq.ai && pq.ai.length);
  const hasExp = (pq.exp && pq.exp.replace(/<[^>]+>/g, '').trim()) || (pq.ei && pq.ei.length);
  if (!hasAns && !hasExp) return '';
  let rows = '';
  if (hasAns) {
    rows += `<div class="sol-row"><span class="sol-tag ans">정답</span><div class="sol-text silgi-html">${pq.ans || ''}${renderSilgiImages(pq.ai)}</div></div>`;
  }
  if (hasExp) {
    rows += `<div class="sol-row"><span class="sol-tag exp">해설</span><div class="sol-text silgi-html">${pq.exp || ''}${renderSilgiImages(pq.ei)}</div></div>`;
  }
  return `<div class="sol-panel ${isOpen ? 'show' : ''}" id="${panelId}">${rows}</div>`;
}

function renderPracDrawerForWritten(wq) {
  if (!wq.tid) return '';
  const pids = TOPIC_SILGI_IDS[wq.tid] || [];
  const items = pids.slice(0, 5).map(pid => P_BY_ID[pid]).filter(Boolean);
  if (!items.length) return '';
  const totalSilgi = TOPIC_SILGI_TOTAL[wq.tid] || items.length;
  const isDrawerOpen = state.autoPracDrawer;

  return `<div class="prac-drawer ${isDrawerOpen ? 'show' : ''}" id="pdraw_${wq.id}">
    <div class="drawer-head">
      <strong style="font-size:13px; color:var(--prac);">⚡ 이 필기 개념과 직결되는 실기 기출 (총 ${totalSilgi}건 중 대표 ${items.length}건 미리보기)</strong>
      <span style="font-size:11.5px; color:var(--muted);">필기 공부 시 실기 서술·계산 답안까지 함께 확인하세요</span>
    </div>
    ${items.map(pq => {
      const [kl, kc] = KIND_LABELS[pq.kind] || ['실기', 'b-pw'];
      const solPanelId = `drw_sol_${wq.id}_${pq.id}`;
      const solBtnId = `drw_btn_${wq.id}_${pq.id}`;
      const isSolOpen = state.studyMode || !!state.openPracSolIds[solPanelId];
      return `<div class="prac-drawer-item">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:5px;">
          <div style="display:flex; flex-wrap:wrap; gap:5px; align-items:center;">
            <span class="badge ${kc}">${kl}</span>
            <span class="badge b-ch">${esc(pq.cat)}</span>
            ${pq.pt ? `<span class="badge badge-pt">${pq.pt}점</span>` : ''}
            <span style="font-size:12px; color:var(--muted); font-weight:700;">${esc(pq.ses)} · #${pq.n}</span>
          </div>
          <div style="display:flex; gap:5px;">
            <button type="button" class="btn ${isSolOpen ? 'warn-active' : ''}" style="padding:2px 8px; font-size:11.5px;" id="${solBtnId}" onclick="togglePracSol('${solPanelId}', '${solBtnId}', '${solPanelId}')">${isSolOpen ? '정답·해설 닫기 ▴' : '정답·해설 보기 ▾'}</button>
            <button type="button" class="btn" style="padding:2px 8px; font-size:11.5px;" onclick="jumpToQuestionById('${pq.id}', 'practical')">실기탭 이동 ↗</button>
          </div>
        </div>
        <div class="q-stem silgi-html" style="font-size:calc(var(--q-font) * 0.95); margin-bottom:6px;">${pq.q}</div>
        ${renderSilgiImages(pq.qi)}
        ${renderPracSolPanel(pq, solPanelId, isSolOpen)}
      </div>`;
    }).join('')}
  </div>`;
}

function renderWrittenDrawerForPrac(pq) {
  if (!pq.wl || !pq.wl.length) return '';
  const items = pq.wl.map(wid => W_BY_ID[wid]).filter(Boolean);
  if (!items.length) return '';
  return `<div class="w-drawer" id="wdraw_${pq.id}">
    <div class="drawer-head">
      <strong style="font-size:13px; color:var(--primary);">📘 이 실기 문제의 기초가 되는 대표 필기 기출 (${items.length}건)</strong>
    </div>
    ${items.map(wq => {
      const [pLabel, pCls] = PRIO_LABELS[wq.p] || ['필기', 'b-p1'];
      const optsText = (wq.opts || []).map((o, idx) => `${CIRCLES[idx]} ${o}`).join(' &nbsp; ');
      return `<div class="prac-drawer-item">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px; margin-bottom:4px;">
          <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
            <span class="badge ${pCls}">${pLabel}</span>
            <span class="badge b-subj">${esc(SUBJ_NAMES[wq.s] || '')}</span>
            <span style="font-size:12px; color:var(--muted); font-weight:700;">${esc(wq.sses)} · #${wq.n}</span>
          </div>
          <button type="button" class="btn" style="padding:2px 8px; font-size:11.5px;" onclick="jumpToQuestionById('${wq.id}', 'written')">필기탭 이동 ↗</button>
        </div>
        <div style="font-size:calc(var(--q-font) * 0.94); font-weight:700; margin-bottom:4px;">${wq.q}</div>
        <div style="font-size:calc(var(--q-font) * 0.88); color:var(--sub); margin-bottom:6px;">${optsText}</div>
        <div style="font-size:var(--exp-font); background:var(--card); padding:8px 10px; border-radius:6px; border-left:3px solid var(--primary);">
          <strong style="color:var(--ok);">정답: ${CIRCLES[parseInt(wq.ans, 10) - 1] || wq.ans}</strong><br>
          <span>${wq.exp || '등록된 해설이 없습니다.'}</span>
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderPage() {
  if (state.mode === 'theory') return;
  const pageSize = parseInt(document.getElementById('selPageSize').value, 10) || 20;
  const total = state.filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (state.page > totalPages) state.page = totalPages;
  if (state.page < 1) state.page = 1;

  const start = (state.page - 1) * pageSize;
  const slice = state.filtered.slice(start, start + pageSize);

  const modeTotal = state.mode === 'written'
    ? W_QUESTIONS.length
    : (state.mode === 'practical' ? P_QUESTIONS.length : W_QUESTIONS.length + P_QUESTIONS.length);

  document.getElementById('statsText').innerHTML = state.mockIds
    ? (state.mockModeType === 'practical'
        ? `<strong>🎲 실기 실전 모의고사 18문항</strong> · <button type="button" class="btn" style="padding:2px 7px;" onclick="resetAllFilters()">모의고사 종료</button>`
        : `<strong>🎲 필기 실전 모의고사 100문항</strong> (5과목 × 20문항) · <button type="button" class="btn" style="padding:2px 7px;" onclick="resetAllFilters()">모의고사 종료</button>`)
    : `검색·필터 결과: <strong>${total.toLocaleString()}문항</strong> ( 전체 ${modeTotal.toLocaleString()}문항 중 )`;

  document.getElementById('pageIndicatorTop').textContent = `${state.page} / ${totalPages} 페이지`;

  const listEl = document.getElementById('qList');
  const showAnsBox = document.getElementById('chkAnsBox')?.checked ?? true;

  if (!slice.length) {
    listEl.innerHTML = `<div class="q-card" style="text-align:center; padding:36px 16px;">
      <div style="font-size:16px; font-weight:800; margin-bottom:8px;">선택하신 필터 조건에 해당하는 문항이 없습니다.</div>
      <div style="font-size:13px; color:var(--muted); margin-bottom:14px;">검색어나 과목·단원·회차 필터를 조정하거나 아래 초기화 버튼을 눌러주세요.</div>
      <button type="button" class="btn active" onclick="resetAllFilters()">🔄 전체 필터 초기화</button>
    </div>`;
  } else {
    listEl.innerHTML = slice.map((q, i) => {
      const isBm = bookmarks.has(q.id);
      const dupBadge = q.dc > 1
        ? `<span class="badge b-dup" onclick="toggleEl('dups_${q.id}_${i}')">🔁 ${q.dc}회 수록</span>`
        : `<span class="badge b-uniq">🆕 고유 1회</span>`;

      if (q._type === 'w') {
        const [pLabel, pCls] = PRIO_LABELS[q.p] || ['기타', 'b-p1'];
        const uAns = userAnswers[q.id];
        const showExp = state.studyMode || !!uAns;
        const silgiTotal = q.tid ? (TOPIC_SILGI_TOTAL[q.tid] || 0) : 0;
        const linkBadge = silgiTotal > 0
          ? `<span class="badge b-link" onclick="toggleEl('pdraw_${q.id}')">⚡ 실기연계 ${silgiTotal}건 ▾</span>`
          : '';
        const ckBadge = q.ck
          ? `<span class="badge badge-ck" onclick="openPdfModal('theory', ${(CK_BY_ID[q.ck]?.startPage) || 1})">📖 ${esc(q.ckl || '치트키')}</span>`
          : '';
        const diagHtml = q.diag ? `<div class="q-diag-wrap" onclick="openZoomModal(this.innerHTML)">${q.diag}</div>` : '';

        const optsHtml = (q.opts || []).map((opt, idx) => {
          const num = idx + 1;
          let cls = 'opt-btn';
          if (showExp) {
            if (String(num) === String(q.ans)) cls += ' correct';
            else if (uAns && String(num) === uAns) cls += ' wrong';
          }
          return `<button type="button" class="${cls}" onclick="pickOption('${q.id}', ${num})">
            <span class="opt-num">${CIRCLES[idx] || num + '.'}</span>
            <span>${opt}</span>
          </button>`;
        }).join('');

        const dupListHtml = q.dups && q.dups.length
          ? `<div class="dup-list" id="dups_${q.id}_${i}"><strong>동일 회차 출처 비교:</strong> ${esc(q.dups.join(' · '))}</div>` : '';

        return `<article class="q-card" id="card_${q.id}">
          <div class="q-meta">
            <div class="q-badges">
              <span class="badge ${pCls}">${pLabel}</span>
              <span class="badge b-subj">${esc(SUBJ_NAMES[q.s] || '')}</span>
              ${q.chn ? `<span class="badge b-ch">${esc(q.chn)}</span>` : ''}
              <span style="color:var(--muted); font-weight:700;">${esc(q.sses)} · #${q.n}</span>
              ${dupBadge}
              ${ckBadge}
              ${linkBadge}
            </div>
            <div style="display:flex; gap:5px; align-items:center;">
              ${q.vid ? `<a href="${escAttr(q.vid)}" target="_blank" rel="noopener" class="btn" style="padding:3px 8px; font-size:11.5px; text-decoration:none;">▶ 영상</a>` : ''}
              <button type="button" class="btn" style="padding:3px 8px; font-size:11.5px;" onclick="toggleBm('${q.id}')">${isBm ? '⭐ 저장됨' : '☆ 북마크'}</button>
            </div>
          </div>
          <div class="q-stem">${start + i + 1}. ${q.q}</div>
          ${diagHtml}
          <div class="opts">${optsHtml}</div>
          <div class="exp-wrap ${showExp ? 'show' : ''}">
            <div class="exp-ans">정답: ${CIRCLES[parseInt(q.ans, 10) - 1] || q.ans}</div>
            ${q.fm ? `<div class="q-formula-box"><strong>핵심 공식:</strong> ${q.fm}</div>` : ''}
            ${q.tip ? `<div class="q-tip-box"><strong>암기/풀이 팁:</strong> ${q.tip}</div>` : ''}
            <div class="exp-body">${q.exp && q.exp.replace(/<[^>]+>/g, '').trim() ? q.exp : '등록된 해설이 없습니다.'}</div>
            ${dupListHtml}
          </div>
          ${renderPracDrawerForWritten(q)}
        </article>`;
      } else {
        const [kLabel, kCls] = KIND_LABELS[q.kind] || ['실기', 'b-pw'];
        const isPaired = !!q._pairedWith;
        const solPanelId = `psol_${q.id}_${i}`;
        const solBtnId = `pbtn_${q.id}_${i}`;
        const isSolOpen = state.studyMode || !!state.openPracSolIds[solPanelId];
        const solPanelHtml = renderPracSolPanel(q, solPanelId, isSolOpen);
        const g = pracGrades[q.id] || '';
        const ansVal = esc(pracInputs[q.id] || '');
        const ansHtml = showAnsBox
          ? `<div class="ans-zone"><textarea class="lined-textarea" rows="2" placeholder="서술형 답안 또는 계산과정을 직접 작성하세요 (자동 저장)..." data-ans-id="${q.id}" oninput="onPracInput(this)">${ansVal}</textarea></div>`
          : '';
        const wLinkBadge = (q.wl && q.wl.length)
          ? `<span class="badge b-wlink" onclick="toggleEl('wdraw_${q.id}')">📘 필기연계 ${q.wl.length}건 ▾</span>`
          : '';
        const pairedTag = isPaired
          ? `<span class="badge" style="background:#fef3c7; color:#92400e; border:1px solid #fcd34d;">🔗 위 필기문제 직결 실기</span>`
          : '';
        const dupListHtml = q.dups && q.dups.length
          ? `<div class="dup-list" id="dups_${q.id}_${i}"><strong>동일 회차 실기 출처:</strong> ${esc(q.dups.join(' · '))}</div>` : '';

        return `<article class="q-card is-prac ${isPaired ? 'is-paired-prac' : ''}" id="card_${q.id}">
          <div class="q-meta">
            <div class="q-badges">
              ${pairedTag}
              <span class="badge ${kCls}">${kLabel}</span>
              <span class="badge b-ch">${esc(q.cat)}</span>
              ${q.pt ? `<span class="badge badge-pt">${q.pt}점</span>` : ''}
              <span style="color:var(--muted); font-weight:700;">${esc(q.ses)} · #${q.n}</span>
              ${q.py ? `<span class="badge b-subj">기출: ${esc(q.py)}</span>` : ''}
              ${dupBadge}
              ${wLinkBadge}
            </div>
            <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
              <div class="sgrade-wrap" title="자가 채점">
                <button type="button" class="sgrade-btn ok ${g === 'ok' ? 'active' : ''}" onclick="setPracGrade('${q.id}', 'ok')">O</button>
                <button type="button" class="sgrade-btn mid ${g === 'mid' ? 'active' : ''}" onclick="setPracGrade('${q.id}', 'mid')">△</button>
                <button type="button" class="sgrade-btn no ${g === 'no' ? 'active' : ''}" onclick="setPracGrade('${q.id}', 'no')">X</button>
              </div>
              <button type="button" class="btn ${isSolOpen ? 'warn-active' : ''}" style="padding:3px 8px; font-size:11.5px;" id="${solBtnId}" onclick="togglePracSol('${solPanelId}', '${solBtnId}', '${solPanelId}')">${isSolOpen ? '정답·해설 닫기 ▴' : '정답·해설 보기 ▾'}</button>
              <button type="button" class="btn" style="padding:3px 8px; font-size:11.5px;" onclick="toggleBm('${q.id}')">${isBm ? '⭐ 저장됨' : '☆ 북마크'}</button>
            </div>
          </div>
          <div class="q-stem silgi-html">${start + i + 1}. ${q.q}</div>
          ${renderSilgiImages(q.qi)}
          ${ansHtml}
          ${dupListHtml}
          ${solPanelHtml}
          ${renderWrittenDrawerForPrac(q)}
        </article>`;
      }
    }).join('');
  }

  renderPager('pagerTop', totalPages);
  renderPager('pagerBottom', totalPages);
  syncMobileBottomBar(totalPages);
  renderMath(listEl);
}

function renderPager(elId, totalPages) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button type="button" class="btn" ${state.page <= 1 ? 'disabled' : ''} onclick="goPage(1)">« 처음</button>
    <button type="button" class="btn" ${state.page <= 1 ? 'disabled' : ''} onclick="goPage(${state.page - 1})">‹ 이전</button>
    <span style="font-size:13px; font-weight:800; padding:0 6px;">${state.page} / ${totalPages} 페이지</span>
    <button type="button" class="btn" ${state.page >= totalPages ? 'disabled' : ''} onclick="goPage(${state.page + 1})">다음 ›</button>
    <button type="button" class="btn" ${state.page >= totalPages ? 'disabled' : ''} onclick="goPage(${totalPages})">끝 »</button>
  `;
}

function syncMobileBottomBar(totalPages) {
  const prevBtn = document.getElementById('mobPrevBtn');
  const nextBtn = document.getElementById('mobNextBtn');
  const sel = document.getElementById('mobPageSel');
  if (prevBtn) prevBtn.disabled = state.page <= 1;
  if (nextBtn) nextBtn.disabled = state.page >= totalPages;
  if (sel) {
    let opts = '';
    const maxOpts = Math.min(totalPages, 300);
    for (let p = 1; p <= maxOpts; p++) {
      opts += `<option value="${p}" ${p === state.page ? 'selected' : ''}>${p} / ${totalPages}쪽</option>`;
    }
    sel.innerHTML = opts;
  }
}

function goPage(p) {
  const pageSize = parseInt(document.getElementById('selPageSize').value, 10) || 20;
  const totalPages = Math.max(1, Math.ceil(state.filtered.length / pageSize));
  if (p < 1 || p > totalPages) return;
  state.page = p;
  renderPage();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =========================================================================
 * PWA BOOTSTRAP
 * ========================================================================= */
let deferredInstallPrompt = null;
function setupPwaInstall() {
  const btn = document.getElementById('btnPwaInstall');
  if (!btn) return;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    btn.classList.add('visible');
  });
  btn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch (_) {}
    deferredInstallPrompt = null;
    btn.classList.remove('visible');
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    btn.classList.remove('visible');
  });
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      let swRefreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (swRefreshing) return;
        swRefreshing = true;
        window.location.reload();
      });
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch((err) => {
        console.warn('SW registration failed:', err);
      });
    });
  }
}

async function bootstrap() {
  const loader = document.getElementById('pwaLoader');
  const loaderSub = document.getElementById('pwaLoaderSub');
  try {
    const [metaRes, w1Res, w2Res, pRes, tRes] = await Promise.all([
      fetch('./data/meta.json'),
      fetch('./data/written_1.json'),
      fetch('./data/written_2.json'),
      fetch('./data/practical.json'),
      fetch('./data/theory_map.json')
    ]);
    if (!metaRes.ok || !w1Res.ok || !w2Res.ok || !pRes.ok) {
      throw new Error('데이터 파일을 불러오지 못했습니다.');
    }
    const [meta, w1, w2, pData, tData] = await Promise.all([
      metaRes.json(),
      w1Res.json(),
      w2Res.json(),
      pRes.json(),
      tRes.ok ? tRes.json() : Promise.resolve(null)
    ]);

    CHAPTERS_META = meta.chapters || [];
    SILGI_CATS = meta.silgiCategories || [];
    W_PUBS_META = meta.wPubs || [];
    TOPIC_SILGI_IDS = meta.topicSilgiIds || {};
    TOPIC_SILGI_TOTAL = meta.topicSilgiTotal || {};
    THEORY_MAP = tData;
    W_QUESTIONS = [...(w1 || []), ...(w2 || [])];
    P_QUESTIONS = pData || [];

    CHAPTERS_META.forEach(c => { CHAPTER_MAP[c.id] = c.title; });
    if (THEORY_MAP && THEORY_MAP.parts) {
      THEORY_MAP.parts.forEach(part => {
        (part.chapters || []).forEach(ch => {
          (ch.cheatkeys || []).forEach(ck => { CK_BY_ID[ck.id] = ck; });
        });
      });
    }

    totalLinkedW = 0;
    W_QUESTIONS.forEach(wq => {
      wq._type = 'w';
      wq.chn = wq.ch ? (CHAPTER_MAP[wq.ch] || '') : '';
      wq._search = (wq.q + ' ' + (wq.opts || []).join(' ') + ' ' + (wq.exp || '') + ' ' + wq.chn + ' ' + wq.sses).toLowerCase();
      W_BY_ID[wq.id] = wq;
      if (wq.tid) totalLinkedW++;
    });

    P_QUESTIONS.forEach(pq => {
      pq._type = 'p';
      pq.chn = pq.ch ? (CHAPTER_MAP[pq.ch] || '') : '';
      pq._search = (pq.q + ' ' + (pq.ans || '') + ' ' + (pq.exp || '') + ' ' + pq.cat + ' ' + pq.chn + ' ' + pq.ses).toLowerCase();
      P_BY_ID[pq.id] = pq;
    });

    init();
    if (loader) loader.classList.add('hidden');
  } catch (err) {
    console.error(err);
    if (loaderSub) {
      loaderSub.innerHTML = '데이터 로드에 실패했습니다. Cloudflare Pages 또는 웹 서버에서 열어주세요.<br><small>' + String(err.message || err) + '</small>';
    }
  }
}

setupPwaInstall();
registerServiceWorker();
bootstrap();
