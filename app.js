const STORAGE_KEY = 'electric_cbt_full_state_v2';
const DEFAULT_PRIORITY = [
  '다산에듀', '김영북스', '한솔아카데미', '테스트나라', '핵담',
  '파워텔', '엔지니어랩', '전기요금', '엔트', '전자문제집'
];

const state = {
  index: null,
  loadedSessions: {},
  answers: {},
  bookmarks: {},
  homeMode: 'round',          // 'round' | 'subject'
  filter: 'all',              // 'all' | 'duplicate' | 'wrong'
  enabledSources: new Set(),
  dedupEnabled: false,
  prioritySource: '다산에듀',
  yearFilter: 'all',          // Used in round mode
  subjectYears: new Set(),    // Used in subject mode (checkboxes + range)
  search: '',
  selectedGlobalSubject: null,

  // Study / Mock options
  showAnswerExp: true,        // Global checkbox: show/hide answer & explanation while solving
  manualExpOpen: new Set(),   // Per-question peek toggle when showAnswerExp is false
  randomDedup: true,          // Pre-launch checkbox for random 20-question mock set

  // Random 20-question mock state
  isRandomMock: false,
  randomRaw20: [],
  randomPool: [],
  randomDupIds: new Set(),

  // Active exam context
  examMode: 'round',          // 'round' | 'subject_set'
  examTitle: '',
  examSourceLabel: '',
  examHasExp: true,
  currentSetId: null,
  currentSubjectTab: 'all',
  activeQuestions: [],        // Used in subject_set mode (each item has _meta)
  viewMode: 'single',         // 'single' | 'batch20'
  currentIdx: 0,
  batchPage: 0,
  penColor: '#0f172a'
};

function migrateSourceName(name) {
  return name === '전자문제집(미해설)' ? '전자문제집' : name;
}

function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    state.answers = raw.answers || {};
    state.bookmarks = raw.bookmarks || {};
    if (typeof raw.dedupEnabled === 'boolean') state.dedupEnabled = raw.dedupEnabled;
    if (raw.prioritySource) state.prioritySource = migrateSourceName(raw.prioritySource);
    if (Array.isArray(raw.enabledSources) && raw.enabledSources.length > 0) {
      state.enabledSources = new Set(raw.enabledSources.map(migrateSourceName));
    }
    if (Array.isArray(raw.subjectYears) && raw.subjectYears.length > 0) {
      state.subjectYears = new Set(raw.subjectYears.map(Number));
    }
    if (typeof raw.showAnswerExp === 'boolean') state.showAnswerExp = raw.showAnswerExp;
    if (typeof raw.randomDedup === 'boolean') state.randomDedup = raw.randomDedup;
  } catch (e) {}
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      answers: state.answers,
      bookmarks: state.bookmarks,
      dedupEnabled: state.dedupEnabled,
      prioritySource: state.prioritySource,
      enabledSources: Array.from(state.enabledSources),
      subjectYears: Array.from(state.subjectYears),
      showAnswerExp: state.showAnswerExp,
      randomDedup: state.randomDedup
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

function getAllYearsDesc() {
  return Array.from(new Set((state.index?.sessions || []).map(s => Number(s.year)))).sort((a, b) => b - a);
}

// Compute filtered sessions (used by BOTH Round Mode & Subject Mode)
function getFilteredSessions(applyRoundStatusFilter = true) {
  const all = state.index?.sessions || [];
  let list = all.filter(s => {
    if (!state.enabledSources.has(s.source)) return false;
    if (state.homeMode === 'subject') {
      if (!state.subjectYears.has(Number(s.year))) return false;
    } else {
      if (state.yearFilter !== 'all' && String(s.year) !== state.yearFilter) return false;
    }
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
  const expSessionCount = baseSessions.filter(s => s.hasExplanation).length;
  const totalQ = baseSessions.reduce((acc, s) => acc + (s.questionCount || 0), 0);

  document.getElementById('statSessions').textContent = `${baseSessions.length}개`;
  document.getElementById('statQuestions').textContent = `${totalQ.toLocaleString()}문항`;
  document.getElementById('statDupGroups').textContent = `${dupGroupTotal}그룹`;
  document.getElementById('statExpSessions').textContent = `${expSessionCount}개`;

  document.getElementById('priorityWrap').classList.toggle('hidden', !state.dedupEnabled);
  document.getElementById('selectYear').classList.toggle('hidden', state.homeMode === 'subject');
  document.getElementById('statusChipsRow').classList.toggle('hidden', state.homeMode !== 'round');
  document.getElementById('panelRoundMode').classList.toggle('hidden', state.homeMode !== 'round');
  document.getElementById('panelSubjectMode').classList.toggle('hidden', state.homeMode !== 'subject');
  document.getElementById('panelTheoryMode')?.classList.toggle('hidden', state.homeMode !== 'theory');

  if (state.homeMode === 'round') {
    renderSessionGrid(displaySessions, dupCounts);
  } else if (state.homeMode === 'subject') {
    renderSubjectYearFilter();
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
            ${s.hasExplanation ? `<span class="badge badge-slate">해설 포함</span>` : `<span class="badge badge-amber">미해설</span>`}
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
// SUBJECT MODE: YEAR CHECKBOXES + RANGE FILTER
// =========================================================================
function renderSubjectYearFilter() {
  const allYears = getAllYearsDesc();
  const grid = document.getElementById('subjectYearCheckboxes');
  const selectedArr = allYears.filter(y => state.subjectYears.has(y));

  const summaryEl = document.getElementById('sySelectedSummary');
  if (selectedArr.length === 0) {
    summaryEl.textContent = '선택된 연도 없음 (연도를 1개 이상 선택하세요)';
  } else if (selectedArr.length === allYears.length) {
    summaryEl.textContent = `전체 ${allYears.length}개 연도 (${allYears[allYears.length - 1]}~${allYears[0]}년)`;
  } else {
    summaryEl.textContent = `${selectedArr.length}개 연도 선택됨 (${selectedArr[selectedArr.length - 1]}~${selectedArr[0]}년)`;
  }

  grid.innerHTML = allYears.map(y => {
    const checked = state.subjectYears.has(y);
    return `
      <label class="year-chk ${checked ? 'checked' : ''}">
        <input type="checkbox" data-sy-year="${y}" ${checked ? 'checked' : ''} />
        <span>${y}년</span>
      </label>
    `;
  }).join('');

  grid.querySelectorAll('[data-sy-year]').forEach(chk => {
    chk.addEventListener('change', e => {
      const yr = Number(chk.getAttribute('data-sy-year'));
      if (e.target.checked) state.subjectYears.add(yr);
      else state.subjectYears.delete(yr);
      saveState();
      renderHome();
    });
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
  document.getElementById('selectedSubjectMeta').textContent = `선택 연도·출판사 기준 총 ${active.totalCount.toLocaleString()}문항 (${active.setCount}개 세트)`;

  const sets = [];
  for (let setIdx = 0; setIdx < active.setCount; setIdx++) {
    const startGlobal = setIdx * 20;
    const endGlobal = Math.min(active.totalCount, startGlobal + 20);
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

  document.getElementById('chkRandomDedup').checked = state.randomDedup;
  document.getElementById('btnRandomSubject20').onclick = () => {
    openRandomSubject20(active.subj, active.matchingSessions);
  };
}

// =========================================================================
// DUPLICATE DETECTION & REMOVAL FOR RANDOM 20-QUESTION MOCK SETS
// =========================================================================
function normalizeStem(stem) {
  return String(stem || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\\\[|\\\]|\\\(|\\\)|\$\$|\$|\\text\{[^}]*\}|\\mathrm\{[^}]*\}/g, ' ')
    .replace(/[^0-9a-zA-Z가-힣]/g, '')
    .toLowerCase();
}

function getQuestionKeys(q) {
  const groupKey = q._meta ? `${q._meta.duplicateGroup}#${q.number}` : q.id;
  const stemNorm = normalizeStem(q.stem);
  const stemKey = stemNorm.length >= 14 ? `stem:${stemNorm}` : null;
  return { groupKey, stemKey };
}

function analyzeDuplicates(questions) {
  const seenGroup = new Map();
  const seenStem = new Map();
  const dupIds = new Set();
  const uniqueList = [];

  for (const q of questions) {
    const { groupKey, stemKey } = getQuestionKeys(q);
    let isDup = false;
    if (seenGroup.has(groupKey)) {
      isDup = true;
    } else if (stemKey && seenStem.has(stemKey)) {
      isDup = true;
    }

    if (isDup) {
      dupIds.add(q.id);
    } else {
      seenGroup.set(groupKey, q.id);
      if (stemKey) seenStem.set(stemKey, q.id);
      uniqueList.push(q);
    }
  }
  return { dupCount: dupIds.size, dupIds, uniqueList };
}

function buildUniqueRandomSet(pool, targetCount = 20) {
  const seenGroup = new Set();
  const seenStem = new Set();
  const result = [];
  for (const q of pool) {
    const { groupKey, stemKey } = getQuestionKeys(q);
    if (seenGroup.has(groupKey)) continue;
    if (stemKey && seenStem.has(stemKey)) continue;
    seenGroup.add(groupKey);
    if (stemKey) seenStem.add(stemKey);
    result.push(q);
    if (result.length >= targetCount) break;
  }
  return result;
}

function applyRandomDedupMode(removeDup) {
  state.randomDedup = removeDup;
  saveState();
  const preChk = document.getElementById('chkRandomDedup');
  if (preChk) preChk.checked = removeDup;

  if (removeDup) {
    // Keep unique questions from raw20 first, then backfill from randomPool up to 20
    const combined = [...state.randomRaw20, ...state.randomPool];
    const deduped = buildUniqueRandomSet(combined, 20);
    state.activeQuestions = deduped;
    state.randomDupIds = new Set();
  } else {
    state.activeQuestions = [...state.randomRaw20];
    const analysis = analyzeDuplicates(state.activeQuestions);
    state.randomDupIds = analysis.dupIds;
  }

  state.currentIdx = 0;
  state.batchPage = 0;
  renderExam();
}

async function openSubjectSlice(subj, matchingSessions, offset, limit, title) {
  showToast('선택한 20문항 세트를 불러오는 중...');
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

  state.isRandomMock = false;
  state.randomRaw20 = [];
  state.randomPool = [];
  state.randomDupIds = new Set();
  launchSubjectExam(title, `${collected.length}문항 (과목 집중)`, collected);
}

async function openRandomSubject20(subj, matchingSessions) {
  if (matchingSessions.length === 0) {
    showToast('선택된 조건에 맞는 회차가 없습니다.');
    return;
  }
  showToast('랜덤 20문항을 추출하고 중복 여부를 검사하는 중...');
  const maxFetch = Math.min(15, matchingSessions.length);
  const shuffledSessions = [...matchingSessions].sort(() => Math.random() - 0.5).slice(0, maxFetch);
  const pool = [];
  for (const s of shuffledSessions) {
    const ds = await fetchSession(s.setId);
    ds.questions.filter(q => q.subject === subj).forEach(q => pool.push({ ...q, _meta: s }));
  }
  const shuffledPool = pool.sort(() => Math.random() - 0.5);

  state.isRandomMock = true;
  state.randomPool = shuffledPool;
  state.randomRaw20 = shuffledPool.slice(0, 20);

  let initialQuestions;
  if (state.randomDedup) {
    initialQuestions = buildUniqueRandomSet(shuffledPool, 20);
    state.randomDupIds = new Set();
  } else {
    initialQuestions = [...state.randomRaw20];
    state.randomDupIds = analyzeDuplicates(initialQuestions).dupIds;
  }

  launchSubjectExam(`${subj} 랜덤 20문항`, '과목별 모의세트', initialQuestions);
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
  state.manualExpOpen.clear();

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
  state.isRandomMock = false;
  state.randomDupIds = new Set();
  state.currentSetId = setId;
  state.examTitle = formatRoundTitle(meta);
  state.examSourceLabel = meta.source;
  state.examHasExp = meta.hasExplanation;
  state.currentSubjectTab = 'all';
  state.currentIdx = 0;
  state.batchPage = 0;
  state.manualExpOpen.clear();

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

function renderRandomDupBanner(questions) {
  const banner = document.getElementById('randomDupBanner');
  if (!state.isRandomMock) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  const analysis = analyzeDuplicates(questions);
  state.randomDupIds = analysis.dupIds;

  const statusEl = document.getElementById('randomDupStatus');
  const detailEl = document.getElementById('randomDupDetail');
  const chkEl = document.getElementById('chkBannerRemoveDup');
  chkEl.checked = state.randomDedup;

  if (analysis.dupCount > 0) {
    banner.classList.add('has-dup');
    statusEl.textContent = `⚠️ 중복문제 ${analysis.dupCount}건 발견`;
    detailEl.textContent = `현재 ${questions.length}문항 중 고유 ${analysis.uniqueList.length}문항 · 우측 체크박스로 중복을 제거하고 고유 문항으로 보충할 수 있습니다.`;
  } else {
    banner.classList.remove('has-dup');
    statusEl.textContent = `✅ 중복문제 없음 (${questions.length}문항 모두 고유)`;
    detailEl.textContent = state.randomDedup
      ? '동일 회차·동일 지문 중복 제거가 적용되었습니다.'
      : '추출된 문항 간 중복이 발견되지 않았습니다.';
  }
}

function renderExam() {
  const questions = getVisibleQuestions();
  if (questions.length === 0) return;

  document.getElementById('examTitle').textContent = state.examTitle;
  document.getElementById('examSource').textContent = state.examSourceLabel;
  document.getElementById('examNoExp').classList.toggle('hidden', state.examHasExp);
  document.getElementById('chkShowAnswerExp').checked = state.showAnswerExp;

  renderRandomDupBanner(questions);

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
  const reveal = state.showAnswerExp || state.manualExpOpen.has(q.id);
  const nums = ['①', '②', '③', '④'];

  const siblings = state.index.sessions.filter(s => s.duplicateGroup === meta.duplicateGroup);
  const btnCross = document.getElementById('btnCrossCheck');
  if (siblings.length > 1) {
    btnCross.classList.remove('hidden');
    btnCross.textContent = `교차 비교 (${siblings.length}종)`;
  } else {
    btnCross.classList.add('hidden');
  }

  document.getElementById('qNum').textContent = state.examMode === 'subject_set'
    ? `${state.currentIdx + 1}번 (원본 ${q.number}번)`
    : `${q.number}번`;

  const dupBadge = document.getElementById('qDupBadge');
  dupBadge.classList.toggle('hidden', !state.randomDupIds.has(q.id));

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

  // Individual peek button when global "답·해설 보기" is unchecked
  const btnOneExp = document.getElementById('btnToggleOneExp');
  if (!state.showAnswerExp) {
    btnOneExp.classList.remove('hidden');
    btnOneExp.textContent = state.manualExpOpen.has(q.id) ? '이 문제 해설 숨기기' : '이 문제 해설 보기';
    btnOneExp.onclick = () => {
      if (state.manualExpOpen.has(q.id)) state.manualExpOpen.delete(q.id);
      else state.manualExpOpen.add(q.id);
      renderSingleQuestion(questions);
    };
  } else {
    btnOneExp.classList.add('hidden');
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
    if (reveal) {
      if (val === q.answer) cls = 'correct';
      else if (chosen && val === chosen) cls = 'wrong';
    } else if (chosen && val === chosen) {
      cls = 'selected';
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
  if (reveal) {
    expBox.classList.remove('hidden');
    if (chosen) {
      const isOk = chosen === q.answer;
      expBox.className = `q-exp-box ${isOk ? 'ok' : 'no'}`;
      document.getElementById('qResLabel').textContent = isOk ? '정답입니다!' : '오답입니다';
    } else {
      expBox.className = 'q-exp-box info';
      document.getElementById('qResLabel').textContent = '정답 및 해설';
    }
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
      bodyEl.innerHTML = `<span class="badge badge-amber" style="margin-right:6px;">해설 준비 중</span>등록된 해설이 없습니다.`;
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
  document.getElementById('omrStat').textContent = state.showAnswerExp
    ? `정답 ${correct} / 풀이 ${solved}`
    : `풀이 ${solved} / ${questions.length} (채점 숨김)`;

  const omr = document.getElementById('omrGrid');
  omr.innerHTML = questions.map((item, idx) => {
    const a = state.answers[item.id];
    let statusCls = '';
    if (a) {
      statusCls = state.showAnswerExp ? (a === item.answer ? 'ok' : 'no') : 'answered';
    }
    const cls = `${statusCls} ${idx === state.currentIdx ? 'cur' : ''}`;
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

  document.getElementById('batchSummary').textContent = state.showAnswerExp
    ? `현재 20문항 보기 (${start + 1}~${start + slice.length} / 총 ${questions.length}문항) · 정답 ${correct}/${solved}`
    : `현재 20문항 보기 (${start + 1}~${start + slice.length} / 총 ${questions.length}문항) · 풀이 ${solved}/${slice.length} (답·해설 숨김)`;
  document.getElementById('batchPageLabel').textContent = `${state.batchPage + 1} / ${totalPages} 페이지`;
  document.getElementById('btnBatchPrev').disabled = state.batchPage === 0;
  document.getElementById('btnBatchNext').disabled = state.batchPage >= totalPages - 1;

  const listEl = document.getElementById('batchList');
  listEl.innerHTML = slice.map((q, localIdx) => {
    const chosen = state.answers[q.id];
    const reveal = state.showAnswerExp || state.manualExpOpen.has(q.id);
    const meta = q._meta;
    const siblings = state.index.sessions.filter(s => s.duplicateGroup === meta.duplicateGroup);
    const hasExp = q.explanation && q.explanation.replace(/<[^>]+>/g, '').trim().length > 0;
    const displayNum = state.examMode === 'subject_set' ? `${start + localIdx + 1}번 (원본 ${q.number}번)` : `${q.number}번`;
    const isDup = state.randomDupIds.has(q.id);

    return `
      <article class="card" id="batch_q_${q.id}">
        <div class="q-head">
          <div class="q-head-left">
            <span class="q-num">${displayNum}</span>
            ${isDup ? `<span class="badge badge-amber">중복 문항</span>` : ''}
            ${state.examMode === 'subject_set' ? `<span class="badge badge-slate">${formatRoundTitle(meta)} · ${meta.source}</span>` : ''}
            <span class="q-subj">${q.subject}</span>
          </div>
          <div class="q-head-right">
            ${!state.showAnswerExp ? `<button type="button" data-batch-exp="${q.id}" class="btn btn-outline btn-sm">${state.manualExpOpen.has(q.id) ? '해설 숨기기' : '해설 보기'}</button>` : ''}
            ${siblings.length > 1 ? `<button type="button" data-batch-cross="${q.id}" class="btn btn-indigo btn-sm">교차 비교 (${siblings.length}종)</button>` : ''}
          </div>
        </div>
        <div class="q-stem">${q.stem}</div>
        ${q.diagram && q.diagram.trim() ? `<div class="q-diag-wrap"><div class="q-diag">${q.diagram}</div></div>` : ''}
        <div class="q-choices">
          ${q.choices.map((c, i) => {
            const val = i + 1;
            let cls = '';
            if (reveal) {
              if (val === q.answer) cls = 'correct';
              else if (chosen && val === chosen) cls = 'wrong';
            } else if (chosen && val === chosen) {
              cls = 'selected';
            }
            return `<button type="button" data-bq="${q.id}" data-bch="${val}" class="choice-btn ${cls}"><span class="choice-num">${nums[i] || val}</span><span class="choice-body">${c}</span></button>`;
          }).join('')}
        </div>
        ${reveal ? `
          <div class="q-exp-box ${chosen ? (chosen === q.answer ? 'ok' : 'no') : 'info'}">
            <div class="q-exp-head">
              <strong>${chosen ? (chosen === q.answer ? '정답입니다!' : '오답입니다') : '정답 및 해설'}</strong>
              <span>정답: ${nums[q.answer - 1] || q.answer}</span>
            </div>
            ${q.formula && q.formula.trim() ? `<div class="q-formula"><strong>핵심 공식:</strong> ${q.formula}</div>` : ''}
            ${q.tip && q.tip.trim() ? `<div class="q-tip"><strong>암기/풀이 팁:</strong> ${q.tip}</div>` : ''}
            <div class="q-exp-body">${hasExp ? q.explanation : '<span class="badge badge-amber">해설 준비 중</span> 등록된 해설이 없습니다.'}</div>
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

  listEl.querySelectorAll('[data-batch-exp]').forEach(btn => {
    btn.addEventListener('click', () => {
      const qid = btn.getAttribute('data-batch-exp');
      if (state.manualExpOpen.has(qid)) state.manualExpOpen.delete(qid);
      else state.manualExpOpen.add(qid);
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
    const hasExp = item.explanation && item.explanation.replace(/<[^>]+>/g, '').trim().length > 0;
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
        ${hasExp ? `<details style="margin-top:8px;font-size:12.5px;color:#334155;"><summary style="cursor:pointer;font-weight:600;color:#2563eb;">해설 보기</summary><div style="margin-top:6px;line-height:1.6;">${item.explanation}</div></details>` : ''}
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
  const validSources = new Set(state.index.sources || []);
  state.enabledSources = new Set(Array.from(state.enabledSources).filter(s => validSources.has(s)));
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

  // Year dropdowns (Round mode + Subject range selectors)
  const yearsDesc = getAllYearsDesc();
  const yearsAsc = [...yearsDesc].reverse();
  const yearSelect = document.getElementById('selectYear');
  const syStart = document.getElementById('syRangeStart');
  const syEnd = document.getElementById('syRangeEnd');

  yearsDesc.forEach(y => {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = `${y}년`;
    yearSelect.appendChild(opt);
  });
  yearsAsc.forEach(y => {
    const opt1 = document.createElement('option');
    opt1.value = String(y);
    opt1.textContent = `${y}년`;
    syStart.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = String(y);
    opt2.textContent = `${y}년`;
    syEnd.appendChild(opt2);
  });
  if (yearsAsc.length > 0) {
    syStart.value = String(yearsAsc[0]);
    syEnd.value = String(yearsAsc[yearsAsc.length - 1]);
  }

  // Default all years selected in subject mode if none saved
  const validYears = new Set(yearsDesc);
  state.subjectYears = new Set(Array.from(state.subjectYears).filter(y => validYears.has(y)));
  if (state.subjectYears.size === 0) {
    yearsDesc.forEach(y => state.subjectYears.add(y));
  }

  document.getElementById('chkDedup').checked = state.dedupEnabled;
  document.getElementById('chkShowAnswerExp').checked = state.showAnswerExp;
  document.getElementById('chkRandomDedup').checked = state.randomDedup;
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

  // Subject year range & quick buttons
  document.getElementById('btnApplyYearRange').addEventListener('click', () => {
    const a = Number(syStart.value);
    const b = Number(syEnd.value);
    const minY = Math.min(a, b);
    const maxY = Math.max(a, b);
    state.subjectYears = new Set(yearsDesc.filter(y => y >= minY && y <= maxY));
    saveState();
    renderHome();
    showToast(`${minY}년 ~ ${maxY}년 범위를 적용했습니다.`);
  });
  document.getElementById('btnYearRecent5').addEventListener('click', () => {
    const maxY = yearsDesc[0] || 2026;
    const minY = maxY - 4;
    syStart.value = String(Math.max(yearsAsc[0] || minY, minY));
    syEnd.value = String(maxY);
    state.subjectYears = new Set(yearsDesc.filter(y => y >= minY && y <= maxY));
    saveState();
    renderHome();
  });
  document.getElementById('btnYearRecent10').addEventListener('click', () => {
    const maxY = yearsDesc[0] || 2026;
    const minY = maxY - 9;
    syStart.value = String(Math.max(yearsAsc[0] || minY, minY));
    syEnd.value = String(maxY);
    state.subjectYears = new Set(yearsDesc.filter(y => y >= minY && y <= maxY));
    saveState();
    renderHome();
  });
  document.getElementById('btnYearKec').addEventListener('click', () => {
    const maxY = yearsDesc[0] || 2026;
    syStart.value = '2021';
    syEnd.value = String(maxY);
    state.subjectYears = new Set(yearsDesc.filter(y => y >= 2021));
    saveState();
    renderHome();
  });
  document.getElementById('btnYearAll').addEventListener('click', () => {
    state.subjectYears = new Set(yearsDesc);
    if (yearsAsc.length > 0) {
      syStart.value = String(yearsAsc[0]);
      syEnd.value = String(yearsAsc[yearsAsc.length - 1]);
    }
    saveState();
    renderHome();
  });
  document.getElementById('btnYearNone').addEventListener('click', () => {
    state.subjectYears.clear();
    saveState();
    renderHome();
  });

  // Random dedup checkboxes (home panel + in-exam banner)
  document.getElementById('chkRandomDedup').addEventListener('change', e => {
    state.randomDedup = e.target.checked;
    saveState();
  });
  document.getElementById('chkBannerRemoveDup').addEventListener('change', e => {
    applyRandomDedupMode(e.target.checked);
    showToast(e.target.checked ? '중복 문항을 제거하고 고유 문항으로 구성했습니다.' : '중복 제거를 해제했습니다.');
  });

  // Show/hide answer & explanation checkbox
  document.getElementById('chkShowAnswerExp').addEventListener('change', e => {
    state.showAnswerExp = e.target.checked;
    if (state.showAnswerExp) state.manualExpOpen.clear();
    saveState();
    renderExam();
  });

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
    state.isRandomMock = false;
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
    state.manualExpOpen.clear();
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
