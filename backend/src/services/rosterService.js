import { SHIFTS } from '../models/Attendance.js';

/** Local midnight. */
export function startOfDay(date = new Date()) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Monday 00:00 of the week containing `date`.
 * Weeks are Monday–Sunday so a night shift that starts Sunday still sits in
 * the week the roster was published for.
 */
export function mondayOf(date = new Date()) {
  const d = startOfDay(date);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

export function sundayOf(weekStart) {
  const end = startOfDay(weekStart);
  end.setDate(end.getDate() + 6);
  return end;
}

export function daysOfWeek(weekStart) {
  const monday = mondayOf(weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return day;
  });
}

export function isDateInWeek(date, weekStart) {
  const start = mondayOf(weekStart);
  const end = sundayOf(weekStart);
  const day = startOfDay(date);
  return day >= start && day <= end;
}

/**
 * How many people are planned on each (day, shift) cell.
 * Empty cells are still present so the board can render a complete grid.
 */
export function coverageFrom(assignments, weekStart) {
  const days = daysOfWeek(weekStart);
  return days.flatMap((date) =>
    SHIFTS.map((shift) => {
      const count = assignments.filter(
        (row) => startOfDay(row.date).getTime() === date.getTime() && row.shift === shift,
      ).length;
      return { date, shift, count };
    }),
  );
}

export default {
  startOfDay,
  mondayOf,
  sundayOf,
  daysOfWeek,
  isDateInWeek,
  coverageFrom,
};
