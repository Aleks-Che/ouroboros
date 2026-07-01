// Activity dashboard subtab (P4): a single observability + minimal-control view for
// cron/scheduled tasks, what is running/queued now, and background consciousness.
// Management is DIRECT mechanical control via existing APIs (cancel a task, enable/
// disable/delete a MANUAL schedule, start/stop background consciousness). Skill-managed
// schedules are READ-ONLY ("managed by skill") because the lifecycle resync would
// overwrite a direct toggle (supervisor/queue.py) — control those via the skill itself.

import { apiFetch } from './api_client.js';

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

async function getJson(url) {
    try {
        const resp = await apiFetch(url, { cache: 'no-store' });
        if (resp && typeof resp.json === 'function') {
            if (resp.ok === false) return null;
            return await resp.json();
        }
        return resp;
    } catch {
        return null;
    }
}

// A schedule synced from a skill manifest is reconciled from skill readiness, so a
// direct enable/disable/delete here would be temporary/misleading — show it read-only.
function isSkillManaged(s) {
    return Boolean(s && (String(s.source || '') === 'skill_manifest' || String(s.skill || '')));
}

export function initActivity({ mount, ws } = {}) {
    if (!mount) return { refresh: () => {} };
    let busy = false;

    function renderQueue(queue) {
        const running = (queue && Array.isArray(queue.running)) ? queue.running : [];
        const pending = (queue && Array.isArray(queue.pending)) ? queue.pending : [];
        const row = (q, kind) => {
            const t = (q && q.task) || {};
            const id = esc(q.id || t.id || '');
            const label = esc(t.title || t.objective || t.text || q.type || id || 'задача');
            const rt = kind === 'running' && q.runtime_sec != null ? ` · ${Math.round(q.runtime_sec)}s` : '';
            const meta = `${esc(kind)}${q.type ? ` · ${esc(q.type)}` : ''}${rt}`;
            return `<div class="activity-row">
                <div class="activity-row-main">
                    <span class="activity-name">${label}</span>
                    <span class="activity-sub">${meta}</span>
                </div>
                <div class="activity-row-actions">
                    <button type="button" class="btn btn-xs btn-danger" data-act="task-cancel" data-id="${id}">Отменить</button>
                </div>
            </div>`;
        };
        const parts = [...running.map((q) => row(q, 'running')), ...pending.map((q) => row(q, 'pending'))];
        return parts.length ? parts.join('') : '<div class="activity-empty">Нет запущенных или ожидающих задач.</div>';
    }

    function renderBg(stateData) {
        const enabled = Boolean(stateData && stateData.bg_consciousness_enabled);
        const bg = (stateData && stateData.bg_consciousness_state) || {};
        const detail = esc(bg.detail || bg.last_idle_reason || (enabled ? 'running' : 'disabled'));
        return `<div class="activity-row">
            <div class="activity-row-main">
                <span class="activity-name">Фоновое сознание</span>
                <span class="activity-sub">${enabled ? 'включено' : 'отключено'}${detail ? ` · ${detail}` : ''}</span>
            </div>
            <div class="activity-row-actions">
                <button type="button" class="btn btn-xs btn-default" data-act="bg-toggle" data-enabled="${enabled ? '1' : '0'}"${ws ? '' : ' disabled'}>${enabled ? 'Стоп' : 'Старт'}</button>
            </div>
        </div>`;
    }

    function renderSchedules(data) {
        const tasks = (data && Array.isArray(data.tasks)) ? data.tasks : [];
        if (!tasks.length) return '<div class="activity-empty">Нет запланированных задач.</div>';
        return tasks.map((s) => {
            const managed = isSkillManaged(s);
            const cron = esc((s.trigger && s.trigger.expr) || s.cron || '');
            const next = esc(s.next_run_at || '');
            const enabled = s.enabled !== false;
            const id = esc(s.id || '');
            const sub = `${cron}${next ? ` · next ${next}` : ''}${managed && s.skill ? ` · ${esc(s.skill)}` : ''}`;
            const actions = managed
                ? '<span class="activity-tag">управляется навыком</span>'
                : `<button type="button" class="btn btn-xs btn-default" data-act="schedule-toggle" data-id="${id}">${enabled ? 'Отключить' : 'Включить'}</button>
                   <button type="button" class="btn btn-xs btn-danger" data-act="schedule-delete" data-id="${id}">Удалить</button>`;
            return `<div class="activity-row${enabled ? '' : ' off'}">
                <div class="activity-row-main">
                    <span class="activity-name">${esc(s.name || s.id || 'schedule')}</span>
                    <span class="activity-sub">${sub}</span>
                </div>
                <div class="activity-row-actions">${actions}</div>
            </div>`;
        }).join('');
    }

    async function refresh() {
        mount.innerHTML = '<div class="activity-loading">Загрузка активности...</div>';
        const [sched, tasks, st] = await Promise.all([
            getJson('/api/schedules'),
            getJson('/api/tasks?limit=1'),
            getJson('/api/state'),
        ]);
        mount.innerHTML = `
            <div class="activity-scroll">
                <div class="activity-section">
                    <h3 class="activity-h">Запущенные и ожидающие</h3>
                    ${renderQueue(tasks && tasks.queue)}
                </div>
                <div class="activity-section">
                    <h3 class="activity-h">Фоновое сознание</h3>
                    ${renderBg(st)}
                </div>
                <div class="activity-section">
                    <h3 class="activity-h">Расписания (cron)</h3>
                    ${renderSchedules(sched)}
                </div>
            </div>
        `;
    }

    async function findSchedule(id) {
        const data = await getJson('/api/schedules');
        const tasks = (data && Array.isArray(data.tasks)) ? data.tasks : [];
        return tasks.find((s) => String(s.id) === String(id)) || null;
    }

    mount.addEventListener('click', async (event) => {
        const btn = event.target.closest('[data-act]');
        if (!btn || busy) return;
        const act = btn.dataset.act;
        const id = btn.dataset.id || '';
        busy = true;
        btn.disabled = true;
        try {
            if (act === 'task-cancel') {
                if (!window.confirm('Отменить эту задачу?')) return;
                await apiFetch(`/api/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
            } else if (act === 'schedule-delete') {
                if (!window.confirm('Удалить это расписание?')) return;
                await apiFetch(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' });
            } else if (act === 'schedule-toggle') {
                // Read-modify-write the FULL record (upsert replaces by id; never drop
                // timezone/trigger/task/source) with the flipped enabled flag.
                const rec = await findSchedule(id);
                if (rec) {
                    await apiFetch('/api/schedules', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...rec, enabled: !(rec.enabled !== false) }),
                    });
                }
            } else if (act === 'bg-toggle') {
                const on = btn.dataset.enabled === '1';
                // Reuse the existing direct control command (same as the chat header
                // toggle); /bg is a control slash-command, not a chat message to the agent.
                ws?.send?.({ type: 'command', cmd: `/bg ${on ? 'stop' : 'start'}` });
                await new Promise((resolve) => setTimeout(resolve, 400));
            }
        } catch {
            // best-effort; the refresh below reflects the actual state
        } finally {
            busy = false;
            await refresh();
        }
    });

    window.addEventListener('ouro:dashboard-subtab-shown', (event) => {
        if (event?.detail?.tab === 'activity') refresh();
    });

    return { refresh };
}
