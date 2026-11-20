const STORAGE_KEY = 'electric_cbt_full_state_v2';
const DEFAULT_PRIORITY = [
  '다산에듀', '김영북스', '한솔아카데미', '테스트나라', '핵담',
  '파워텔', '엔지니어랩', '전기요금', '엔트', '전자문제집(미해설)'
];

const state = {
  index: null,
  loadedSessions: {},
  answers: {},
  bookmarks: {},
  homeMode: 'round',       // 'round' | 'subject'
  filter: 'all',           // 'all' | 'duplicate' | 'no-exp' | 'wrong'
  enabledSources: new Set(),
  dedupEnabled: false,
  prioritySource: '다산에듀',
  yearFilter: 'all',
  search: '',
  selectedGlobalSubject: null,

  // Active exam context
  examMode: 'round',       // 'round' | 'subject_set'
  examTitle: '',
  examSourceLabel: '',
  examHasExp: true,
  currentSetId: null,
  currentSubjectTab: 'all',
  activeQuestions: [],     // Used in subject_set mode (each item has _meta)
  viewMode: 'single',      // 'single' | 'batch20'
  currentIdx: 0,
  batchPage: 0,
  penColor: '#0f172a'
};

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.answers = raw.answers || {};
    state.bookmarks = raw.bookmarks || {};
    if (typeof raw.dedupEnabled === 'boolean') state.dedupEnabled = raw.dedupEnabled;
    if (raw.prioritySource) state.prioritySource = raw.prioritySource;
    if (Array.isArray(raw.enabledSources) && raw.enabledSources.length > 0) {
      state.enabledSources = new Set(raw.enabledSources);
    }
  } catch (e) {}
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      answers: state.answers,
      bookmarks: state.bookmarks,
      dedupEnabled: state.dedupEnabled,
      prioritySource: state.prioritySource,
      enabledSources: Array.from(state.enabledSources)
    }));
  } catch (e) {}
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 2600);
}

function formatRoundTitle(s) {
  if (s.round === 12) return `${s.year}년 1·2회 통합 ${s.examType || '필기'}`;
  return `${s.year}년 ${s.round}회 ${s.examType || '필기'}`;
}

function renderMath(root) {
  if (!root) return;
  if (typeof katex !== 'undefined') {
    root.querySelectorAll('.math-expr').forEach(el => {
      if (el.children.length === 0 && (el.textContent.includes('\\') || el.textContent.includes('^') || el.textContent.includes('_'))) {
        try {
          katex.render(el.textContent, el, { throwOnError: false, displayMode: false });
        } catch (e) {}
      }
    });
  }
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(root, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
        { left: '\\[', right: '\\]', display: true }
      ],
      throwOnError: false
    });
  }
}

async function fetchSession(setId) {
  if (state.loadedSessions[setId]) return state.loadedSessions[setId];
  const meta = state.index.sessions.find(s => s.setId === setId);
  const res = await fetch('./' + meta.file);
  if (!res.ok) throw new Error('회차 데이터를 불러올 수 없습니다.');
  const data = await res.json();
  state.loadedSessions[setId] = data;
  return data;
}

function getSourceRank(sourceName) {
  if (sourceName === state.prioritySource) return -1;
  const idx = DEFAULT_PRIORITY.indexOf(sourceName);
  return idx === -1 ? 99 : idx;
}

// Compute filtered sessions (used by BOTH Round Mode & Subject Mode)
function getFilteredSessions(applyRoundStatusFilter = true) {
  const all = state.index?.sessions || [];
  let list = all.filter(s => {
    if (!state.enabledSources.has(s.source)) return false;
    if (state.yearFilter !== 'all' && String(s.year) !== state.yearFilter) return false;
    if (state.search.trim()) {
      const q = state.search.trim().toLowerCase();
      const hay = `${s.year} ${s.round}회 ${s.roundLabel} ${s.source}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Deduplicate by (year, round) using user's priority publisher if enabled
  if (state.dedupEnabled) {
    const bestByGroup = new Map();
    for (const s of list) {
      const prev = bestByGroup.get(s.duplicateGroup);
      if (!prev || getSourceRank(s.source) < getSourceRank(prev.source)) {
        bestByGroup.set(s.duplicateGroup, s);
      }
    }
    list = Array.from(bestByGroup.values()).sort(
      (a, b) => (b.year - a.year) || (b.round - a.round) || a.source.localeCompare(b.source, 'ko')
    );
  }

  if (!applyRoundStatusFilter) return list;

  const dupCounts = {};
  list.forEach(s => { dupCounts[s.duplicateGroup] = (dupCounts[s.duplicateGroup] || 0) + 1; });

  return list.filter(s => {
    if (state.filter === 'duplicate' && dupCounts[s.duplicateGroup] < 2) return false;
    if (state.filter === 'no-exp' && s.hasExplanation) return false;
    if (state.filter === 'wrong' && getSessionProgress(s.setId) === 0) return false;
    return true;
  });
}

function getSessionProgress(setId) {
  const prefix = setId + '_';
  let solved = 0;
  for (const k of Object.keys(state.answers)) {
    if (k.startsWith(prefix)) solved++;
  }
  return solved;
}

function renderHome() {
  const baseSessions = getFilteredSessions(false);
  const displaySessions = getFilteredSessions(true);

  const dupCounts = {};
  baseSessions.forEach(s => { dupCounts[s.duplicateGroup] = (dupCounts[s.duplicateGroup] || 0) + 1; });
  const dupGroupTotal = Object.values(dupCounts).filter(c => c > 1).length;
  const noExpCount = baseSessions.filter(s => !s.hasExplanation).length;
  const totalQ = baseSessions.reduce((acc, s) => acc + (s.questionCount || 0), 0);

  document.getElementById('statSessions').textContent = `${baseSessions.length}개`;
  document.getElementById('statQuestions').textContent = `${totalQ.toLocaleString()}문항`;
  document.getElementById('statDupGroups').textContent = `${dupGroupTotal}그룹`;
  document.getElementById('statNoExp').textContent = `${noExpCount}개`;

  document.getElementById('priorityWrap').classList.toggle('hidden', !state.dedupEnabled);
  document.getElementById('statusChipsRow').classList.toggle('hidden', state.homeMode !== 'round');
  document.getElementById('panelRoundMode').classList.toggle('hidden', state.homeMode !== 'round');
  document.getElementById('panelSubjectMode').classList.toggle('hidden', state.homeMode !== 'subject');
  document.getElementById('panelTheoryMode')?.classList.toggle('hidden', state.homeMode !== 'theory');

  if (state.homeMode === 'round') {
    renderSessionGrid(displaySessions, dupCounts);
  } else if (state.homeMode === 'subject') {
    renderGlobalSubjectMode(baseSessions);
  } else if (state.homeMode === 'theory' && typeof window.renderTheoryHome === 'function') {
    window.renderTheoryHome();
  }
}

function renderSessionGrid(list, dupCounts) {
  const grid = document.getElementById('sessionGrid');
  if (list.length === 0) {
    grid.innerHTML = `<div class="card" style="grid-column:1/-1;text-align:center;color:#64748b;">조건에 맞는 회차가 없습니다. 출판사 선택이나 필터를 확인해 주세요.</div>`;
    return;
  }

  grid.innerHTML = list.map(s => {
    const dupCnt = dupCounts[s.duplicateGroup] || 1;
    const solved = getSessionProgress(s.setId);
    return `
      <article class="card session-card">
        <div>
          <div class="sc-top">
            <div>
              <h3 class="sc-title">${formatRoundTitle(s)}</h3>
              <p class="sc-sub">${s.roundLabel || ''}</p>
            </div>
            <span class="badge badge-blue">${s.source}</span>
          </div>
          <div class="sc-badges" style="margin-top:8px;">
            ${dupCnt > 1 ? `<span class="badge badge-indigo">중복 ${dupCnt}종 · 교차 검증</span>` : ''}
            ${s.hasExplanation ? `<span class="badge badge-slate">해설 포함</span>` : `<span class="badge badge-amber">미해설 (추후 보강)</span>`}
          </div>
        </div>
        <div class="sc-foot">
          <span>${s.questionCount}문항${solved > 0 ? ` · 풀이 ${solved}` : ''}</span>
          <button type="button" data-open="${s.setId}" class="btn btn-dark btn-sm">풀기 시작</button>
        </div>
      </article>
    `;
  }).join('');

  grid.querySelectorAll('[data-open]').forEach(btn => {
    btn.addEventListener('click', () => openRoundSession(btn.getAttribute('data-open')));
  });
}

// =========================================================================
// GLOBAL SUBJECT MODE (All questions grouped by subject in 20-question sets)
// =========================================================================
function renderGlobalSubjectMode(baseSessions) {
  const subjects = state.index?.subjects || [];
  const cardsEl = document.getElementById('subjectCardsGrid');

  const subjData = subjects.map(subj => {
    const matchingSessions = baseSessions.filter(s => s.subjectCounts && s.subjectCounts[subj] > 0);
    const totalCount = matchingSessions.reduce((acc, s) => acc + s.subjectCounts[subj], 0);
    return { subj, matchingSessions, totalCount, setCount: Math.ceil(totalCount / 20) };
  });

  cardsEl.innerHTML = subjData.map(item => `
    <button type="button" data-gsubj="${item.subj}" class="subj-card ${state.selectedGlobalSubject === item.subj ? 'selected' : ''}">
      <h3>${item.subj}</h3>
      <div class="subj-card-meta">총 <strong>${item.totalCount.toLocaleString()}문항</strong> · 20문제씩 <strong>${item.setCount}세트</strong></div>
      <div class="subj-card-meta">${item.matchingSessions.length}개 회차 포함</div>
    </button>
  `).join('');

  cardsEl.querySelectorAll('[data-gsubj]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.selectedGlobalSubject = btn.getAttribute('data-gsubj');
      renderGlobalSubjectMode(baseSessions);
    });
  });

  const panel = document.getElementById('subjectSetsPanel');
  const active = subjData.find(x => x.subj === state.selectedGlobalSubject);
  if (!active || active.totalCount === 0) {
    panel.classList.add('hidden');
    return;
  }

  panel.classList.remove('hidden');
  document.getElementById('selectedSubjectTitle').textContent = `${active.subj} — 20문제 단위 세트 선택`;
  document.getElementById('selectedSubjectMeta').textContent = `현재 필터 기준 총 ${active.totalCount.toLocaleString()}문항 (${active.setCount}개 세트, 선택한 세트의 회차만 가볍게 불러옵니다)`;

  // Build virtual 20-question slice map across matchingSessions
  const sets = [];
  let cursor = 0;
  for (let setIdx = 0; setIdx < active.setCount; setIdx++) {
    const startGlobal = setIdx * 20;
    const endGlobal = Math.min(active.totalCount, startGlobal + 20);
    // Find label of first session in this slice
    let acc = 0, firstLabel = '';
    for (const s of active.matchingSessions) {
      const cnt = s.subjectCounts[active.subj];
      if (acc + cnt > startGlobal) {
        firstLabel = `${s.year}년 ${s.round === 12 ? '1·2회' : s.round + '회'} (${s.source})`;
        break;
      }
      acc += cnt;
    }
    sets.push({ setIdx, startGlobal, endGlobal, firstLabel });
  }

  const setsGrid = document.getElementById('subjectSetsGrid');
  setsGrid.innerHTML = sets.map(st => `
    <button type="button" data-set-idx="${st.setIdx}" class="set-btn">
      <strong>${st.setIdx + 1}세트 (${st.startGlobal + 1}~${st.endGlobal}번)</strong>
      <span>${st.firstLabel}</span>
    </button>
  `).join('');

  setsGrid.querySelectorAll('[data-set-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.getAttribute('data-set-idx'));
      openSubjectSlice(active.subj, active.matchingSessions, idx * 20, 20, `${active.subj} ${idx + 1}세트`);
    });
  });

  document.getElementById('btnRandomSubject20').onclick = () => {
    openRandomSubject20(active.subj, active.matchingSessions);
  };
}

async function openSubjectSlice(subj, matchingSessions, offset, limit, title) {
  showToast('선택한 20문항 세트를 불러오는 중...');
  // Identify only the sessions overlapping [offset, offset + limit)
  const needed = [];
  let acc = 0;
  for (const s of matchingSessions) {
    const cnt = s.subjectCounts[subj];
    const sStart = acc;
    const sEnd = acc + cnt;
    if (sEnd > offset && sStart < offset + limit) {
      needed.push({ meta: s, sliceStart: Math.max(0, offset - sStart), sliceEnd: Math.min(cnt, offset + limit - sStart) });
    }
    acc = sEnd;
    if (acc >= offset + limit) break;
  }

  const collected = [];
  for (const item of needed) {
    const ds = await fetchSession(item.meta.setId);
    const subjQs = ds.questions.filter(q => q.subject === subj);
    const picked = subjQs.slice(item.sliceStart, item.sliceEnd);
    picked.forEach(q => collected.push({ ...q, _meta: item.meta }));
  }

  launchSubjectExam(title, `${collected.length}문항 (과목 집중)`, collected);
}

async function openRandomSubject20(subj, matchingSessions) {
  if (matchingSessions.length === 0) return;
  showToast('랜덤 20문항을 추출하는 중...');
  // Pick up to 5 random sessions to keep network fetches super lightweight
  const shuffled = [...matchingSessions].sort(() => Math.random() - 0.5).slice(0, Math.min(6, matchingSessions.length));
  const pool = [];
  for (const s of shuffled) {
    const ds = await fetchSession(s.setId);
    ds.questions.filter(q => q.subject === subj).forEach(q => pool.push({ ...q, _meta: s }));
  }
  const picked = pool.sort(() => Math.random() - 0.5).slice(0, 20);
  launchSubjectExam(`${subj} 랜덤 20문항`, '모의 세트', picked);
}

function launchSubjectExam(title, sourceLabel, questions) {
  state.examMode = 'subject_set';
  state.currentSetId = null;
  state.examTitle = title;
  state.examSourceLabel = sourceLabel;
  state.examHasExp = true;
  state.activeQuestions = questions;
  state.currentSubjectTab = 'all';
  state.currentIdx = 0;
  state.batchPage = 0;

  document.getElementById('viewHome').classList.add('hidden');
  document.getElementById('viewExam').classList.remove('hidden');
  document.getElementById('subjectTabs').innerHTML = '';
  renderExam();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// =========================================================================
// ROUND EXAM MODE (With 20-question Subject Tabs + Single / Batch20 Toggle)
// =========================================================================
async function openRoundSession(setId) {
  try {
    await fetchSession(setId);
  } catch (e) {
    showToast('회차 데이터를 불러오지 못했습니다.');
    return;
  }
  const meta = state.index.sessions.find(s => s.setId === setId);
  state.examMode = 'round';
  state.currentSetId = setId;
  state.examTitle = formatRoundTitle(meta);
  state.examSourceLabel = meta.source;
  state.examHasExp = meta.hasExplanation;
  state.currentSubjectTab = 'all';
  state.currentIdx = 0;
  state.batchPage = 0;

  document.getElementById('viewHome').classList.add('hidden');
  document.getElementById('viewExam').classList.remove('hidden');
  renderSubjectTabs();
  renderExam();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderSubjectTabs() {
  const el = document.getElementById('subjectTabs');
  if (state.examMode !== 'round') { el.innerHTML = ''; return; }
  const ds = state.loadedSessions[state.currentSetId];
  const counts = {};
  ds.questions.forEach(q => { counts[q.subject] = (counts[q.subject] || 0) + 1; });
  const subjects = ['all', ...Object.keys(counts)];

  el.innerHTML = subjects.map(s => `
    <button type="button" data-subj="${s}" class="subj-tab ${state.currentSubjectTab === s ? 'active' : ''}">
      ${s === 'all' ? `전체 (${ds.questions.length})` : `${s} (${counts[s]})`}
    </button>
  `).join('');

  el.querySelectorAll('[data-subj]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentSubjectTab = btn.getAttribute('data-subj');
      state.currentIdx = 0;
      state.batchPage = 0;
      renderSubjectTabs();
      renderExam();
    });
  });
}

function getVisibleQuestions() {
  if (state.examMode === 'subject_set') return state.activeQuestions;
  const ds = state.loadedSessions[state.currentSetId];
  if (!ds) return [];
  const meta = state.index.sessions.find(s => s.setId === state.currentSetId);
  const base = state.currentSubjectTab === 'all'
    ? ds.questions
    : ds.questions.filter(q => q.subject === state.currentSubjectTab);
  return base.map(q => ({ ...q, _meta: meta }));
}

function renderExam() {
  const questions = getVisibleQuestions();
  if (questions.length === 0) return;

  document.getElementById('examTitle').textContent = state.examTitle;
  document.getElementById('examSource').textContent = state.examSourceLabel;
  document.getElementById('examNoExp').classList.toggle('hidden', state.examHasExp);

  document.getElementById('btnViewSingle').classList.toggle('active', state.viewMode === 'single');
  document.getElementById('btnViewBatch20').classList.toggle('active', state.viewMode === 'batch20');

  document.getElementById('singleModeWrap').classList.toggle('hidden', state.viewMode !== 'single');
  document.getElementById('batchModeWrap').classList.toggle('hidden', state.viewMode !== 'batch20');
  document.getElementById('mobileNav').classList.toggle('hidden', state.viewMode !== 'single');

  if (state.viewMode === 'single') {
    renderSingleQuestion(questions);
  } else {
    renderBatch20(questions);
  }
}

function renderSingleQuestion(questions) {
  if (state.currentIdx >= questions.length) state.currentIdx = 0;
  const q = questions[state.currentIdx];
  const meta = q._meta;
  const chosen = state.answers[q.id];
  const nums = ['①', '②', '③', '④'];

  const siblings = state.index.sessions.filter(s => s.duplicateGroup === meta.duplicateGroup);
  const btnCross = document.getElementById('btnCrossCheck');
  if (siblings.length > 1) {
    btnCross.classList.remove('hidden');
    btnCross.textContent = `교차 비교 (${siblings.length}종)`;
  } else {
    btnCross.classList.add('hidden');
  }

  document.getElementById('qNum').textContent = `${q.number}번`;
  const originTag = document.getElementById('qOriginTag');
  if (state.examMode === 'subject_set') {
    originTag.textContent = `${formatRoundTitle(meta)} · ${meta.source}`;
    originTag.classList.remove('hidden');
  } else {
    originTag.classList.add('hidden');
  }
  document.getElementById('qSubj').textContent = q.subject;
  const catEl = document.getElementById('qCat');
  if (q.category) { catEl.textContent = q.category; catEl.classList.remove('hidden'); }
  else catEl.classList.add('hidden');

  const ckBtn = document.getElementById('qCheatkeyBtn');
  const ckEntry = window.THEORY_BY_QID && window.THEORY_BY_QID[q.id];
  if (ckBtn && ckEntry) {
    ckBtn.textContent = `📖 ${ckEntry.partName} 치트키 ${ckEntry.number} (p.${ckEntry.startPage})`;
    ckBtn.classList.remove('hidden');
    ckBtn.onclick = () => { if (typeof window.openTheoryDetail === 'function') window.openTheoryDetail(ckEntry.id); };
  } else if (ckBtn) {
    ckBtn.classList.add('hidden');
  }

  const vidEl = document.getElementById('qVideoLink');
  if (q.videoId) {
    vidEl.href = `https://www.youtube.com/watch?v=${q.videoId}${q.ytSeconds ? `&t=${q.ytSeconds}s` : ''}`;
    vidEl.classList.remove('hidden');
  } else if (q.videoUrl) {
    vidEl.href = q.videoUrl;
    vidEl.classList.remove('hidden');
  } else {
    vidEl.classList.add('hidden');
  }

  document.getElementById('btnBookmark').textContent = state.bookmarks[q.id] ? '★ 북마크됨' : '☆ 북마크';
  document.getElementById('qStem').innerHTML = q.stem;

  const diagWrap = document.getElementById('qDiagWrap');
  const diagEl = document.getElementById('qDiag');
  if (q.diagram && q.diagram.trim()) {
    diagWrap.classList.remove('hidden');
    diagEl.innerHTML = q.diagram;
  } else {
    diagWrap.classList.add('hidden');
    diagEl.innerHTML = '';
  }

  const chEl = document.getElementById('qChoices');
  chEl.innerHTML = q.choices.map((c, i) => {
    const val = i + 1;
    let cls = '';
    if (chosen) {
      if (val === q.answer) cls = 'correct';
      else if (val === chosen) cls = 'wrong';
    }
    return `<button type="button" data-choice="${val}" class="choice-btn ${cls}"><span class="choice-num">${nums[i] || val}</span><span class="choice-body">${c}</span></button>`;
  }).join('');

  chEl.querySelectorAll('[data-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.answers[q.id] = Number(btn.getAttribute('data-choice'));
      saveState();
      renderExam();
    });
  });

  const expBox = document.getElementById('qExpBox');
  if (chosen) {
    const isOk = chosen === q.answer;
    expBox.classList.remove('hidden');
    expBox.className = `q-exp-box ${isOk ? 'ok' : 'no'}`;
    document.getElementById('qResLabel').textContent = isOk ? '정답입니다!' : '오답입니다';
    document.getElementById('qCorrectAns').textContent = `정답: ${nums[q.answer - 1] || q.answer}`;

    const fEl = document.getElementById('qFormula');
    if (q.formula && q.formula.trim()) { fEl.innerHTML = `<strong>핵심 공식:</strong> ${q.formula}`; fEl.classList.remove('hidden'); }
    else fEl.classList.add('hidden');

    const tEl = document.getElementById('qTip');
    if (q.tip && q.tip.trim()) { tEl.innerHTML = `<strong>암기/풀이 팁:</strong> ${q.tip}`; tEl.classList.remove('hidden'); }
    else tEl.classList.add('hidden');

    const bodyEl = document.getElementById('qExpBody');
    if (q.explanation && q.explanation.replace(/<[^>]+>/g, '').trim()) {
      bodyEl.innerHTML = q.explanation;
    } else {
      bodyEl.innerHTML = `<span class="badge badge-amber" style="margin-right:6px;">해설 준비 중</span>이 회차는 문제·정답만 먼저 통합된 상태입니다.`;
    }
  } else {
    expBox.classList.add('hidden');
  }

  const isFirst = state.currentIdx === 0;
  const isLast = state.currentIdx === questions.length - 1;
  document.getElementById('btnPrev').disabled = isFirst;
  document.getElementById('btnNext').disabled = isLast;
  document.getElementById('btnPrevM').disabled = isFirst;
  document.getElementById('btnNextM').disabled = isLast;
  document.getElementById('mobileIdx').textContent = `${state.currentIdx + 1} / ${questions.length}`;

  let solved = 0, correct = 0;
  questions.forEach(item => {
    const a = state.answers[item.id];
    if (a) { solved++; if (a === item.answer) correct++; }
  });
  document.getElementById('omrStat').textContent = `정답 ${correct} / 풀이 ${solved}`;

  const omr = document.getElementById('omrGrid');
  omr.innerHTML = questions.map((item, idx) => {
    const a = state.answers[item.id];
    const cls = `${a ? (a === item.answer ? 'ok' : 'no') : ''} ${idx === state.currentIdx ? 'cur' : ''}`;
    return `<button type="button" data-jump="${idx}" class="omr-btn ${cls}">${state.examMode === 'subject_set' ? (idx + 1) : item.number}</button>`;
  }).join('');
  omr.querySelectorAll('[data-jump]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.currentIdx = Number(btn.getAttribute('data-jump'));
      renderExam();
    });
  });

  renderMath(document.getElementById('questionArea'));
}

// =========================================================================
// BATCH 20-QUESTION VIEW (20 questions per page)
// =========================================================================
function renderBatch20(questions) {
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(questions.length / pageSize));
  if (state.batchPage >= totalPages) state.batchPage = totalPages - 1;
  const start = state.batchPage * pageSize;
  const slice = questions.slice(start, start + pageSize);
  const nums = ['①', '②', '③', '④'];

  let solved = 0, correct = 0;
  slice.forEach(q => {
    const a = state.answers[q.id];
    if (a) { solved++; if (a === q.answer) correct++; }
  });

  document.getElementById('batchSummary').textContent = `현재 20문항 보기 (${start + 1}~${start + slice.length} / 총 ${questions.length}문항) · 정답 ${correct}/${solved}`;
  document.getElementById('batchPageLabel').textContent = `${state.batchPage + 1} / ${totalPages} 페이지`;
  document.getElementById('btnBatchPrev').disabled = state.batchPage === 0;
  document.getElementById('btnBatchNext').disabled = state.batchPage >= totalPages - 1;

  const listEl = document.getElementById('batchList');
  listEl.innerHTML = slice.map((q, localIdx) => {
    const chosen = state.answers[q.id];
    const meta = q._meta;
    const siblings = state.index.sessions.filter(s => s.duplicateGroup === meta.duplicateGroup);
    const hasExp = q.explanation && q.explanation.replace(/<[^>]+>/g, '').trim().length > 0;
    return `
      <article class="card" id="batch_q_${q.id}">
        <div class="q-head">
          <div class="q-head-left">
            <span class="q-num">${q.number}번</span>
            ${state.examMode === 'subject_set' ? `<span class="badge badge-slate">${formatRoundTitle(meta)} · ${meta.source}</span>` : ''}
            <span class="q-subj">${q.subject}</span>
          </div>
          <div class="q-head-right">
            ${siblings.length > 1 ? `<button type="button" data-batch-cross="${q.id}" class="btn btn-indigo btn-sm">교차 비교 (${siblings.length}종)</button>` : ''}
          </div>
        </div>
        <div class="q-stem">${q.stem}</div>
        ${q.diagram && q.diagram.trim() ? `<div class="q-diag-wrap"><div class="q-diag">${q.diagram}</div></div>` : ''}
        <div class="q-choices">
          ${q.choices.map((c, i) => {
            const val = i + 1;
            let cls = '';
            if (chosen) {
              if (val === q.answer) cls = 'correct';
              else if (val === chosen) cls = 'wrong';
            }
            return `<button type="button" data-bq="${q.id}" data-bch="${val}" class="choice-btn ${cls}"><span class="choice-num">${nums[i] || val}</span><span class="choice-body">${c}</span></button>`;
          }).join('')}
        </div>
        ${chosen ? `
          <div class="q-exp-box ${chosen === q.answer ? 'ok' : 'no'}">
            <div class="q-exp-head">
              <strong>${chosen === q.answer ? '정답입니다!' : '오답입니다'}</strong>
              <span>정답: ${nums[q.answer - 1] || q.answer}</span>
            </div>
            ${q.formula ? `<div class="q-formula"><strong>핵심 공식:</strong> ${q.formula}</div>` : ''}
            <div class="q-exp-body">${hasExp ? q.explanation : '<span class="badge badge-amber">해설 준비 중</span> 추후 보강 예정입니다.'}</div>
          </div>
        ` : ''}
      </article>
    `;
  }).join('');

  listEl.querySelectorAll('[data-bq]').forEach(btn => {
    btn.addEventListener('click', () => {
      const qid = btn.getAttribute('data-bq');
      const val = Number(btn.getAttribute('data-bch'));
      state.answers[qid] = val;
      saveState();
      renderBatch20(questions);
    });
  });

  listEl.querySelectorAll('[data-batch-cross]').forEach(btn => {
    btn.addEventListener('click', () => {
      const qid = btn.getAttribute('data-batch-cross');
      const found = slice.find(x => x.id === qid);
      if (found) openCrossCheckForQuestion(found);
    });
  });

  renderMath(listEl);
}

async function openCrossCheckForQuestion(q) {
  const meta = q._meta;
  const siblings = state.index.sessions.filter(s => s.duplicateGroup === meta.duplicateGroup);
  const nums = ['①', '②', '③', '④'];

  document.getElementById('crossSubtitle').textContent = `${formatRoundTitle(meta)} ${q.number}번 문항 · 출처 ${siblings.length}종 비교`;
  const grid = document.getElementById('crossGrid');
  grid.innerHTML = '<div class="card">다른 출처 회차 JSON을 불러오는 중...</div>';
  document.getElementById('modalCross').classList.remove('hidden');

  const loaded = await Promise.all(siblings.map(s => fetchSession(s.setId).catch(() => null)));
  grid.innerHTML = loaded.map((sData, idx) => {
    const sibMeta = siblings[idx];
    if (!sData) return `<div class="card"><strong>${sibMeta.source}</strong>: 불러오기 실패</div>`;
    const item = sData.questions.find(x => x.number === q.number);
    if (!item) return `<div class="card"><strong>${sibMeta.source}</strong>: ${q.number}번 문항 없음</div>`;
    return `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span class="badge badge-blue">${sibMeta.source}</span>
          <strong style="font-size:12px;color:#059669;">정답: ${nums[item.answer - 1] || item.answer}</strong>
        </div>
        <div style="font-size:13.5px;line-height:1.6;margin-bottom:8px;">${item.stem}</div>
        ${item.diagram ? `<div style="margin:8px 0;">${item.diagram}</div>` : ''}
        <div style="font-size:12.5px;line-height:1.6;color:#334155;">
          ${item.choices.map((c, i) => `<div style="${i + 1 === item.answer ? 'font-weight:700;color:#047857;' : ''}">${nums[i] || (i + 1)} ${c}</div>`).join('')}
        </div>
      </div>
    `;
  }).join('');
  renderMath(grid);
}

function setupScratchpad() {
  const canvas = document.getElementById('padCanvas');
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
    ctx.strokeStyle = state.penColor;
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
  document.getElementById('btnClearPad').addEventListener('click', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
  document.querySelectorAll('[data-pen]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.penColor = btn.getAttribute('data-pen');
      document.querySelectorAll('[data-pen]').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  return resize;
}

function triggerOfflineCache(includeImages) {
  document.getElementById('modalOffline').classList.add('hidden');
  document.getElementById('offlineBar').classList.remove('hidden');
  const urls = ['./data/index.json', './data/theory_map.json', ...state.index.sessions.map(s => './' + s.file)];
  if (includeImages && Array.isArray(state.index.imageAssets)) urls.push(...state.index.imageAssets);
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    document.getElementById('offlineStatus').textContent = `오프라인 저장 시작 (${urls.length}개 파일)...`;
    navigator.serviceWorker.controller.postMessage({ type: 'CACHE_URLS', urls });
  } else {
    document.getElementById('offlineStatus').textContent = 'HTTPS 주소로 새로고침한 뒤 다시 눌러주세요.';
    document.getElementById('offlinePct').textContent = '';
  }
}

function renderPublisherChips() {
  const wrap = document.getElementById('publisherChips');
  const sources = state.index?.sources || [];
  wrap.innerHTML = sources.map(src => `
    <button type="button" data-pub="${src}" class="pub-chip ${state.enabledSources.has(src) ? 'active' : ''}">${src}</button>
  `).join('');
  wrap.querySelectorAll('[data-pub]').forEach(btn => {
    btn.addEventListener('click', () => {
      const src = btn.getAttribute('data-pub');
      if (state.enabledSources.has(src)) state.enabledSources.delete(src);
      else state.enabledSources.add(src);
      saveState();
      renderPublisherChips();
      renderHome();
    });
  });
}

async function init() {
  loadState();
  const resizePad = setupScratchpad();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data.type === 'CACHE_PROGRESS') {
        const pct = Math.round((e.data.done / e.data.total) * 100);
        document.getElementById('offlineStatus').textContent = `오프라인 저장 중 (${e.data.done} / ${e.data.total})`;
        document.getElementById('offlinePct').textContent = `${pct}%`;
        document.getElementById('offlineFill').style.width = `${pct}%`;
      } else if (e.data.type === 'CACHE_DONE') {
        document.getElementById('offlineStatus').textContent = `오프라인 저장 완료! (${e.data.total}개 파일)`;
        document.getElementById('offlinePct').textContent = '100%';
        document.getElementById('offlineFill').style.width = '100%';
        showToast('오프라인 저장이 완료되었습니다.');
        setTimeout(() => document.getElementById('offlineBar').classList.add('hidden'), 1800);
      }
    });
  }

  try {
    const res = await fetch('./data/index.json');
    state.index = await res.json();
  } catch (e) {
    document.getElementById('sessionGrid').innerHTML = `<div class="card" style="grid-column:1/-1;"><strong>데이터를 불러오지 못했습니다.</strong></div>`;
    return;
  }

  // Default all publishers enabled if none saved
  if (state.enabledSources.size === 0) {
    (state.index.sources || []).forEach(s => state.enabledSources.add(s));
  }

  // Priority publisher dropdown
  const priSelect = document.getElementById('selectPriority');
  (state.index.sources || []).forEach(src => {
    const opt = document.createElement('option');
    opt.value = src;
    opt.textContent = src;
    if (src === state.prioritySource) opt.selected = true;
    priSelect.appendChild(opt);
  });

  // Year dropdown
  const yearSelect = document.getElementById('selectYear');
  const years = Array.from(new Set(state.index.sessions.map(s => s.year))).sort((a, b) => b - a);
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = `${y}년`;
    yearSelect.appendChild(opt);
  });

  document.getElementById('chkDedup').checked = state.dedupEnabled;
  renderPublisherChips();
  renderHome();

  // Mode tabs
  const setHomeTab = (mode) => {
    state.homeMode = mode;
    document.getElementById('tabModeRound').classList.toggle('active', mode === 'round');
    document.getElementById('tabModeSubject').classList.toggle('active', mode === 'subject');
    document.getElementById('tabModeTheory')?.classList.toggle('active', mode === 'theory');
    renderHome();
  };
  document.getElementById('tabModeRound').addEventListener('click', () => setHomeTab('round'));
  document.getElementById('tabModeSubject').addEventListener('click', () => setHomeTab('subject'));
  document.getElementById('tabModeTheory')?.addEventListener('click', () => setHomeTab('theory'));

  // Dedup & Publisher filter events
  document.getElementById('chkDedup').addEventListener('change', e => {
    state.dedupEnabled = e.target.checked;
    saveState();
    renderHome();
  });
  priSelect.addEventListener('change', e => {
    state.prioritySource = e.target.value;
    saveState();
    renderHome();
  });
  document.getElementById('btnPubAll').addEventListener('click', () => {
    (state.index.sources || []).forEach(s => state.enabledSources.add(s));
    saveState();
    renderPublisherChips();
    renderHome();
  });
  document.getElementById('btnPubNone').addEventListener('click', () => {
    state.enabledSources.clear();
    saveState();
    renderPublisherChips();
    renderHome();
  });

  document.querySelectorAll('#statusChipsRow .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filter = btn.getAttribute('data-filter');
      document.querySelectorAll('#statusChipsRow .chip').forEach(b => b.classList.toggle('active', b === btn));
      renderHome();
    });
  });
  yearSelect.addEventListener('change', e => { state.yearFilter = e.target.value; renderHome(); });
  document.getElementById('searchInput').addEventListener('input', e => { state.search = e.target.value; renderHome(); });

  const goHome = () => {
    state.currentSetId = null;
    document.getElementById('viewExam').classList.add('hidden');
    document.getElementById('viewTheoryDetail')?.classList.add('hidden');
    document.getElementById('mobileNav').classList.add('hidden');
    document.getElementById('viewHome').classList.remove('hidden');
    renderHome();
  };
  document.getElementById('btnHome').addEventListener('click', goHome);
  document.getElementById('btnBack').addEventListener('click', goHome);

  // Single vs Batch20 toggle
  document.getElementById('btnViewSingle').addEventListener('click', () => {
    state.viewMode = 'single';
    renderExam();
  });
  document.getElementById('btnViewBatch20').addEventListener('click', () => {
    state.viewMode = 'batch20';
    state.batchPage = Math.floor(state.currentIdx / 20);
    renderExam();
  });
  document.getElementById('btnBatchPrev').addEventListener('click', () => {
    if (state.batchPage > 0) { state.batchPage--; renderExam(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
  document.getElementById('btnBatchNext').addEventListener('click', () => {
    const qs = getVisibleQuestions();
    if ((state.batchPage + 1) * 20 < qs.length) { state.batchPage++; renderExam(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });

  const goPrev = () => { if (state.currentIdx > 0) { state.currentIdx--; renderExam(); } };
  const goNext = () => {
    const qs = getVisibleQuestions();
    if (state.currentIdx < qs.length - 1) { state.currentIdx++; renderExam(); }
  };
  document.getElementById('btnPrev').addEventListener('click', goPrev);
  document.getElementById('btnNext').addEventListener('click', goNext);
  document.getElementById('btnPrevM').addEventListener('click', goPrev);
  document.getElementById('btnNextM').addEventListener('click', goNext);

  document.getElementById('btnBookmark').addEventListener('click', () => {
    const q = getVisibleQuestions()[state.currentIdx];
    if (!q) return;
    if (state.bookmarks[q.id]) delete state.bookmarks[q.id];
    else state.bookmarks[q.id] = true;
    saveState();
    renderExam();
  });

  document.getElementById('btnResetSession').addEventListener('click', () => {
    getVisibleQuestions().forEach(q => { delete state.answers[q.id]; });
    saveState();
    renderExam();
    showToast('현재 표시된 문항들의 풀이 기록을 초기화했습니다.');
  });

  document.getElementById('btnPadToggle').addEventListener('click', () => {
    const card = document.getElementById('padCard');
    card.classList.toggle('hidden');
    if (!card.classList.contains('hidden')) setTimeout(resizePad, 40);
  });

  document.getElementById('btnCrossCheck').addEventListener('click', () => {
    const q = getVisibleQuestions()[state.currentIdx];
    if (q) openCrossCheckForQuestion(q);
  });
  document.getElementById('btnCloseCross').addEventListener('click', () => document.getElementById('modalCross').classList.add('hidden'));

  document.getElementById('btnZoomDiag').addEventListener('click', () => {
    document.getElementById('zoomContent').innerHTML = document.getElementById('qDiag').innerHTML;
    document.getElementById('modalZoom').classList.remove('hidden');
  });
  document.getElementById('btnCloseZoom').addEventListener('click', () => document.getElementById('modalZoom').classList.add('hidden'));

  document.getElementById('btnOfflineModal').addEventListener('click', () => document.getElementById('modalOffline').classList.remove('hidden'));
  document.getElementById('btnCloseOffline').addEventListener('click', () => document.getElementById('modalOffline').classList.add('hidden'));
  document.getElementById('btnCacheJsonOnly').addEventListener('click', () => triggerOfflineCache(false));
  document.getElementById('btnCacheEverything').addEventListener('click', () => triggerOfflineCache(true));

  document.getElementById('btnBackup').addEventListener('click', () => document.getElementById('modalBackup').classList.remove('hidden'));
  document.getElementById('btnCloseBackup').addEventListener('click', () => document.getElementById('modalBackup').classList.add('hidden'));
  document.getElementById('btnExportBackup').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ answers: state.answers, bookmarks: state.bookmarks }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '전기기사_CBT_학습기록_백업.json';
    a.click();
    showToast('학습 기록 백업 파일을 내려받았습니다.');
  });
  document.getElementById('inputImportBackup').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed = JSON.parse(r.result);
        if (parsed.answers) state.answers = parsed.answers;
        if (parsed.bookmarks) state.bookmarks = parsed.bookmarks;
        saveState();
        renderHome();
        if (!document.getElementById('viewExam').classList.contains('hidden')) renderExam();
        document.getElementById('modalBackup').classList.add('hidden');
        showToast('학습 기록을 복원했습니다.');
      } catch (err) {
        showToast('올바른 백업 JSON 파일이 아닙니다.');
      }
    };
    r.readAsText(file);
  });

  document.addEventListener('keydown', e => {
    if (document.getElementById('viewExam').classList.contains('hidden') || state.viewMode !== 'single') return;
    if (['1', '2', '3', '4'].includes(e.key)) {
      const q = getVisibleQuestions()[state.currentIdx];
      if (!q) return;
      state.answers[q.id] = Number(e.key);
      saveState();
      renderExam();
    } else if (e.key === 'ArrowLeft') goPrev();
    else if (e.key === 'ArrowRight') goNext();
  });
}

window.addEventListener('DOMContentLoaded', init);
