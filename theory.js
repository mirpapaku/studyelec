// =========================================================================
// THEORY (CHEATKEY) + LOCAL PDF (IndexedDB + PDF.js) + LINKED PAST QUESTIONS
// =========================================================================

const THEORY_PDF_DB = 'electric_cbt_theory_pdf_db';
const THEORY_PDF_STORE = 'pdfs';
const THEORY_PDF_KEY = 'cheatkey_theory_pdf';
const THEORY_PREFS_KEY = 'electric_cbt_theory_prefs_v1';

const theoryState = {
  map: null,
  flatCheatkeys: [],       // Ordered list of all 208 cheatkeys for Prev/Next navigation
  byId: {},                // ckId -> enriched cheatkey entry
  byQid: {},               // questionId -> enriched cheatkey entry
  selectedPartId: 'circuit',
  search: '',
  pageOffset: 0,
  pdfMeta: null,           // { name, size, numPages }
  pdfDoc: null,            // pdfjs PDFDocumentProxy
  pdfZoom: 1.0,
  layout: 'stack',         // 'stack' | 'split'
  activeCkId: null,
  quizFilter: 'all',       // 'all' | 'recent5' | 'unsolved'
  quizPage: 0,
  quizPageSize: 10,
  renderToken: 0
};

window.THEORY_BY_QID = theoryState.byQid;

function loadTheoryPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(THEORY_PREFS_KEY) || '{}');
    if (typeof raw.pageOffset === 'number') theoryState.pageOffset = raw.pageOffset;
    if (raw.selectedPartId) theoryState.selectedPartId = raw.selectedPartId;
    if (raw.layout === 'split' || raw.layout === 'stack') theoryState.layout = raw.layout;
    if (typeof raw.pdfZoom === 'number') theoryState.pdfZoom = raw.pdfZoom;
  } catch (e) {}
}

function saveTheoryPrefs() {
  try {
    localStorage.setItem(THEORY_PREFS_KEY, JSON.stringify({
      pageOffset: theoryState.pageOffset,
      selectedPartId: theoryState.selectedPartId,
      layout: theoryState.layout,
      pdfZoom: theoryState.pdfZoom
    }));
  } catch (e) {}
}

// ---------- IndexedDB for Local Copyright-Safe PDF Storage ----------
const TheoryPdfStore = {
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(THEORY_PDF_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(THEORY_PDF_STORE)) {
          db.createObjectStore(THEORY_PDF_STORE);
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
      const tx = db.transaction(THEORY_PDF_STORE, 'readwrite');
      tx.objectStore(THEORY_PDF_STORE).put({
        name: file.name,
        size: file.size,
        buffer,
        savedAt: Date.now()
      }, THEORY_PDF_KEY);
      tx.oncomplete = () => resolve({ name: file.name, size: file.size, buffer });
      tx.onerror = () => reject(tx.error);
    });
  },
  async get() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(THEORY_PDF_STORE, 'readonly');
      const req = tx.objectStore(THEORY_PDF_STORE).get(THEORY_PDF_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async clear() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(THEORY_PDF_STORE, 'readwrite');
      tx.objectStore(THEORY_PDF_STORE).delete(THEORY_PDF_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
};

function ensurePdfJsWorker() {
  if (typeof pdfjsLib !== 'undefined' && pdfjsLib.GlobalWorkerOptions) {
    if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }
    return true;
  }
  return false;
}

async function loadPdfFromRecord(record) {
  if (!record || !record.buffer) return false;
  if (!ensurePdfJsWorker()) {
    showToast('PDF 엔진(PDF.js)을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
    return false;
  }
  try {
    // Pass a copy of Uint8Array so PDF.js worker transfer doesn't detach stored buffer
    const bytes = new Uint8Array(record.buffer.slice(0));
    const loadingTask = pdfjsLib.getDocument({ data: bytes });
    const doc = await loadingTask.promise;
    theoryState.pdfDoc = doc;
    theoryState.pdfMeta = {
      name: record.name,
      size: record.size,
      numPages: doc.numPages
    };
    updatePdfStatusUI();
    return true;
  } catch (err) {
    console.error('PDF load error:', err);
    showToast('PDF 파일을 열지 못했습니다. 올바른 PDF인지 확인해 주세요.');
    return false;
  }
}

function updatePdfStatusUI() {
  const badge = document.getElementById('theoryPdfBadge');
  const status = document.getElementById('theoryPdfStatus');
  const btnRemove = document.getElementById('btnRemoveTheoryPdf');
  const offsetEl = document.getElementById('theoryOffsetVal');
  if (offsetEl) offsetEl.textContent = (theoryState.pageOffset > 0 ? '+' : '') + theoryState.pageOffset;
  if (!badge || !status) return;

  if (theoryState.pdfDoc && theoryState.pdfMeta) {
    const mb = (theoryState.pdfMeta.size / (1024 * 1024)).toFixed(1);
    badge.className = 'badge badge-teal';
    badge.textContent = '로컬 PDF 연결됨';
    status.textContent = `${theoryState.pdfMeta.name} (${theoryState.pdfMeta.numPages}쪽 · ${mb}MB)`;
    if (btnRemove) btnRemove.classList.remove('hidden');
  } else {
    badge.className = 'badge badge-amber';
    badge.textContent = 'PDF 미연결';
    status.textContent = '이론 PDF를 기기에 1회 연결하면 치트키별 본문이 바로 표시됩니다';
    if (btnRemove) btnRemove.classList.add('hidden');
  }
}

async function handlePdfFileSelected(file) {
  if (!file) return;
  showToast('PDF를 기기 로컬 저장소(IndexedDB)에 저장하는 중...');
  try {
    const rec = await TheoryPdfStore.save(file);
    const ok = await loadPdfFromRecord(rec);
    if (ok) {
      showToast(`PDF 연결 완료! (${theoryState.pdfMeta.numPages}쪽 · 오프라인 지원)`);
      if (theoryState.activeCkId && !document.getElementById('viewTheoryDetail').classList.contains('hidden')) {
        renderTheoryPdfPages(theoryState.byId[theoryState.activeCkId]);
      }
    }
  } catch (err) {
    console.error(err);
    showToast('PDF 저장에 실패했습니다. 브라우저 저장 공간 권한을 확인해 주세요.');
  }
}

// ---------- Theory Map Loading & Global Filter Sync ----------
async function initTheoryModule() {
  loadTheoryPrefs();
  updatePdfStatusUI();

  try {
    const res = await fetch('./data/theory_map.json');
    if (!res.ok) throw new Error('theory_map.json 로드 실패');
    theoryState.map = await res.json();
    buildTheoryLookups();
  } catch (err) {
    console.error(err);
    const el = document.getElementById('theoryChapterList');
    if (el) el.innerHTML = '<div class="card">이론 매핑 데이터(theory_map.json)를 불러오지 못했습니다.</div>';
    return;
  }

  // Try restoring previously saved PDF from IndexedDB silently
  try {
    const saved = await TheoryPdfStore.get();
    if (saved) {
      // Wait briefly if pdfjsLib is still deferred
      if (typeof pdfjsLib === 'undefined') {
        setTimeout(() => loadPdfFromRecord(saved), 500);
      } else {
        loadPdfFromRecord(saved);
      }
    }
  } catch (e) {}

  bindTheoryEvents();
  if (state.homeMode === 'theory') {
    renderTheoryHome();
  }
}

function buildTheoryLookups() {
  theoryState.flatCheatkeys = [];
  theoryState.byId = {};
  theoryState.byQid = {};
  for (const part of theoryState.map.parts) {
    for (const ch of part.chapters) {
      for (const ck of ch.cheatkeys) {
        const entry = {
          ...ck,
          partId: part.id,
          partName: part.name,
          cbtSubject: part.cbtSubject,
          chapterNum: ch.number,
          chapterTitle: ch.title,
          flatIdx: theoryState.flatCheatkeys.length
        };
        theoryState.flatCheatkeys.push(entry);
        theoryState.byId[ck.id] = entry;
        for (const ref of (ck.questionRefs || [])) {
          const qid = Array.isArray(ref) ? ref[1] : ref;
          theoryState.byQid[qid] = entry;
        }
      }
    }
  }
  window.THEORY_BY_QID = theoryState.byQid;
}

// Filter a CheatKey's questionRefs using the user's current global filters (publisher, year, dedup)
function getFilteredRefsForCheatkey(ck, extraFilter = 'all') {
  const allowedSessions = new Set(getFilteredSessions(false).map(s => s.setId));
  const sessionById = new Map((state.index?.sessions || []).map(s => [s.setId, s]));
  const out = [];
  for (const ref of (ck.questionRefs || [])) {
    const setId = ref[0];
    const qid = ref[1];
    if (!allowedSessions.has(setId)) continue;
    const meta = sessionById.get(setId);
    if (!meta) continue;
    if (extraFilter === 'recent5' && meta.year < 2022) continue;
    if (extraFilter === 'unsolved') {
      const ans = state.answers[qid];
      // Keep unsolved; for already-solved, we check exact correctness after loading, or keep unsolved here
      if (ans) continue;
    }
    out.push({ setId, qid, meta });
  }
  return out;
}

// ---------- Render Theory Home (Parts -> Chapters -> CheatKeys) ----------
window.renderTheoryHome = function renderTheoryHome() {
  if (!theoryState.map) return;
  updatePdfStatusUI();

  const allowedSessions = new Set(getFilteredSessions(false).map(s => s.setId));
  const partTabs = document.getElementById('theoryPartTabs');
  const parts = theoryState.map.parts;

  // Count visible questions per part under active filters
  const partCounts = {};
  for (const p of parts) {
    let cnt = 0;
    for (const ch of p.chapters) {
      for (const ck of ch.cheatkeys) {
        for (const ref of (ck.questionRefs || [])) {
          if (allowedSessions.has(ref[0])) cnt++;
        }
      }
    }
    partCounts[p.id] = cnt;
  }

  partTabs.innerHTML = parts.map(p => `
    <button type="button" data-tpart="${p.id}" class="subj-tab ${theoryState.selectedPartId === p.id ? 'active' : ''}">
      ${p.name} <span class="tab-cnt">(${p.cheatkeyCount}키 · ${partCounts[p.id].toLocaleString()})</span>
    </button>
  `).join('');

  partTabs.querySelectorAll('[data-tpart]').forEach(btn => {
    btn.addEventListener('click', () => {
      theoryState.selectedPartId = btn.getAttribute('data-tpart');
      saveTheoryPrefs();
      renderTheoryHome();
    });
  });

  const q = theoryState.search.trim().toLowerCase();
  const listEl = document.getElementById('theoryChapterList');
  const targetParts = q ? parts : parts.filter(p => p.id === theoryState.selectedPartId);

  const cardsHtml = [];
  for (const part of targetParts) {
    for (const ch of part.chapters) {
      const matchedCks = ch.cheatkeys.filter(ck => {
        if (!q) return true;
        const hay = `${part.name} ${ch.title} 치트키${ck.number} ${ck.title}`.toLowerCase();
        return hay.includes(q);
      });
      if (matchedCks.length === 0) continue;

      const ckRowsHtml = matchedCks.map(ck => {
        let visCnt = 0;
        let solvedCnt = 0;
        for (const ref of (ck.questionRefs || [])) {
          if (allowedSessions.has(ref[0])) {
            visCnt++;
            if (state.answers[ref[1]]) solvedCnt++;
          }
        }
        const pageLbl = ck.startPage === ck.endPage ? `p.${ck.startPage}` : `p.${ck.startPage}~${ck.endPage}`;
        return `
          <button type="button" data-open-ck="${ck.id}" class="theory-ck-row">
            <div class="theory-ck-left">
              <span class="ck-num-pill">치트키 ${ck.number}</span>
              <span class="ck-title-txt">${ck.title}</span>
              ${ck.sharedPage ? `<span class="badge badge-slate">페이지 공유</span>` : ''}
            </div>
            <div class="theory-ck-right">
              <span class="ck-page-tag">${pageLbl}</span>
              <span class="badge badge-blue">기출 ${visCnt}문항${solvedCnt > 0 ? ` · 풀이 ${solvedCnt}` : ''}</span>
            </div>
          </button>
        `;
      }).join('');

      cardsHtml.push(`
        <article class="card theory-chapter-card">
          <div class="theory-ch-head">
            <div>
              ${q ? `<span class="badge badge-teal" style="margin-right:6px;">${part.name}</span>` : ''}
              <strong class="theory-ch-title">챕터 ${ch.number}. ${ch.title}</strong>
            </div>
            <span class="sc-sub">${matchedCks.length}개 치트키</span>
          </div>
          <div class="theory-ck-list">${ckRowsHtml}</div>
        </article>
      `);
    }
  }

  if (cardsHtml.length === 0) {
    listEl.innerHTML = '<div class="card" style="text-align:center;color:#64748b;">검색 조건에 맞는 치트키가 없습니다.</div>';
  } else {
    listEl.innerHTML = cardsHtml.join('');
    listEl.querySelectorAll('[data-open-ck]').forEach(btn => {
      btn.addEventListener('click', () => openTheoryDetail(btn.getAttribute('data-open-ck')));
    });
  }
};

// ---------- Open Theory Detail View (PDF + Linked Past Questions) ----------
window.openTheoryDetail = async function openTheoryDetail(ckId) {
  const entry = theoryState.byId[ckId];
  if (!entry) return;

  theoryState.activeCkId = ckId;
  theoryState.quizPage = 0;

  document.getElementById('viewHome').classList.add('hidden');
  document.getElementById('viewExam').classList.add('hidden');
  document.getElementById('mobileNav').classList.add('hidden');
  document.getElementById('viewTheoryDetail').classList.remove('hidden');

  document.getElementById('tdPartBadge').textContent = entry.partName;
  document.getElementById('tdTitle').textContent = `치트키 ${entry.number}. ${entry.title}`;
  const sp = entry.startPage + theoryState.pageOffset;
  const ep = entry.endPage + theoryState.pageOffset;
  document.getElementById('tdPageBadge').textContent = sp === ep ? `p.${sp}` : `p.${sp} ~ p.${ep}`;
  document.getElementById('tdBreadcrumbs').textContent =
    `${entry.partName}  ›  챕터 ${entry.chapterNum}. ${entry.chapterTitle}  ›  치트키 ${entry.number}. ${entry.title}`;

  document.getElementById('btnTdPrevCk').disabled = entry.flatIdx === 0;
  document.getElementById('btnTdNextCk').disabled = entry.flatIdx >= theoryState.flatCheatkeys.length - 1;

  applyTheoryLayout();
  renderTheoryPdfPages(entry);
  renderTheoryLinkedQuiz(entry);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

function applyTheoryLayout() {
  const ws = document.getElementById('tdWorkspace');
  const isSplit = theoryState.layout === 'split';
  ws.classList.toggle('td-split', isSplit);
  ws.classList.toggle('td-stack', !isSplit);
  document.getElementById('btnTdLayoutStack').classList.toggle('active', !isSplit);
  document.getElementById('btnTdLayoutSplit').classList.toggle('active', isSplit);
}

async function renderTheoryPdfPages(entry) {
  const container = document.getElementById('tdPdfPages');
  const infoEl = document.getElementById('tdPdfPageInfo');
  const zoomLbl = document.getElementById('tdPdfZoomLbl');
  zoomLbl.textContent = `${Math.round(theoryState.pdfZoom * 100)}%`;

  const startP = Math.max(1, entry.startPage + theoryState.pageOffset);
  const endP = Math.max(startP, entry.endPage + theoryState.pageOffset);
  infoEl.textContent = startP === endP ? `${startP}쪽 (1페이지)` : `${startP}~${endP}쪽 (${endP - startP + 1}페이지)`;

  if (!theoryState.pdfDoc) {
    container.innerHTML = `
      <div class="td-pdf-empty">
        <p style="margin:0 0 8px;font-weight:700;color:#0f172a;">이론 PDF가 아직 연결되지 않았습니다 (${startP === endP ? `p.${startP}` : `p.${startP}~${endP}`})</p>
        <p style="margin:0 0 12px;font-size:12.5px;color:#64748b;">보유하신 <strong>전기기사 필기 치트키 PDF</strong>를 한 번만 선택하시면 이 자리에 해당 페이지가 바로 펼쳐집니다.<br/>PDF 없이도 아래 연계 기출문제는 지금 바로 풀 수 있습니다.</p>
        <label class="btn btn-primary btn-sm file-label">
          내 기기에서 이론 PDF 연결하기
          <input id="inputTheoryPdfInline" type="file" accept="application/pdf" class="hidden" />
        </label>
      </div>
    `;
    const inlineInput = document.getElementById('inputTheoryPdfInline');
    if (inlineInput) {
      inlineInput.addEventListener('change', e => handlePdfFileSelected(e.target.files[0]));
    }
    return;
  }

  const token = ++theoryState.renderToken;
  container.innerHTML = '<div class="td-pdf-loading">이론 PDF 페이지를 렌더링하는 중...</div>';

  const maxPage = theoryState.pdfDoc.numPages;
  const clampedStart = Math.min(startP, maxPage);
  const clampedEnd = Math.min(endP, maxPage);

  const frag = document.createDocumentFragment();
  const availWidth = Math.max(300, Math.min(container.clientWidth - 16, 920));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  for (let pNum = clampedStart; pNum <= clampedEnd; pNum++) {
    if (token !== theoryState.renderToken) return;
    const page = await theoryState.pdfDoc.getPage(pNum);
    if (token !== theoryState.renderToken) return;

    const baseViewport = page.getViewport({ scale: 1.0 });
    const fitScale = availWidth / baseViewport.width;
    const cssScale = fitScale * theoryState.pdfZoom;
    const viewport = page.getViewport({ scale: cssScale * dpr });

    const pageWrap = document.createElement('div');
    pageWrap.className = 'td-pdf-page-wrap';
    const label = document.createElement('div');
    label.className = 'td-pdf-page-num';
    label.textContent = `p.${pNum}`;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(baseViewport.width * cssScale)}px`;
    canvas.style.height = `${Math.floor(baseViewport.height * cssScale)}px`;
    canvas.className = 'td-pdf-canvas';

    pageWrap.appendChild(label);
    pageWrap.appendChild(canvas);
    frag.appendChild(pageWrap);

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
  }

  if (token !== theoryState.renderToken) return;
  container.innerHTML = '';
  container.appendChild(frag);
}

async function renderTheoryLinkedQuiz(entry) {
  const refs = getFilteredRefsForCheatkey(entry, theoryState.quizFilter);
  const total = refs.length;
  const pageSize = theoryState.quizPageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (theoryState.quizPage >= totalPages) theoryState.quizPage = totalPages - 1;
  if (theoryState.quizPage < 0) theoryState.quizPage = 0;

  const start = theoryState.quizPage * pageSize;
  const slice = refs.slice(start, start + pageSize);

  document.getElementById('tdQuizSummary').textContent = `연계 기출문제 (총 ${total}문항)`;
  document.getElementById('tdQPageLbl').textContent = total > 0 ? `${theoryState.quizPage + 1} / ${totalPages} 페이지 (${start + 1}~${start + slice.length}번)` : '0 / 0';
  document.getElementById('btnTdQPrev').disabled = theoryState.quizPage === 0;
  document.getElementById('btnTdQNext').disabled = theoryState.quizPage >= totalPages - 1 || total === 0;

  const listEl = document.getElementById('tdQuizList');
  if (slice.length === 0) {
    document.getElementById('tdQuizStat').textContent = '';
    listEl.innerHTML = '<div class="card" style="text-align:center;color:#64748b;">현재 필터 조건에 해당하는 연계 기출문제가 없습니다. 상단 필터나 출판사 설정을 조정해 보세요.</div>';
    return;
  }

  listEl.innerHTML = '<div class="card" style="text-align:center;color:#64748b;">연계 기출문제를 불러오는 중...</div>';

  // Fetch only the unique sessions needed for this 10-question slice
  const neededSetIds = Array.from(new Set(slice.map(r => r.setId)));
  await Promise.all(neededSetIds.map(sid => fetchSession(sid).catch(() => null)));

  const loadedQs = [];
  for (const r of slice) {
    const ds = state.loadedSessions[r.setId];
    if (!ds) continue;
    const found = ds.questions.find(x => x.id === r.qid);
    if (found) loadedQs.push({ ...found, _meta: r.meta });
  }

  let solved = 0, correct = 0;
  loadedQs.forEach(q => {
    const a = state.answers[q.id];
    if (a) { solved++; if (a === q.answer) correct++; }
  });
  document.getElementById('tdQuizStat').textContent = `현재 페이지 정답 ${correct} / 풀이 ${solved}`;

  const nums = ['①', '②', '③', '④'];
  listEl.innerHTML = loadedQs.map((q, idx) => {
    const chosen = state.answers[q.id];
    const meta = q._meta;
    const siblings = state.index.sessions.filter(s => s.duplicateGroup === meta.duplicateGroup);
    const hasExp = q.explanation && q.explanation.replace(/<[^>]+>/g, '').trim().length > 0;
    const ytHref = q.videoId
      ? `https://www.youtube.com/watch?v=${q.videoId}${q.ytSeconds ? `&t=${q.ytSeconds}s` : ''}`
      : (q.videoUrl || '');
    return `
      <article class="card" id="td_q_${q.id}">
        <div class="q-head">
          <div class="q-head-left">
            <span class="q-num">#${start + idx + 1}</span>
            <span class="badge badge-slate">${formatRoundTitle(meta)} · ${meta.source} · ${q.number}번</span>
            ${q.category ? `<span class="q-cat">${q.category}</span>` : ''}
          </div>
          <div class="q-head-right">
            ${ytHref ? `<a href="${ytHref}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">해설 영상</a>` : ''}
            ${siblings.length > 1 ? `<button type="button" data-td-cross="${q.id}" class="btn btn-indigo btn-sm">교차 비교</button>` : ''}
            <button type="button" data-td-bm="${q.id}" class="btn btn-outline btn-sm">${state.bookmarks[q.id] ? '★ 북마크' : '☆ 북마크'}</button>
          </div>
        </div>
        <div class="q-stem">${q.stem}</div>
        ${q.diagram && q.diagram.trim() ? `
          <div class="q-diag-wrap">
            <div class="q-diag">${q.diagram}</div>
            <button type="button" data-td-zoom="${q.id}" class="btn btn-outline btn-sm zoom-btn">도면 크게 보기</button>
          </div>
        ` : ''}
        <div class="q-choices">
          ${q.choices.map((c, i) => {
            const val = i + 1;
            let cls = '';
            if (chosen) {
              if (val === q.answer) cls = 'correct';
              else if (val === chosen) cls = 'wrong';
            }
            return `<button type="button" data-tdq="${q.id}" data-tdch="${val}" class="choice-btn ${cls}"><span class="choice-num">${nums[i] || val}</span><span class="choice-body">${c}</span></button>`;
          }).join('')}
        </div>
        ${chosen ? `
          <div class="q-exp-box ${chosen === q.answer ? 'ok' : 'no'}">
            <div class="q-exp-head">
              <strong>${chosen === q.answer ? '정답입니다!' : '오답입니다'}</strong>
              <span>정답: ${nums[q.answer - 1] || q.answer}</span>
            </div>
            ${q.formula ? `<div class="q-formula"><strong>핵심 공식:</strong> ${q.formula}</div>` : ''}
            ${q.tip ? `<div class="q-tip"><strong>암기/풀이 팁:</strong> ${q.tip}</div>` : ''}
            <div class="q-exp-body">${hasExp ? q.explanation : '<span class="badge badge-amber">해설 준비 중</span> 추후 보강 예정입니다.'}</div>
          </div>
        ` : ''}
      </article>
    `;
  }).join('');

  listEl.querySelectorAll('[data-tdq]').forEach(btn => {
    btn.addEventListener('click', () => {
      const qid = btn.getAttribute('data-tdq');
      const val = Number(btn.getAttribute('data-tdch'));
      state.answers[qid] = val;
      saveState();
      renderTheoryLinkedQuiz(entry);
    });
  });

  listEl.querySelectorAll('[data-td-bm]').forEach(btn => {
    btn.addEventListener('click', () => {
      const qid = btn.getAttribute('data-td-bm');
      if (state.bookmarks[qid]) delete state.bookmarks[qid];
      else state.bookmarks[qid] = true;
      saveState();
      renderTheoryLinkedQuiz(entry);
    });
  });

  listEl.querySelectorAll('[data-td-cross]').forEach(btn => {
    btn.addEventListener('click', () => {
      const qid = btn.getAttribute('data-td-cross');
      const found = loadedQs.find(x => x.id === qid);
      if (found) openCrossCheckForQuestion(found);
    });
  });

  listEl.querySelectorAll('[data-td-zoom]').forEach(btn => {
    btn.addEventListener('click', () => {
      const qid = btn.getAttribute('data-td-zoom');
      const found = loadedQs.find(x => x.id === qid);
      if (found && found.diagram) {
        document.getElementById('zoomContent').innerHTML = found.diagram;
        document.getElementById('modalZoom').classList.remove('hidden');
      }
    });
  });

  renderMath(listEl);
}

async function launchTheoryCbtMode() {
  const entry = theoryState.byId[theoryState.activeCkId];
  if (!entry) return;
  const refs = getFilteredRefsForCheatkey(entry, theoryState.quizFilter).slice(0, 40);
  if (refs.length === 0) {
    showToast('풀 수 있는 연계 기출문제가 없습니다.');
    return;
  }
  showToast(`치트키 연계 기출 ${refs.length}문항을 CBT 모드로 불러오는 중...`);
  const needed = Array.from(new Set(refs.map(r => r.setId)));
  await Promise.all(needed.map(sid => fetchSession(sid).catch(() => null)));
  const collected = [];
  for (const r of refs) {
    const ds = state.loadedSessions[r.setId];
    if (!ds) continue;
    const found = ds.questions.find(x => x.id === r.qid);
    if (found) collected.push({ ...found, _meta: r.meta });
  }
  document.getElementById('viewTheoryDetail').classList.add('hidden');
  launchSubjectExam(`[${entry.partName}] 치트키 ${entry.number}. ${entry.title}`, `치트키 연계 ${collected.length}문항`, collected);
}

function bindTheoryEvents() {
  document.getElementById('inputTheoryPdf')?.addEventListener('change', e => {
    handlePdfFileSelected(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('inputTheoryPdfDetail')?.addEventListener('change', e => {
    handlePdfFileSelected(e.target.files[0]);
    e.target.value = '';
  });
  document.getElementById('btnRemoveTheoryPdf')?.addEventListener('click', async () => {
    await TheoryPdfStore.clear();
    theoryState.pdfDoc = null;
    theoryState.pdfMeta = null;
    updatePdfStatusUI();
    showToast('기기에 저장된 이론 PDF 연결을 해제했습니다.');
  });

  document.getElementById('btnOffsetMinus')?.addEventListener('click', () => {
    theoryState.pageOffset -= 1;
    saveTheoryPrefs();
    updatePdfStatusUI();
  });
  document.getElementById('btnOffsetPlus')?.addEventListener('click', () => {
    theoryState.pageOffset += 1;
    saveTheoryPrefs();
    updatePdfStatusUI();
  });

  document.getElementById('theorySearchInput')?.addEventListener('input', e => {
    theoryState.search = e.target.value;
    renderTheoryHome();
  });

  document.getElementById('btnTheoryBack')?.addEventListener('click', () => {
    document.getElementById('viewTheoryDetail').classList.add('hidden');
    document.getElementById('viewHome').classList.remove('hidden');
    state.homeMode = 'theory';
    document.getElementById('tabModeRound').classList.remove('active');
    document.getElementById('tabModeSubject').classList.remove('active');
    document.getElementById('tabModeTheory').classList.add('active');
    renderHome();
  });

  document.getElementById('btnTdLayoutStack')?.addEventListener('click', () => {
    theoryState.layout = 'stack';
    saveTheoryPrefs();
    applyTheoryLayout();
    if (theoryState.activeCkId) renderTheoryPdfPages(theoryState.byId[theoryState.activeCkId]);
  });
  document.getElementById('btnTdLayoutSplit')?.addEventListener('click', () => {
    theoryState.layout = 'split';
    saveTheoryPrefs();
    applyTheoryLayout();
    if (theoryState.activeCkId) renderTheoryPdfPages(theoryState.byId[theoryState.activeCkId]);
  });

  document.getElementById('btnPdfZoomOut')?.addEventListener('click', () => {
    theoryState.pdfZoom = Math.max(0.6, +(theoryState.pdfZoom - 0.15).toFixed(2));
    saveTheoryPrefs();
    if (theoryState.activeCkId) renderTheoryPdfPages(theoryState.byId[theoryState.activeCkId]);
  });
  document.getElementById('btnPdfZoomIn')?.addEventListener('click', () => {
    theoryState.pdfZoom = Math.min(2.0, +(theoryState.pdfZoom + 0.15).toFixed(2));
    saveTheoryPrefs();
    if (theoryState.activeCkId) renderTheoryPdfPages(theoryState.byId[theoryState.activeCkId]);
  });

  document.getElementById('btnTdPrevCk')?.addEventListener('click', () => {
    const cur = theoryState.byId[theoryState.activeCkId];
    if (cur && cur.flatIdx > 0) openTheoryDetail(theoryState.flatCheatkeys[cur.flatIdx - 1].id);
  });
  document.getElementById('btnTdNextCk')?.addEventListener('click', () => {
    const cur = theoryState.byId[theoryState.activeCkId];
    if (cur && cur.flatIdx < theoryState.flatCheatkeys.length - 1) openTheoryDetail(theoryState.flatCheatkeys[cur.flatIdx + 1].id);
  });

  document.getElementById('btnTdLaunchCbt')?.addEventListener('click', launchTheoryCbtMode);

  document.querySelectorAll('#tdQuizFilterChips .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      theoryState.quizFilter = btn.getAttribute('data-qfilter');
      theoryState.quizPage = 0;
      document.querySelectorAll('#tdQuizFilterChips .chip').forEach(b => b.classList.toggle('active', b === btn));
      if (theoryState.activeCkId) renderTheoryLinkedQuiz(theoryState.byId[theoryState.activeCkId]);
    });
  });

  document.getElementById('btnTdQPrev')?.addEventListener('click', () => {
    if (theoryState.quizPage > 0) {
      theoryState.quizPage--;
      renderTheoryLinkedQuiz(theoryState.byId[theoryState.activeCkId]);
      document.querySelector('.td-quiz-pane')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  document.getElementById('btnTdQNext')?.addEventListener('click', () => {
    theoryState.quizPage++;
    renderTheoryLinkedQuiz(theoryState.byId[theoryState.activeCkId]);
    document.querySelector('.td-quiz-pane')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

window.addEventListener('DOMContentLoaded', () => {
  // Slight defer so app.js finishes loading state.index
  setTimeout(initTheoryModule, 120);
});
