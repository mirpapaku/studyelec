// =========================================================================
// SILGI (실기 기출) MODULE + SHORT-ANSWER PDF (IndexedDB) + PILGI<->SILGI LINKAGE
// Integrated with 전기기사 통합 CBT PWA v4.0.0
// =========================================================================

const SILGI_STORAGE_KEY = 'electric_cbt_silgi_state_v1';
const SILGI_PDF_DB = 'electric_cbt_silgi_pdf_db';
const SILGI_PDF_STORE = 'pdfs';
const SILGI_PDF_KEY = 'silgi_short_answer_pdf';

const SILGI_DEFAULT_PRIORITY = ['다산에듀', '한솔아카데미', '서울공과학원', '테스트나라'];

const silgiState = {
  index: null,
  linkMap: null,
  loadedSessions: {},
  grades: {},             // qid -> 'ok' | 'mid' | 'no'
  bookmarks: {},          // qid -> true
  subMode: 'round',       // 'round' | 'category'
  enabledSources: new Set(),
  dedupEnabled: false,
  prioritySource: '다산에듀',
  yearFilter: 'all',
  statusFilter: 'all',    // 'all' | 'duplicate' | 'graded' | 'bookmark'
  search: '',
  selectedCategory: null,

  // Active silgi exam context
  examMode: 'round',      // 'round' | 'category_set'
  examTitle: '',
  examSourceLabel: '',
  currentSetId: null,
  activeQuestions: [],    // each item has _meta
  viewMode: 'single',     // 'single' | 'batch'
  showAnswerExp: true,
  manualExpOpen: new Set(),
  currentIdx: 0,
  batchPage: 0,
  penColor: '#0f172a',

  // Short-answer PDF (IndexedDB + PDF.js)
  pdfMeta: null,
  pdfDoc: null,
  pdfPage: 1,
  pdfZoom: 1.0,
  pdfRenderToken: 0,

  // Preview modal state
  previewTopicId: null,
  previewSilgiIds: [],
  previewIdx: 0,
  previewShowAns: false
};

window.SILGI_STATE = silgiState;

function loadSilgiState() {
  try {
    const raw = JSON.parse(localStorage.getItem(SILGI_STORAGE_KEY) || '{}');
    silgiState.grades = raw.grades || {};
    silgiState.bookmarks = raw.bookmarks || {};
    if (typeof raw.dedupEnabled === 'boolean') silgiState.dedupEnabled = raw.dedupEnabled;
    if (raw.prioritySource) silgiState.prioritySource = raw.prioritySource;
    if (Array.isArray(raw.enabledSources) && raw.enabledSources.length > 0) {
      silgiState.enabledSources = new Set(raw.enabledSources);
    }
    if (typeof raw.showAnswerExp === 'boolean') silgiState.showAnswerExp = raw.showAnswerExp;
    if (typeof raw.pdfPage === 'number' && raw.pdfPage >= 1) silgiState.pdfPage = raw.pdfPage;
    if (typeof raw.pdfZoom === 'number') silgiState.pdfZoom = raw.pdfZoom;
  } catch (e) {}
}

function saveSilgiState() {
  try {
    localStorage.setItem(SILGI_STORAGE_KEY, JSON.stringify({
      grades: silgiState.grades,
      bookmarks: silgiState.bookmarks,
      dedupEnabled: silgiState.dedupEnabled,
      prioritySource: silgiState.prioritySource,
      enabledSources: Array.from(silgiState.enabledSources),
      showAnswerExp: silgiState.showAnswerExp,
      pdfPage: silgiState.pdfPage,
      pdfZoom: silgiState.pdfZoom
    }));
  } catch (e) {}
}

// =========================================================================
// SILGI SHORT-ANSWER PDF STORE (IndexedDB, isolated from Theory PDF)
// =========================================================================
const SilgiPdfStore = {
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(SILGI_PDF_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SILGI_PDF_STORE)) {
          db.createObjectStore(SILGI_PDF_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async save(file) {
    const buffer = await file.arrayBuffer();
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SILGI_PDF_STORE, 'readwrite');
      tx.objectStore(SILGI_PDF_STORE).put({
        name: file.name,
        size: file.size,
        buffer,
        savedAt: Date.now()
      }, SILGI_PDF_KEY);
      tx.oncomplete = () => resolve({ name: file.name, size: file.size, buffer });
      tx.onerror = () => reject(tx.error);
    });
  },
  async get() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SILGI_PDF_STORE, 'readonly');
      const req = tx.objectStore(SILGI_PDF_STORE).get(SILGI_PDF_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async clear() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SILGI_PDF_STORE, 'readwrite');
      tx.objectStore(SILGI_PDF_STORE).delete(SILGI_PDF_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
};

function ensureSilgiPdfWorker() {
  if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
    return true;
  }
  return false;
}

async function loadSilgiPdfFromRecord(record) {
  if (!record || !record.buffer) return false;
  if (!ensureSilgiPdfWorker()) {
    showToast('PDF 엔진(PDF.js)을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
    return false;
  }
  try {
    const bytes = new Uint8Array(record.buffer.slice(0));
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    silgiState.pdfDoc = doc;
    silgiState.pdfMeta = { name: record.name, size: record.size, numPages: doc.numPages };
    if (silgiState.pdfPage > doc.numPages) silgiState.pdfPage = 1;
    updateSilgiPdfStatusUI();
    return true;
  } catch (err) {
    console.error('Silgi PDF load error:', err);
    showToast('실기 단답 PDF를 열지 못했습니다. 올바른 PDF인지 확인해 주세요.');
    return false;
  }
}

function updateSilgiPdfStatusUI() {
  const badge = document.getElementById('silgiPdfBadge');
  const status = document.getElementById('silgiPdfStatus');
  const btnOpen = document.getElementById('btnOpenSilgiPdf');
  const btnRemove = document.getElementById('btnRemoveSilgiPdf');
  const btnExamPdf = document.getElementById('btnSilgiExamPdf');
  if (!badge || !status) return;

  if (silgiState.pdfDoc && silgiState.pdfMeta) {
    const mb = (silgiState.pdfMeta.size / (1024 * 1024)).toFixed(1);
    badge.className = 'badge badge-teal';
    badge.textContent = '단답 PDF 연결됨';
    status.textContent = `${silgiState.pdfMeta.name} (${silgiState.pdfMeta.numPages}쪽 · ${mb}MB)`;
    btnOpen?.classList.remove('hidden');
    btnRemove?.classList.remove('hidden');
    if (btnExamPdf) btnExamPdf.textContent = '단답 PDF 보기';
  } else {
    badge.className = 'badge badge-amber';
    badge.textContent = '단답 PDF 준비 공간';
    status.textContent = '실기 단답·요약 PDF가 생기면 기기에 1회 연결해 언제든 바로 펼쳐볼 수 있습니다';
    btnOpen?.classList.add('hidden');
    btnRemove?.classList.add('hidden');
    if (btnExamPdf) btnExamPdf.textContent = '단답 PDF 연결';
  }
}

async function handleSilgiPdfSelected(file) {
  if (!file) return;
  showToast('실기 단답 PDF를 기기 로컬 저장소에 저장하는 중...');
  try {
    const rec = await SilgiPdfStore.save(file);
    silgiState.pdfPage = 1;
    saveSilgiState();
    const ok = await loadSilgiPdfFromRecord(rec);
    if (ok) {
      showToast('실기 단답 PDF가 연결되었습니다!');
      openSilgiPdfViewer();
    }
  } catch (err) {
    console.error(err);
    showToast('PDF 저장 중 오류가 발생했습니다.');
  }
}

async function renderSilgiPdfPage() {
  const wrap = document.getElementById('silgiPdfCanvasWrap');
  const info = document.getElementById('silgiPdfPageLbl');
  const inputPg = document.getElementById('silgiPdfPageInput');
  const zoomLbl = document.getElementById('silgiPdfZoomLbl');
  if (!wrap || !silgiState.pdfDoc) return;

  const token = ++silgiState.pdfRenderToken;
  const total = silgiState.pdfDoc.numPages;
  silgiState.pdfPage = Math.max(1, Math.min(total, silgiState.pdfPage));
  saveSilgiState();

  if (info) info.textContent = `/ ${total}쪽`;
  if (inputPg) inputPg.value = String(silgiState.pdfPage);
  if (zoomLbl) zoomLbl.textContent = `${Math.round(silgiState.pdfZoom * 100)}%`;
  const btnPrev = document.getElementById('btnSilgiPdfPrev');
  const btnNext = document.getElementById('btnSilgiPdfNext');
  if (btnPrev) btnPrev.disabled = silgiState.pdfPage <= 1;
  if (btnNext) btnNext.disabled = silgiState.pdfPage >= total;

  wrap.innerHTML = '<div class="sc-sub" style="padding:24px;">페이지 렌더링 중...</div>';
  try {
    const page = await silgiState.pdfDoc.getPage(silgiState.pdfPage);
    if (token !== silgiState.pdfRenderToken) return;
    const baseVp = page.getViewport({ scale: 1.0 });
    const availW = Math.max(280, Math.min(820, wrap.clientWidth - 20));
    const scale = (availW / baseVp.width) * silgiState.pdfZoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = page.getViewport({ scale: scale * dpr });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = `${Math.floor(vp.width / dpr)}px`;
    canvas.style.height = `${Math.floor(vp.height / dpr)}px`;
    canvas.className = 'silgi-pdf-canvas';

    wrap.innerHTML = '';
    wrap.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  } catch (err) {
    console.error(err);
    wrap.innerHTML = '<div class="sc-sub" style="padding:20px;">페이지를 표시하지 못했습니다.</div>';
  }
}

function openSilgiPdfViewer() {
  const modal = document.getElementById('modalSilgiPdf');
  if (!modal) return;
  modal.classList.remove('hidden');
  if (silgiState.pdfDoc) {
    document.getElementById('silgiPdfModalTitle').textContent = silgiState.pdfMeta?.name || '실기 단답 PDF';
    document.getElementById('silgiPdfControls').classList.remove('hidden');
    document.getElementById('silgiPdfEmptyState').classList.add('hidden');
    renderSilgiPdfPage();
  } else {
    document.getElementById('silgiPdfModalTitle').textContent = '실기 단답·요약 PDF 뷰어';
    document.getElementById('silgiPdfControls').classList.add('hidden');
    document.getElementById('silgiPdfEmptyState').classList.remove('hidden');
    document.getElementById('silgiPdfCanvasWrap').innerHTML = '';
  }
}

// =========================================================================
// DATA LOADING & HELPERS
// =========================================================================
async function fetchSilgiSession(setId) {
  if (silgiState.loadedSessions[setId]) return silgiState.loadedSessions[setId];
  const meta = silgiState.index?.sessions?.find(s => s.setId === setId);
  if (!meta) throw new Error('실기 회차 정보를 찾을 수 없습니다.');
  const res = await fetch('./' + meta.file);
  if (!res.ok) throw new Error('실기 회차 데이터를 불러올 수 없습니다.');
  const data = await res.json();
  silgiState.loadedSessions[setId] = data;
  return data;
}

function getSilgiSourceRank(sourceName) {
  if (sourceName === silgiState.prioritySource) return -1;
  const idx = SILGI_DEFAULT_PRIORITY.indexOf(sourceName);
  return idx === -1 ? 99 : idx;
}

function formatSilgiRoundTitle(s) {
  return `${s.year}년 ${s.round}회 실기`;
}

function getSilgiSessionProgress(setId) {
  const meta = silgiState.index?.sessions?.find(s => s.setId === setId);
  if (!meta) return 0;
  // Question ids follow "<pub>_<year>_<round>_<num>"
  const prefix = `${meta.sourceSlug}_${meta.year}_${meta.round}_`;
  let cnt = 0;
  for (const k of Object.keys(silgiState.grades)) {
    if (k.startsWith(prefix)) cnt++;
  }
  return cnt;
}

function getSilgiSessionBookmarkCount(setId) {
  const meta = silgiState.index?.sessions?.find(s => s.setId === setId);
  if (!meta) return 0;
  const prefix = `${meta.sourceSlug}_${meta.year}_${meta.round}_`;
  let cnt = 0;
  for (const k of Object.keys(silgiState.bookmarks)) {
    if (k.startsWith(prefix)) cnt++;
  }
  return cnt;
}

function getFilteredSilgiSessions(applyStatusFilter = true) {
  const all = silgiState.index?.sessions || [];
  let list = all.filter(s => {
    if (!silgiState.enabledSources.has(s.source)) return false;
    if (silgiState.yearFilter !== 'all' && String(s.year) !== silgiState.yearFilter) return false;
    if (silgiState.search.trim()) {
      const q = silgiState.search.trim().toLowerCase();
      const hay = `${s.year} ${s.round}회 ${s.roundLabel} ${s.source}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (silgiState.dedupEnabled) {
    const best = new Map();
    for (const s of list) {
      const prev = best.get(s.duplicateGroup);
      if (!prev || getSilgiSourceRank(s.source) < getSilgiSourceRank(prev.source)) {
        best.set(s.duplicateGroup, s);
      }
    }
    list = Array.from(best.values()).sort(
      (a, b) => (b.year - a.year) || (b.round - a.round) || a.source.localeCompare(b.source, 'ko')
    );
  }

  if (!applyStatusFilter) return list;

  const dupCounts = {};
  list.forEach(s => { dupCounts[s.duplicateGroup] = (dupCounts[s.duplicateGroup] || 0) + 1; });

  return list.filter(s => {
    if (silgiState.statusFilter === 'duplicate' && dupCounts[s.duplicateGroup] < 2) return false;
    if (silgiState.statusFilter === 'graded' && getSilgiSessionProgress(s.setId) === 0) return false;
    if (silgiState.statusFilter === 'bookmark' && getSilgiSessionBookmarkCount(s.setId) === 0) return false;
    return true;
  });
}

// =========================================================================
// SILGI HOME RENDERING
// =========================================================================
function renderSilgiPublisherChips() {
  const wrap = document.getElementById('silgiPublisherChips');
  if (!wrap || !silgiState.index) return;
  wrap.innerHTML = (silgiState.index.sources || []).map(src => `
    <button type="button" data-spub="${src}" class="pub-chip ${silgiState.enabledSources.has(src) ? 'active' : ''}">${src}</button>
  `).join('');
  wrap.querySelectorAll('[data-spub]').forEach(btn => {
    btn.addEventListener('click', () => {
      const src = btn.getAttribute('data-spub');
      if (silgiState.enabledSources.has(src)) silgiState.enabledSources.delete(src);
      else silgiState.enabledSources.add(src);
      saveSilgiState();
      renderSilgiPublisherChips();
      renderSilgiHome();
    });
  });
}

window.renderSilgiHome = function renderSilgiHome() {
  if (!silgiState.index) return;
  updateSilgiPdfStatusUI();

  const baseSessions = getFilteredSilgiSessions(false);
  const displaySessions = getFilteredSilgiSessions(true);

  const dupCounts = {};
  baseSessions.forEach(s => { dupCounts[s.duplicateGroup] = (dupCounts[s.duplicateGroup] || 0) + 1; });
  const dupGroupTotal = Object.values(dupCounts).filter(c => c > 1).length;
  const totalQ = baseSessions.reduce((acc, s) => acc + (s.questionCount || 0), 0);
  const gradedCount = Object.keys(silgiState.grades).length;

  const elS = document.getElementById('silgiStatSessions');
  const elQ = document.getElementById('silgiStatQuestions');
  const elD = document.getElementById('silgiStatDupGroups');
  const elG = document.getElementById('silgiStatGraded');
  if (elS) elS.textContent = `${baseSessions.length}개`;
  if (elQ) elQ.textContent = `${totalQ.toLocaleString()}문항`;
  if (elD) elD.textContent = `${dupGroupTotal}그룹`;
  if (elG) elG.textContent = `${gradedCount.toLocaleString()}문항`;

  document.getElementById('silgiPriorityWrap')?.classList.toggle('hidden', !silgiState.dedupEnabled);
  document.getElementById('silgiStatusChipsRow')?.classList.toggle('hidden', silgiState.subMode !== 'round');
  document.getElementById('silgiRoundWrap')?.classList.toggle('hidden', silgiState.subMode !== 'round');
  document.getElementById('silgiCategoryWrap')?.classList.toggle('hidden', silgiState.subMode !== 'category');

  document.getElementById('btnSilgiSubRound')?.classList.toggle('active', silgiState.subMode === 'round');
  document.getElementById('btnSilgiSubCat')?.classList.toggle('active', silgiState.subMode === 'category');

  if (silgiState.subMode === 'round') {
    renderSilgiSessionGrid(displaySessions, dupCounts);
  } else {
    renderSilgiCategoryMode(baseSessions);
  }
};

function renderSilgiSessionGrid(list, dupCounts) {
  const grid = document.getElementById('silgiSessionGrid');
  if (!grid) return;
  if (list.length === 0) {
    grid.innerHTML = `<div class="card" style="grid-column:1/-1;text-align:center;color:#64748b;">조건에 맞는 실기 회차가 없습니다. 출판사 선택이나 필터를 확인해 주세요.</div>`;
    return;
  }

  grid.innerHTML = list.map(s => {
    const dupCnt = dupCounts[s.duplicateGroup] || 1;
    const graded = getSilgiSessionProgress(s.setId);
    const expPct = s.questionCount ? Math.round((s.explanationCount / s.questionCount) * 100) : 0;
    return `
      <article class="card session-card">
        <div>
          <div class="sc-top">
            <div>
              <h3 class="sc-title">${formatSilgiRoundTitle(s)}</h3>
              <p class="sc-sub">${s.roundLabel || ''}${s.passRate ? ` · 합격률 ${s.passRate}%` : ''}</p>
            </div>
            <span class="badge badge-teal">${s.source}</span>
          </div>
          <div class="sc-badges" style="margin-top:8px;">
            ${dupCnt > 1 ? `<span class="badge badge-indigo">중복 ${dupCnt}종 · 교차 검증</span>` : ''}
            ${expPct >= 50 ? `<span class="badge badge-slate">해설 ${s.explanationCount}/${s.questionCount}</span>` : `<span class="badge badge-amber">정답 중심 (교차해설 권장)</span>`}
          </div>
        </div>
        <div class="sc-foot">
          <span>${s.questionCount}문항 · 채점 ${graded}/${s.questionCount}</span>
          <button type="button" data-open-silgi="${s.setId}" class="btn btn-dark btn-sm">풀기 →</button>
        </div>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('[data-open-silgi]').forEach(btn => {
    btn.addEventListener('click', () => openSilgiRoundSession(btn.getAttribute('data-open-silgi')));
  });
}

function renderSilgiCategoryMode(baseSessions) {
  const grid = document.getElementById('silgiCategoryGrid');
  const setsPanel = document.getElementById('silgiCategorySetsPanel');
  if (!grid) return;

  const categories = silgiState.index?.categories || [];
  grid.innerHTML = categories.map(cat => {
    const matching = baseSessions.filter(s => (s.categoryCounts?.[cat] || 0) > 0);
    const totalQ = matching.reduce((acc, s) => acc + (s.categoryCounts?.[cat] || 0), 0);
    const isSel = silgiState.selectedCategory === cat;
    return `
      <button type="button" data-scat="${cat}" class="subj-card ${isSel ? 'selected' : ''}">
        <h3>${cat}</h3>
        <div class="subj-card-meta">${totalQ.toLocaleString()}문항 · ${matching.length}개 회차 포함</div>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('[data-scat]').forEach(btn => {
    btn.addEventListener('click', () => {
      silgiState.selectedCategory = btn.getAttribute('data-scat');
      renderSilgiCategoryMode(baseSessions);
    });
  });

  if (!silgiState.selectedCategory) {
    setsPanel?.classList.add('hidden');
    return;
  }

  const cat = silgiState.selectedCategory;
  const matching = baseSessions.filter(s => (s.categoryCounts?.[cat] || 0) > 0);
  const totalQ = matching.reduce((acc, s) => acc + (s.categoryCounts?.[cat] || 0), 0);

  setsPanel?.classList.remove('hidden');
  document.getElementById('selectedSilgiCatTitle').textContent = `${cat} — 집중 학습 세트`;
  document.getElementById('selectedSilgiCatMeta').textContent = `현재 필터 기준 ${totalQ.toLocaleString()}문항 (${matching.length}개 회차)`;

  const setsGrid = document.getElementById('silgiCategorySetsGrid');
  const setSize = 15;
  const numSets = Math.ceil(totalQ / setSize);
  if (numSets === 0) {
    setsGrid.innerHTML = `<div class="sc-sub">선택된 조건에 문항이 없습니다.</div>`;
    return;
  }

  setsGrid.innerHTML = Array.from({ length: numSets }, (_, i) => {
    const start = i * setSize + 1;
    const end = Math.min((i + 1) * setSize, totalQ);
    return `
      <button type="button" data-scslice="${i}" class="set-btn">
        <strong>세트 ${i + 1}</strong>
        <span>${start}~${end}번 (${end - start + 1}문항)</span>
      </button>
    `;
  }).join('');

  setsGrid.querySelectorAll('[data-scslice]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-scslice'));
      openSilgiCategorySlice(cat, matching, idx * setSize, setSize, `${cat} 세트 ${idx + 1}`);
    });
  });

  const btnRand = document.getElementById('btnSilgiRandom15');
  if (btnRand) {
    btnRand.onclick = () => openSilgiRandomCategory(cat, matching, 15);
  }
}

async function openSilgiCategorySlice(cat, matchingSessions, offset, limit, title) {
  showToast('단원별 실기 문항을 불러오는 중...');
  const collected = [];
  let skipped = 0;
  for (const sm of matchingSessions) {
    const cnt = sm.categoryCounts?.[cat] || 0;
    if (skipped + cnt <= offset) {
      skipped += cnt;
      continue;
    }
    const data = await fetchSilgiSession(sm.setId);
    const filtered = data.questions.filter(q => q.category === cat);
    for (const q of filtered) {
      if (skipped < offset) { skipped++; continue; }
      collected.push({ ...q, _meta: sm });
      if (collected.length >= limit) break;
    }
    if (collected.length >= limit) break;
  }
  launchSilgiExam('category_set', title, `${cat} · ${collected.length}문항`, null, collected);
}

async function openSilgiRandomCategory(cat, matchingSessions, count = 15) {
  showToast('랜덤 실기 모의세트를 구성하는 중...');
  const sampleSessions = [...matchingSessions].sort(() => Math.random() - 0.5).slice(0, 18);
  const loaded = await Promise.all(sampleSessions.map(s => fetchSilgiSession(s.setId).catch(() => null)));
  const pool = [];
  const seenKey = new Set();
  loaded.forEach((data, i) => {
    if (!data) return;
    const sm = sampleSessions[i];
    data.questions.filter(q => q.category === cat).forEach(q => {
      const key = `${sm.duplicateGroup}_${q.number}`;
      if (!seenKey.has(key)) {
        seenKey.add(key);
        pool.push({ ...q, _meta: sm });
      }
    });
  });
  pool.sort(() => Math.random() - 0.5);
  const picked = pool.slice(0, count);
  launchSilgiExam('category_set', `${cat} 랜덤 ${picked.length}문항`, '중복 회차 자동 제거', null, picked);
}

async function openSilgiRoundSession(setId, jumpQid = null) {
  showToast('실기 회차 데이터를 불러오는 중...');
  try {
    const meta = silgiState.index.sessions.find(s => s.setId === setId);
    const data = await fetchSilgiSession(setId);
    const qs = data.questions.map(q => ({ ...q, _meta: meta }));
    let startIdx = 0;
    if (jumpQid) {
      const found = qs.findIndex(q => q.id === jumpQid);
      if (found >= 0) startIdx = found;
    }
    launchSilgiExam('round', formatSilgiRoundTitle(meta), meta.source, setId, qs, startIdx);
  } catch (err) {
    showToast(err.message || '실기 회차를 불러오지 못했습니다.');
  }
}
window.openSilgiRoundSession = openSilgiRoundSession;

function launchSilgiExam(mode, title, sourceLabel, setId, questions, startIdx = 0) {
  silgiState.examMode = mode;
  silgiState.examTitle = title;
  silgiState.examSourceLabel = sourceLabel;
  silgiState.currentSetId = setId;
  silgiState.activeQuestions = questions;
  silgiState.currentIdx = startIdx;
  silgiState.batchPage = Math.floor(startIdx / 10);
  silgiState.manualExpOpen.clear();

  document.getElementById('viewHome').classList.add('hidden');
  document.getElementById('viewExam').classList.add('hidden');
  document.getElementById('viewTheoryDetail')?.classList.add('hidden');
  document.getElementById('mobileNav').classList.add('hidden');
  document.getElementById('viewSilgiExam').classList.remove('hidden');

  document.getElementById('silgiExamTitle').textContent = title;
  document.getElementById('silgiExamSource').textContent = sourceLabel;
  document.getElementById('chkSilgiShowAnswerExp').checked = silgiState.showAnswerExp;

  renderSilgiExam();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =========================================================================
// SILGI EXAM VIEW RENDERING
// =========================================================================
function renderSilgiImagesHtml(imgs) {
  if (!imgs || imgs.length === 0) return '';
  return `<div class="silgi-img-gallery">${imgs.map(im => {
    const src = typeof im === 'string' ? im : im.src;
    const cap = typeof im === 'string' ? '' : (im.caption || '');
    return `
      <figure class="silgi-fig">
        <img src="${src}" alt="${cap || '실기 도면'}" loading="lazy" class="silgi-zoomable-img" />
        ${cap ? `<figcaption>${cap}</figcaption>` : ''}
      </figure>
    `;
  }).join('')}</div>`;
}

function getLinkedTopicForSilgi(sqId) {
  if (!silgiState.linkMap) return null;
  const tid = silgiState.linkMap.silgiToTopic?.[sqId];
  return tid ? silgiState.linkMap.topics?.[tid] : null;
}

function renderSilgiExam() {
  const qs = silgiState.activeQuestions;
  if (!qs || qs.length === 0) return;

  const isSingle = silgiState.viewMode === 'single';
  document.getElementById('btnSilgiViewSingle').classList.toggle('active', isSingle);
  document.getElementById('btnSilgiViewBatch').classList.toggle('active', !isSingle);
  document.getElementById('silgiSingleWrap').classList.toggle('hidden', !isSingle);
  document.getElementById('silgiBatchWrap').classList.toggle('hidden', isSingle);

  if (isSingle) renderSilgiSingle(qs);
  else renderSilgiBatch(qs);
}

function renderSilgiSingle(qs) {
  if (silgiState.currentIdx >= qs.length) silgiState.currentIdx = 0;
  const q = qs[silgiState.currentIdx];
  const meta = q._meta;
  const grade = silgiState.grades[q.id] || '';
  const reveal = silgiState.showAnswerExp || silgiState.manualExpOpen.has(q.id);

  const siblings = silgiState.index.sessions.filter(s => s.duplicateGroup === meta.duplicateGroup);
  const btnCross = document.getElementById('btnSilgiCrossCheck');
  if (siblings.length > 1) {
    btnCross.classList.remove('hidden');
    btnCross.textContent = `교차 비교 (${siblings.length}종)`;
  } else {
    btnCross.classList.add('hidden');
  }

  document.getElementById('sqNum').textContent = silgiState.examMode === 'category_set'
    ? `${silgiState.currentIdx + 1}번 (원본 ${q.number}번)`
    : `${q.number}번`;

  const ptEl = document.getElementById('sqPoints');
  if (q.points) { ptEl.textContent = `${q.points}점`; ptEl.classList.remove('hidden'); }
  else ptEl.classList.add('hidden');

  const origEl = document.getElementById('sqOriginTag');
  if (silgiState.examMode === 'category_set') {
    origEl.textContent = `${formatSilgiRoundTitle(meta)} · ${meta.source}`;
    origEl.classList.remove('hidden');
  } else {
    origEl.classList.add('hidden');
  }

  document.getElementById('sqCat').textContent = q.category + (q.rawCategory && q.rawCategory !== q.category ? ` · ${q.rawCategory}` : '');
  const pastEl = document.getElementById('sqPastYears');
  if (q.pastYears) { pastEl.textContent = `기출: ${q.pastYears}`; pastEl.classList.remove('hidden'); }
  else pastEl.classList.add('hidden');

  // Reverse link: Silgi -> Pilgi Cheatkey
  const topic = getLinkedTopicForSilgi(q.id);
  const ckBtn = document.getElementById('sqCheatkeyBtn');
  if (ckBtn && topic && topic.cheatkeyIds && topic.cheatkeyIds.length > 0 && typeof window.openTheoryDetail === 'function') {
    ckBtn.textContent = `📖 연계 필기 치트키 (${topic.name})`;
    ckBtn.classList.remove('hidden');
    ckBtn.onclick = () => {
      document.getElementById('viewSilgiExam').classList.add('hidden');
      window.openTheoryDetail(topic.cheatkeyIds[0]);
    };
  } else if (ckBtn) {
    ckBtn.classList.add('hidden');
  }

  const btnOne = document.getElementById('btnSilgiToggleOneExp');
  if (!silgiState.showAnswerExp) {
    btnOne.classList.remove('hidden');
    btnOne.textContent = silgiState.manualExpOpen.has(q.id) ? '정답·해설 숨기기' : '정답·해설 보기';
    btnOne.onclick = () => {
      if (silgiState.manualExpOpen.has(q.id)) silgiState.manualExpOpen.delete(q.id);
      else silgiState.manualExpOpen.add(q.id);
      renderSilgiSingle(qs);
    };
  } else {
    btnOne.classList.add('hidden');
  }

  document.getElementById('btnSilgiBookmark').textContent = silgiState.bookmarks[q.id] ? '★ 북마크됨' : '☆ 북마크';
  document.getElementById('sqStem').innerHTML = q.questionHtml || '';
  document.getElementById('sqDiagWrap').innerHTML = renderSilgiImagesHtml(q.questionImages);
  document.getElementById('sqDiagWrap').classList.toggle('hidden', !q.questionImages || q.questionImages.length === 0);

  // Self-grading buttons (O / △ / X)
  document.querySelectorAll('[data-sgrade]').forEach(btn => {
    const val = btn.getAttribute('data-sgrade');
    btn.classList.toggle('active', grade === val);
    btn.onclick = () => {
      if (silgiState.grades[q.id] === val) delete silgiState.grades[q.id];
      else silgiState.grades[q.id] = val;
      saveSilgiState();
      renderSilgiSingle(qs);
    };
  });

  // Answer & Explanation box
  const ansBox = document.getElementById('sqExpBox');
  if (reveal) {
    ansBox.classList.remove('hidden');
    document.getElementById('sqAnswerBody').innerHTML =
      (q.answerHtml || '<span class="sc-sub">등록된 정답 텍스트가 없습니다.</span>') +
      renderSilgiImagesHtml(q.answerImages);

    const hasExp = (q.explanationHtml && q.explanationHtml.replace(/<[^>]+>/g, '').trim().length > 0) || (q.explanationImages && q.explanationImages.length > 0);
    const expWrap = document.getElementById('sqExpDetailWrap');
    if (hasExp) {
      expWrap.innerHTML = `<div class="silgi-sec-label">상세 해설</div><div class="q-exp-body">${q.explanationHtml || ''}</div>${renderSilgiImagesHtml(q.explanationImages)}`;
    } else {
      expWrap.innerHTML = `<div class="silgi-no-exp-note">이 출처에는 별도 해설란이 비어 있습니다.${siblings.length > 1 ? ` <button type="button" id="btnInlineSilgiCross" class="link-btn">다른 출처(${siblings.length}종) 해설 비교 →</button>` : ''}</div>`;
      const inlineBtn = document.getElementById('btnInlineSilgiCross');
      if (inlineBtn) inlineBtn.onclick = () => openSilgiCrossCheck(q);
    }
  } else {
    ansBox.classList.add('hidden');
  }

  document.getElementById('btnSilgiPrev').disabled = silgiState.currentIdx === 0;
  document.getElementById('btnSilgiNext').disabled = silgiState.currentIdx === qs.length - 1;

  // OMR Grid
  let okC = 0, midC = 0, noC = 0;
  qs.forEach(item => {
    const g = silgiState.grades[item.id];
    if (g === 'ok') okC++;
    else if (g === 'mid') midC++;
    else if (g === 'no') noC++;
  });
  document.getElementById('silgiOmrStat').textContent = `O ${okC} · △ ${midC} · X ${noC}`;
  const omr = document.getElementById('silgiOmrGrid');
  omr.innerHTML = qs.map((item, idx) => {
    const g = silgiState.grades[item.id] || '';
    const cls = `${g === 'ok' ? 'ok' : g === 'mid' ? 'mid' : g === 'no' ? 'no' : ''} ${idx === silgiState.currentIdx ? 'cur' : ''}`;
    return `<button type="button" data-sjump="${idx}" class="omr-btn ${cls}">${silgiState.examMode === 'category_set' ? (idx + 1) : item.number}</button>`;
  }).join('');
  omr.querySelectorAll('[data-sjump]').forEach(btn => {
    btn.addEventListener('click', () => {
      silgiState.currentIdx = Number(btn.getAttribute('data-sjump'));
      renderSilgiExam();
    });
  });

  bindSilgiZoomImages(document.getElementById('silgiQuestionArea'));
  renderMath(document.getElementById('silgiQuestionArea'));
}

function renderSilgiBatch(qs) {
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(qs.length / pageSize));
  if (silgiState.batchPage >= totalPages) silgiState.batchPage = totalPages - 1;
  const start = silgiState.batchPage * pageSize;
  const slice = qs.slice(start, start + pageSize);

  document.getElementById('silgiBatchSummary').textContent = `모아보기 (${start + 1}~${start + slice.length} / 총 ${qs.length}문항)`;
  document.getElementById('silgiBatchPageLabel').textContent = `${silgiState.batchPage + 1} / ${totalPages} 페이지`;
  document.getElementById('btnSilgiBatchPrev').disabled = silgiState.batchPage === 0;
  document.getElementById('btnSilgiBatchNext').disabled = silgiState.batchPage >= totalPages - 1;

  const listEl = document.getElementById('silgiBatchList');
  listEl.innerHTML = slice.map((q, i) => {
    const reveal = silgiState.showAnswerExp || silgiState.manualExpOpen.has(q.id);
    const meta = q._meta;
    const g = silgiState.grades[q.id] || '';
    const hasExp = (q.explanationHtml && q.explanationHtml.replace(/<[^>]+>/g, '').trim().length > 0) || (q.explanationImages && q.explanationImages.length > 0);
    return `
      <article class="card">
        <div class="q-head">
          <div class="q-head-left">
            <span class="q-num">${silgiState.examMode === 'category_set' ? `${start + i + 1}번 (원본 ${q.number}번)` : `${q.number}번`}</span>
            ${q.points ? `<span class="badge badge-indigo">${q.points}점</span>` : ''}
            <span class="q-subj">${q.category}</span>
            ${silgiState.examMode === 'category_set' ? `<span class="badge badge-slate">${formatSilgiRoundTitle(meta)} · ${meta.source}</span>` : ''}
          </div>
          <div class="q-head-right">
            <div class="silgi-grade-mini">
              <button type="button" data-bsg="${q.id}" data-val="ok" class="sgrade-pill ok ${g === 'ok' ? 'active' : ''}">O</button>
              <button type="button" data-bsg="${q.id}" data-val="mid" class="sgrade-pill mid ${g === 'mid' ? 'active' : ''}">△</button>
              <button type="button" data-bsg="${q.id}" data-val="no" class="sgrade-pill no ${g === 'no' ? 'active' : ''}">X</button>
            </div>
            ${!silgiState.showAnswerExp ? `<button type="button" data-bs-exp="${q.id}" class="btn btn-outline btn-sm">${reveal ? '해설 숨기기' : '정답·해설'}</button>` : ''}
          </div>
        </div>
        <div class="q-stem silgi-html">${q.questionHtml || ''}</div>
        ${renderSilgiImagesHtml(q.questionImages)}
        ${reveal ? `
          <div class="q-exp-box info">
            <div class="silgi-sec-label">정답</div>
            <div class="silgi-html">${q.answerHtml || ''}${renderSilgiImagesHtml(q.answerImages)}</div>
            ${hasExp ? `<div class="silgi-sec-label" style="margin-top:10px;">해설</div><div class="q-exp-body silgi-html">${q.explanationHtml || ''}${renderSilgiImagesHtml(q.explanationImages)}</div>` : ''}
          </div>
        ` : ''}
      </article>
    `;
  }).join('');

  listEl.querySelectorAll('[data-bsg]').forEach(btn => {
    btn.addEventListener('click', () => {
      const qid = btn.getAttribute('data-bsg');
      const val = btn.getAttribute('data-val');
      if (silgiState.grades[qid] === val) delete silgiState.grades[qid];
      else silgiState.grades[qid] = val;
      saveSilgiState();
      renderSilgiBatch(qs);
    });
  });

  listEl.querySelectorAll('[data-bs-exp]').forEach(btn => {
    btn.addEventListener('click', () => {
      const qid = btn.getAttribute('data-bs-exp');
      if (silgiState.manualExpOpen.has(qid)) silgiState.manualExpOpen.delete(qid);
      else silgiState.manualExpOpen.add(qid);
      renderSilgiBatch(qs);
    });
  });

  bindSilgiZoomImages(listEl);
  renderMath(listEl);
}

function bindSilgiZoomImages(root) {
  if (!root) return;
  root.querySelectorAll('.silgi-zoomable-img').forEach(img => {
    img.onclick = () => {
      document.getElementById('zoomContent').innerHTML = `<img src="${img.src}" alt="확대 도면" style="max-width:100%;height:auto;" />`;
      document.getElementById('modalZoom').classList.remove('hidden');
    };
  });
}

async function openSilgiCrossCheck(q) {
  const meta = q._meta;
  const siblings = silgiState.index.sessions.filter(s => s.duplicateGroup === meta.duplicateGroup);
  document.getElementById('crossSubtitle').textContent = `${formatSilgiRoundTitle(meta)} ${q.number}번 문항 · 출처 ${siblings.length}종 비교`;
  const grid = document.getElementById('crossGrid');
  grid.innerHTML = '<div class="card">다른 출처 실기 JSON을 불러오는 중...</div>';
  document.getElementById('modalCross').classList.remove('hidden');

  const loaded = await Promise.all(siblings.map(s => fetchSilgiSession(s.setId).catch(() => null)));
  grid.innerHTML = loaded.map((sData, idx) => {
    const sibMeta = siblings[idx];
    if (!sData) return `<div class="card"><strong>${sibMeta.source}</strong>: 불러오기 실패</div>`;
    const item = sData.questions.find(x => x.number === q.number);
    if (!item) return `<div class="card"><strong>${sibMeta.source}</strong>: ${q.number}번 문항 없음</div>`;
    const hasExp = (item.explanationHtml && item.explanationHtml.replace(/<[^>]+>/g, '').trim().length > 0) || (item.explanationImages && item.explanationImages.length > 0);
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span class="badge badge-teal">${sibMeta.source}</span>
          ${item.points ? `<span class="badge badge-indigo">${item.points}점</span>` : ''}
        </div>
        <div class="silgi-html" style="font-size:13.5px;line-height:1.6;margin-bottom:8px;">${item.questionHtml || ''}</div>
        ${renderSilgiImagesHtml(item.questionImages)}
        <div style="margin-top:8px;padding:8px 10px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;font-size:13px;">
          <strong style="color:#065f46;">정답</strong>
          <div class="silgi-html" style="margin-top:4px;">${item.answerHtml || ''}${renderSilgiImagesHtml(item.answerImages)}</div>
        </div>
        ${hasExp ? `<details open style="margin-top:8px;font-size:12.5px;color:#334155;"><summary style="cursor:pointer;font-weight:600;color:#2563eb;">해설 보기</summary><div class="silgi-html" style="margin-top:6px;line-height:1.6;">${item.explanationHtml || ''}${renderSilgiImagesHtml(item.explanationImages)}</div></details>` : ''}
      </div>
    `;
  }).join('');
  bindSilgiZoomImages(grid);
  renderMath(grid);
}

// =========================================================================
// PILGI -> SILGI LINKAGE PREVIEW MODAL
// =========================================================================
window.getSilgiLinkForPilgi = function getSilgiLinkForPilgi(pilgiQid) {
  if (!silgiState.linkMap) return null;
  const tid = silgiState.linkMap.pilgiToTopic?.[pilgiQid];
  if (!tid) return null;
  return silgiState.linkMap.topics?.[tid] || null;
};

window.openSilgiPreviewModal = async function openSilgiPreviewModal(pilgiQid) {
  const topic = window.getSilgiLinkForPilgi(pilgiQid);
  if (!topic || !topic.silgiIds || topic.silgiIds.length === 0) {
    showToast('연계된 실기 문항이 없습니다.');
    return;
  }
  silgiState.previewTopicId = topic.id;
  silgiState.previewSilgiIds = topic.silgiIds;
  silgiState.previewIdx = 0;
  silgiState.previewShowAns = false;

  document.getElementById('spModalTopicTitle').textContent = `⚡ 실기 연계 미리보기 · ${topic.name}`;
  document.getElementById('spModalTopicSub').textContent = `관련 실기 기출 총 ${topic.silgiTotal}문항 중 대표 ${topic.silgiIds.length}문항 (필기 풀이를 유지한 채 미리보기)`;
  document.getElementById('modalSilgiPreview').classList.remove('hidden');
  await renderSilgiPreviewContent();
};

async function renderSilgiPreviewContent() {
  const ids = silgiState.previewSilgiIds;
  if (!ids || ids.length === 0) return;
  const idx = Math.max(0, Math.min(ids.length - 1, silgiState.previewIdx));
  silgiState.previewIdx = idx;

  // Render quick selector pills (top 12)
  const pillsWrap = document.getElementById('spQuickPills');
  const silgiMeta = silgiState.linkMap?.silgiMeta || {};
  pillsWrap.innerHTML = ids.slice(0, 15).map((id, i) => {
    const m = silgiMeta[id];
    const lbl = m ? `${m.y}-${m.r}회 #${m.n}` : `문항 ${i + 1}`;
    return `<button type="button" data-sp-idx="${i}" class="chip ${i === idx ? 'active' : ''}">${lbl}</button>`;
  }).join('');
  pillsWrap.querySelectorAll('[data-sp-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      silgiState.previewIdx = Number(btn.getAttribute('data-sp-idx'));
      silgiState.previewShowAns = false;
      renderSilgiPreviewContent();
    });
  });

  document.getElementById('spPagerLbl').textContent = `${idx + 1} / ${ids.length}`;
  document.getElementById('btnSpPrev').disabled = idx === 0;
  document.getElementById('btnSpNext').disabled = idx >= ids.length - 1;

  const targetId = ids[idx];
  const m = silgiMeta[targetId];
  const body = document.getElementById('spBody');
  if (!m) {
    body.innerHTML = '<div class="sc-sub">실기 문항 정보를 찾을 수 없습니다.</div>';
    return;
  }

  body.innerHTML = '<div class="sc-sub" style="padding:20px;">실기 문항 불러오는 중...</div>';
  try {
    const sData = await fetchSilgiSession(m.s);
    const q = sData.questions.find(x => x.id === targetId) || sData.questions.find(x => x.number === m.n);
    if (!q) {
      body.innerHTML = '<div class="sc-sub">문항을 찾을 수 없습니다.</div>';
      return;
    }

    const hasExp = (q.explanationHtml && q.explanationHtml.replace(/<[^>]+>/g, '').trim().length > 0) || (q.explanationImages && q.explanationImages.length > 0);
    body.innerHTML = `
      <div class="sp-meta-row">
        <span class="badge badge-teal">${m.y}년 ${m.r}회 실기 · ${q.number}번</span>
        <span class="badge badge-blue">${m.p}</span>
        ${q.points ? `<span class="badge badge-indigo">${q.points}점</span>` : ''}
        <span class="q-subj">${q.category}</span>
      </div>
      <div class="q-stem silgi-html" style="margin-top:10px;">${q.questionHtml || ''}</div>
      ${renderSilgiImagesHtml(q.questionImages)}
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <button type="button" id="btnSpToggleAns" class="btn ${silgiState.previewShowAns ? 'btn-outline' : 'btn-primary'} btn-sm">
          ${silgiState.previewShowAns ? '정답·해설 숨기기' : '정답·해설 확인하기'}
        </button>
        <button type="button" id="btnSpJumpFull" class="btn btn-dark btn-sm">실기 탭에서 이 회차 풀기 →</button>
      </div>
      ${silgiState.previewShowAns ? `
        <div class="q-exp-box info" style="margin-top:12px;">
          <div class="silgi-sec-label">정답</div>
          <div class="silgi-html">${q.answerHtml || ''}${renderSilgiImagesHtml(q.answerImages)}</div>
          ${hasExp ? `<div class="silgi-sec-label" style="margin-top:10px;">해설</div><div class="q-exp-body silgi-html">${q.explanationHtml || ''}${renderSilgiImagesHtml(q.explanationImages)}</div>` : ''}
        </div>
      ` : ''}
    `;

    document.getElementById('btnSpToggleAns')?.addEventListener('click', () => {
      silgiState.previewShowAns = !silgiState.previewShowAns;
      renderSilgiPreviewContent();
    });
    document.getElementById('btnSpJumpFull')?.addEventListener('click', () => {
      document.getElementById('modalSilgiPreview').classList.add('hidden');
      openSilgiRoundSession(m.s, q.id);
    });

    bindSilgiZoomImages(body);
    renderMath(body);
  } catch (err) {
    body.innerHTML = `<div class="sc-sub">실기 문항을 불러오지 못했습니다.</div>`;
  }
}

// =========================================================================
// SCRATCHPAD FOR SILGI VIEW
// =========================================================================
function setupSilgiScratchpad() {
  const canvas = document.getElementById('silgiPadCanvas');
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d');
  let drawing = false;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
  }
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  canvas.addEventListener('pointerdown', e => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e);
    ctx.beginPath();
    ctx.strokeStyle = silgiState.penColor;
    ctx.moveTo(p.x, p.y);
  });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  canvas.addEventListener('pointercancel', () => { drawing = false; });
  document.getElementById('btnSilgiClearPad')?.addEventListener('click', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
  document.querySelectorAll('[data-spen]').forEach(btn => {
    btn.addEventListener('click', () => {
      silgiState.penColor = btn.getAttribute('data-spen');
      document.querySelectorAll('[data-spen]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  return resize;
}

// =========================================================================
// INITIALIZATION
// =========================================================================
async function initSilgiModule() {
  loadSilgiState();
  const resizeSilgiPad = setupSilgiScratchpad();

  try {
    const [idxRes, linkRes] = await Promise.all([
      fetch('./data/silgi/index.json'),
      fetch('./data/silgi/link_map.json')
    ]);
    if (idxRes.ok) silgiState.index = await idxRes.json();
    if (linkRes.ok) silgiState.linkMap = await linkRes.json();
  } catch (err) {
    console.warn('Silgi data load error:', err);
  }

  if (silgiState.index) {
    const validSrc = new Set(silgiState.index.sources || []);
    silgiState.enabledSources = new Set(Array.from(silgiState.enabledSources).filter(s => validSrc.has(s)));
    if (silgiState.enabledSources.size === 0) {
      (silgiState.index.sources || []).forEach(s => silgiState.enabledSources.add(s));
    }

    const priSel = document.getElementById('silgiSelectPriority');
    if (priSel) {
      priSel.innerHTML = '';
      (silgiState.index.sources || []).forEach(src => {
        const opt = document.createElement('option');
        opt.value = src;
        opt.textContent = src;
        if (src === silgiState.prioritySource) opt.selected = true;
        priSel.appendChild(opt);
      });
    }

    const years = Array.from(new Set((silgiState.index.sessions || []).map(s => Number(s.year)))).sort((a, b) => b - a);
    const ySel = document.getElementById('silgiSelectYear');
    if (ySel) {
      years.forEach(y => {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = `${y}년`;
        ySel.appendChild(opt);
      });
    }

    const chkDedup = document.getElementById('chkSilgiDedup');
    if (chkDedup) chkDedup.checked = silgiState.dedupEnabled;
    renderSilgiPublisherChips();
  }

  // Restore saved short-answer PDF from IndexedDB if present
  try {
    const rec = await SilgiPdfStore.get();
    if (rec && rec.buffer) await loadSilgiPdfFromRecord(rec);
    else updateSilgiPdfStatusUI();
  } catch (e) {
    updateSilgiPdfStatusUI();
  }

  // Re-render active Pilgi exam if user already opened one before linkMap finished loading
  if (!document.getElementById('viewExam')?.classList.contains('hidden') && typeof renderExam === 'function') {
    renderExam();
  }

  // Bind Silgi UI Events
  document.getElementById('btnSilgiSubRound')?.addEventListener('click', () => { silgiState.subMode = 'round'; renderSilgiHome(); });
  document.getElementById('btnSilgiSubCat')?.addEventListener('click', () => { silgiState.subMode = 'category'; renderSilgiHome(); });
  document.getElementById('chkSilgiDedup')?.addEventListener('change', e => { silgiState.dedupEnabled = e.target.checked; saveSilgiState(); renderSilgiHome(); });
  document.getElementById('silgiSelectPriority')?.addEventListener('change', e => { silgiState.prioritySource = e.target.value; saveSilgiState(); renderSilgiHome(); });
  document.getElementById('silgiSelectYear')?.addEventListener('change', e => { silgiState.yearFilter = e.target.value; renderSilgiHome(); });
  document.getElementById('silgiSearchInput')?.addEventListener('input', e => { silgiState.search = e.target.value; renderSilgiHome(); });

  document.getElementById('btnSilgiPubAll')?.addEventListener('click', () => {
    (silgiState.index?.sources || []).forEach(s => silgiState.enabledSources.add(s));
    saveSilgiState(); renderSilgiPublisherChips(); renderSilgiHome();
  });
  document.getElementById('btnSilgiPubNone')?.addEventListener('click', () => {
    silgiState.enabledSources.clear();
    saveSilgiState(); renderSilgiPublisherChips(); renderSilgiHome();
  });

  document.querySelectorAll('#silgiStatusChipsRow .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      silgiState.statusFilter = btn.getAttribute('data-sfilter');
      document.querySelectorAll('#silgiStatusChipsRow .chip').forEach(b => b.classList.toggle('active', b === btn));
      renderSilgiHome();
    });
  });

  // Short-answer PDF controls
  document.getElementById('inputSilgiPdf')?.addEventListener('change', e => {
    if (e.target.files?.[0]) handleSilgiPdfSelected(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('inputSilgiPdfModal')?.addEventListener('change', e => {
    if (e.target.files?.[0]) handleSilgiPdfSelected(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btnOpenSilgiPdf')?.addEventListener('click', openSilgiPdfViewer);
  document.getElementById('btnSilgiExamPdf')?.addEventListener('click', openSilgiPdfViewer);
  document.getElementById('btnCloseSilgiPdf')?.addEventListener('click', () => document.getElementById('modalSilgiPdf').classList.add('hidden'));
  document.getElementById('btnRemoveSilgiPdf')?.addEventListener('click', async () => {
    await SilgiPdfStore.clear();
    silgiState.pdfDoc = null;
    silgiState.pdfMeta = null;
    updateSilgiPdfStatusUI();
    showToast('실기 단답 PDF 연결을 해제했습니다.');
  });
  document.getElementById('btnSilgiPdfPrev')?.addEventListener('click', () => { silgiState.pdfPage--; renderSilgiPdfPage(); });
  document.getElementById('btnSilgiPdfNext')?.addEventListener('click', () => { silgiState.pdfPage++; renderSilgiPdfPage(); });
  document.getElementById('silgiPdfPageInput')?.addEventListener('change', e => {
    const p = Number(e.target.value);
    if (!Number.isNaN(p) && p >= 1) { silgiState.pdfPage = p; renderSilgiPdfPage(); }
  });
  document.getElementById('btnSilgiPdfZoomOut')?.addEventListener('click', () => {
    silgiState.pdfZoom = Math.max(0.6, Math.round((silgiState.pdfZoom - 0.15) * 100) / 100);
    renderSilgiPdfPage();
  });
  document.getElementById('btnSilgiPdfZoomIn')?.addEventListener('click', () => {
    silgiState.pdfZoom = Math.min(2.2, Math.round((silgiState.pdfZoom + 0.15) * 100) / 100);
    renderSilgiPdfPage();
  });

  // Silgi Exam View controls
  document.getElementById('btnSilgiBack')?.addEventListener('click', () => {
    document.getElementById('viewSilgiExam').classList.add('hidden');
    document.getElementById('viewHome').classList.remove('hidden');
    if (typeof window.setHomeModeTab === 'function') window.setHomeModeTab('silgi');
    else renderSilgiHome();
  });
  document.getElementById('chkSilgiShowAnswerExp')?.addEventListener('change', e => {
    silgiState.showAnswerExp = e.target.checked;
    if (silgiState.showAnswerExp) silgiState.manualExpOpen.clear();
    saveSilgiState();
    renderSilgiExam();
  });
  document.getElementById('btnSilgiViewSingle')?.addEventListener('click', () => { silgiState.viewMode = 'single'; renderSilgiExam(); });
  document.getElementById('btnSilgiViewBatch')?.addEventListener('click', () => {
    silgiState.viewMode = 'batch';
    silgiState.batchPage = Math.floor(silgiState.currentIdx / 10);
    renderSilgiExam();
  });
  document.getElementById('btnSilgiPrev')?.addEventListener('click', () => { if (silgiState.currentIdx > 0) { silgiState.currentIdx--; renderSilgiExam(); } });
  document.getElementById('btnSilgiNext')?.addEventListener('click', () => { if (silgiState.currentIdx < silgiState.activeQuestions.length - 1) { silgiState.currentIdx++; renderSilgiExam(); } });
  document.getElementById('btnSilgiBatchPrev')?.addEventListener('click', () => { if (silgiState.batchPage > 0) { silgiState.batchPage--; renderSilgiExam(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
  document.getElementById('btnSilgiBatchNext')?.addEventListener('click', () => { if ((silgiState.batchPage + 1) * 10 < silgiState.activeQuestions.length) { silgiState.batchPage++; renderSilgiExam(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });
  document.getElementById('btnSilgiBookmark')?.addEventListener('click', () => {
    const q = silgiState.activeQuestions[silgiState.currentIdx];
    if (!q) return;
    if (silgiState.bookmarks[q.id]) delete silgiState.bookmarks[q.id];
    else silgiState.bookmarks[q.id] = true;
    saveSilgiState();
    renderSilgiExam();
  });
  document.getElementById('btnSilgiResetSession')?.addEventListener('click', () => {
    silgiState.activeQuestions.forEach(q => { delete silgiState.grades[q.id]; });
    silgiState.manualExpOpen.clear();
    saveSilgiState();
    renderSilgiExam();
    showToast('현재 실기 문항의 자가채점 기록을 초기화했습니다.');
  });
  document.getElementById('btnSilgiPadToggle')?.addEventListener('click', () => {
    const card = document.getElementById('silgiPadCard');
    card.classList.toggle('hidden');
    if (!card.classList.contains('hidden')) setTimeout(resizeSilgiPad, 40);
  });
  document.getElementById('btnSilgiCrossCheck')?.addEventListener('click', () => {
    const q = silgiState.activeQuestions[silgiState.currentIdx];
    if (q) openSilgiCrossCheck(q);
  });

  // Silgi Preview Modal controls
  document.getElementById('btnCloseSilgiPreview')?.addEventListener('click', () => document.getElementById('modalSilgiPreview').classList.add('hidden'));
  document.getElementById('btnSpPrev')?.addEventListener('click', () => {
    if (silgiState.previewIdx > 0) { silgiState.previewIdx--; silgiState.previewShowAns = false; renderSilgiPreviewContent(); }
  });
  document.getElementById('btnSpNext')?.addEventListener('click', () => {
    if (silgiState.previewIdx < silgiState.previewSilgiIds.length - 1) { silgiState.previewIdx++; silgiState.previewShowAns = false; renderSilgiPreviewContent(); }
  });
}

window.addEventListener('DOMContentLoaded', initSilgiModule);
