const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = localStorage.getItem('study-tracker-username') || '';
let dailyMinutes = {};
let timerInterval = null;
let timerEndAt = null;

const levelColors = ['#1a1a19', '#C0DD97', '#97C459', '#639922', '#27500A'];

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function levelFromHours(h) {
  if (h <= 0) return 0;
  if (h < 1) return 1;
  if (h < 2.5) return 2;
  if (h < 4) return 3;
  return 4;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

async function loadUserData() {
  if (!currentUser) { dailyMinutes = {}; return; }
  const { data, error } = await supabase
    .from('study_sessions')
    .select('daily_minutes')
    .eq('username', currentUser)
    .maybeSingle();
  if (error) { console.error(error); return; }
  dailyMinutes = data ? data.daily_minutes : {};
}

function dayMinutes(iso) {
  return dailyMinutes[iso] || 0;
}

function renderHeatmap() {
  const year = new Date().getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);

  let totalMinutes = 0;
  Object.values(dailyMinutes).forEach(m => totalMinutes += m);
  document.getElementById('year-total').textContent = year + ': ' + (totalMinutes / 60).toFixed(1) + ' horas registradas';

  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const dow = start.getDay();
  const offset = (dow === 0 ? 6 : dow - 1);

  let weeks = [];
  let week = new Array(offset).fill(null);
  let cur = new Date(start);
  while (cur <= end) {
    week.push(new Date(cur));
    if (week.length === 7) { weeks.push(week); week = []; }
    cur.setDate(cur.getDate() + 1);
  }
  if (week.length) { while (week.length < 7) week.push(null); weeks.push(week); }

  let monthLabelsHtml = '<div style="display:flex; margin-left:28px; margin-bottom:4px;">';
  let lastMonth = -1;
  weeks.forEach(w => {
    const firstValid = w.find(d => d);
    const m = firstValid ? firstValid.getMonth() : lastMonth;
    let label = '';
    if (firstValid && m !== lastMonth) { label = months[m]; lastMonth = m; }
    monthLabelsHtml += `<div style="width:13px; font-size:11px; color:#898781; flex-shrink:0;">${label}</div>`;
  });
  monthLabelsHtml += '</div>';

  const dayLabels = ['L', '', 'M', '', 'V', '', ''];
  let gridHtml = '<div style="display:flex;">';
  gridHtml += '<div style="display:flex; flex-direction:column; gap:3px; margin-right:6px; width:22px;">';
  dayLabels.forEach(l => gridHtml += `<div style="height:13px; font-size:10px; color:#898781; display:flex; align-items:center;">${l}</div>`);
  gridHtml += '</div>';

  weeks.forEach(w => {
    gridHtml += '<div style="display:flex; flex-direction:column; gap:3px; margin-right:3px;">';
    w.forEach(d => {
      if (!d) { gridHtml += '<div style="width:13px;height:13px;"></div>'; return; }
      const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const mins = dayMinutes(iso);
      const hrs = mins / 60;
      const lvl = levelFromHours(hrs);
      const isFuture = d > new Date();
      const bg = isFuture ? '#1a1a19' : levelColors[lvl];
      const border = lvl === 0 ? '0.5px solid #3a3a38' : 'none';
      gridHtml += `<div class="day-cell" title="${iso}: ${hrs.toFixed(1)}h" style="width:13px;height:13px;border-radius:2px;background:${bg};border:${border};"></div>`;
    });
    gridHtml += '</div>';
  });
  gridHtml += '</div>';

  document.getElementById('heatmap').innerHTML = monthLabelsHtml + gridHtml;
}

async function persistMinutes(iso, addMinutes) {
  dailyMinutes[iso] = (dailyMinutes[iso] || 0) + addMinutes;
  const totalMinutes = Object.values(dailyMinutes).reduce((a, b) => a + b, 0);
  const totalHours = totalMinutes / 60;

  const { error } = await supabase
    .from('study_sessions')
    .upsert({
      username: currentUser,
      daily_minutes: dailyMinutes,
      total_hours: totalHours,
      updated_at: new Date().toISOString()
    }, { onConflict: 'username' });

  if (error) { console.error(error); showToast('Error al guardar'); return; }

  renderHeatmap();
  loadRanking();
}

function formatClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

document.getElementById('username').value = currentUser;
document.getElementById('username').addEventListener('change', async (e) => {
  currentUser = e.target.value.trim();
  localStorage.setItem('study-tracker-username', currentUser);
  await loadUserData();
  renderHeatmap();
  loadRanking();
});

document.getElementById('start-focus').addEventListener('click', () => {
  if (!currentUser) { document.getElementById('username').focus(); return; }
  const minutes = parseInt(document.getElementById('focus-minutes').value);
  const totalSeconds = minutes * 60;
  timerEndAt = Date.now() + totalSeconds * 1000;

  document.getElementById('focus-idle').style.display = 'none';
  document.getElementById('focus-done').style.display = 'none';
  document.getElementById('focus-running').style.display = 'flex';
  document.getElementById('focus-clock').textContent = formatClock(totalSeconds);

  timerInterval = setInterval(() => {
    const remaining = Math.round((timerEndAt - Date.now()) / 1000);
    if (remaining <= 0) {
      clearInterval(timerInterval);
      finishFocus(minutes);
    } else {
      document.getElementById('focus-clock').textContent = formatClock(remaining);
    }
  }, 250);
});

async function finishFocus(minutes) {
  document.getElementById('focus-running').style.display = 'none';
  document.getElementById('focus-done').style.display = 'flex';
  await persistMinutes(todayISO(), minutes);
  showToast('Sesión guardada: +' + minutes + ' min');
  setTimeout(() => {
    document.getElementById('focus-done').style.display = 'none';
    document.getElementById('focus-idle').style.display = 'flex';
  }, 2200);
}

document.getElementById('cancel-focus').addEventListener('click', () => {
  clearInterval(timerInterval);
  document.getElementById('focus-running').style.display = 'none';
  document.getElementById('focus-idle').style.display = 'flex';
  showToast('Sesión cancelada, no se guardó');
});

document.getElementById('add-manual').addEventListener('click', async () => {
  if (!currentUser) { document.getElementById('username').focus(); return; }
  const mins = parseInt(document.getElementById('manual-minutes').value);
  if (!mins || mins <= 0) return;
  await persistMinutes(todayISO(), mins);
  document.getElementById('manual-minutes').value = '';
  showToast('Agregado: +' + mins + ' min');
});

async function loadRanking() {
  const list = document.getElementById('ranking-list');
  list.innerHTML = '<p class="muted">Cargando...</p>';

  const { data, error } = await supabase
    .from('study_sessions')
    .select('username, total_hours')
    .order('total_hours', { ascending: false });

  if (error) { console.error(error); list.innerHTML = '<p class="muted">Error al cargar el ranking</p>'; return; }
  if (!data || data.length === 0) { list.innerHTML = '<p class="muted">Nadie ha registrado tiempo todavía.</p>'; return; }

  list.innerHTML = '';
  data.forEach((entry, i) => {
    const isMe = entry.username === currentUser;
    const row = document.createElement('div');
    row.className = 'ranking-row' + (isMe ? ' me' : '');
    row.innerHTML = `
      <span class="muted" style="width:18px;">${i + 1}</span>
      <span style="flex:1; font-weight:500; color:${isMe ? '#97C459' : '#e8e8e3'};">${entry.username}${isMe ? ' (tú)' : ''}</span>
      <span style="font-weight:500;">${Number(entry.total_hours).toFixed(1)}h</span>
    `;
    list.appendChild(row);
  });
}

document.getElementById('refresh-ranking').addEventListener('click', loadRanking);

// Suscripción en tiempo real: si tu amigo guarda, tu ranking se actualiza solo
supabase
  .channel('study_sessions_changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'study_sessions' }, () => {
    loadRanking();
  })
  .subscribe();

(async function init() {
  await loadUserData();
  renderHeatmap();
  loadRanking();
})();
