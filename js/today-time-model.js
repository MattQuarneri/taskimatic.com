// Light colors keep task text readable and match the timeline and task cards.
const TODAY_COLORS = ['#d6e7fa', '#ffdfd5', '#d4eddf', '#eadcf1', '#f8e8bf', '#d1ecef', '#f3d8e1'];

function normalizeBreakMinutes(value) {
    const minutes = Number(value);
    return value !== null && value !== '' && Number.isFinite(minutes)
        ? Math.min(60, Math.max(0, Math.round(minutes))) : 5;
}

function buildTodaySchedule(tasks, now = Date.now(), breakMinutes = 5) {
    const ordered = tasks.filter(task => task.status !== 'done' && !task.tabled)
        .slice().sort((a, b) => (a.priority || Infinity) - (b.priority || Infinity));
    const coloredTasks = ordered.map((task, index) => ({ ...task, color: TODAY_COLORS[index % TODAY_COLORS.length] }));
    const segments = [];
    let cursor = Number(now);
    let workMinutes = 0;
    const pause = normalizeBreakMinutes(breakMinutes);
    for (const task of coloredTasks) {
        let remaining = Number(task.estimatedMinutes) > 0 && Number.isFinite(Number(task.estimatedMinutes))
            ? Number(task.estimatedMinutes) : 30;
        while (remaining > 0) {
            if (workMinutes === 60) {
                if (pause) {
                    const end = cursor + pause * 60000;
                    segments.push({ type: 'break', start: cursor, end, minutes: pause });
                    cursor = end;
                }
                workMinutes = 0;
            }
            const minutes = Math.min(remaining, 60 - workMinutes);
            const end = cursor + minutes * 60000;
            remaining -= minutes;
            segments.push({ type: 'task', taskId: task.id, text: task.text, color: task.color,
                start: cursor, end, minutes, complete: remaining === 0 });
            cursor = end;
            workMinutes += minutes;
        }
        task.completesAt = cursor;
    }
    return { tasks: coloredTasks, segments, start: Number(now), end: cursor };
}

function formatTimelineTime(time) {
    const date = new Date(time);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export { TODAY_COLORS, normalizeBreakMinutes, buildTodaySchedule, formatTimelineTime };
