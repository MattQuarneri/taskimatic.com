import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTodaySchedule, formatTimelineTime, normalizeBreakMinutes, TODAY_COLORS } from '../js/today-time-model.js';

const now = new Date(2026, 9, 27, 9, 0).getTime();
const task = (id, estimatedMinutes, priority = null, extra = {}) => ({ id, text: id, estimatedMinutes, priority, status: 'open', ...extra });

test('schedule prioritizes unfinished tasks, assigns colors, and leaves input unchanged', () => {
    const input = [task('later', 30, 2), task('first', 10, 1), task('unranked', null),
        task('done', 30, 1, { status: 'done' }), task('tabled', 30, 1, { tabled: true })];
    const schedule = buildTodaySchedule(input, now);
    assert.deepEqual(schedule.tasks.map(task => task.id), ['first', 'later', 'unranked']);
    assert.deepEqual(schedule.tasks.map(task => task.color), TODAY_COLORS.slice(0, 3));
    assert.equal(input[0].color, undefined);
    assert.equal(formatTimelineTime(schedule.tasks[0].completesAt), '09:10');
    assert.equal(formatTimelineTime(schedule.end), '10:15');
});

test('long tasks split around hourly breaks and have one final completion line', () => {
    const schedule = buildTodaySchedule([task('long', 90), task('next', 60)], now);
    assert.deepEqual(schedule.segments.map(segment => [segment.type, segment.minutes]), [
        ['task', 60], ['break', 5], ['task', 30], ['task', 30], ['break', 5], ['task', 30]
    ]);
    assert.deepEqual(schedule.segments.filter(segment => segment.complete).map(segment => formatTimelineTime(segment.end)), ['10:35', '11:40']);
    assert.equal(schedule.segments[0].color, schedule.segments[2].color);
});

test('breaks cross task boundaries, support customization and zero, and never trail the last task', () => {
    assert.equal(buildTodaySchedule([task('a', 30), task('b', 30)], now).segments.length, 2);
    const tasks = [task('a', 60), task('b', 10)];
    assert.equal(formatTimelineTime(buildTodaySchedule(tasks, now, 12).end), '10:22');
    assert.equal(formatTimelineTime(buildTodaySchedule(tasks, now, 0).end), '10:10');
    assert.equal(buildTodaySchedule(tasks, now, 0).segments.some(segment => segment.type === 'break'), false);
    assert.equal(normalizeBreakMinutes(null), 5);
    assert.equal(normalizeBreakMinutes('invalid'), 5);
    assert.equal(normalizeBreakMinutes(-3), 0);
    assert.equal(normalizeBreakMinutes(100), 60);
});

test('empty schedules, palette wraparound, and midnight completion remain valid', () => {
    assert.deepEqual(buildTodaySchedule([], now).segments, []);
    const schedule = buildTodaySchedule(Array.from({ length: 8 }, (_, i) => task(String(i), 10)), now);
    assert.equal(schedule.tasks[0].color, schedule.tasks[7].color);
    assert.equal(formatTimelineTime(buildTodaySchedule([task('late', 30)], new Date(2026, 9, 27, 23, 50).getTime()).end), '00:20');
});
