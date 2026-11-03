// "yyyy-mm-dd" theo giờ máy người dùng — không dùng toISOString() để tránh lệch múi giờ.
export function toDateInputValue(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// Đọc "yyyy-mm-dd" thành Date tại 00:00 giờ máy (không parse theo UTC như new Date(string)).
export function parseDateInputValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

// Cộng tháng có kẹp ngày cuối tháng: 31/08 + 6 tháng → 28/02 (không tràn sang 03/03).
export function addMonthsClamped(date: Date, months: number): Date {
  const result = new Date(date);
  const day = date.getDate();

  // Đưa về ngày 1 trước khi đổi tháng để Date không tự tràn sang tháng sau.
  result.setDate(1);
  result.setMonth(result.getMonth() + months);

  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDayOfTargetMonth));
  return result;
}
