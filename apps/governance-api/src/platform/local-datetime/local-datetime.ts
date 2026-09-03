const LOCAL_DATE_TIME_PATTERN =
  /^(?<date>\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))T(?<time>(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?)$/u;

export type LocalDateTime = string & { readonly __localDateTime: unique symbol };

export function parseLocalDateTime(value: string): LocalDateTime {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match?.groups) {
    throw new Error('LOCAL_DATETIME_INVALID');
  }
  const [year, month, day] = match.groups['date']!.split('-').map(Number);
  if (day! > daysInMonth(year!, month!)) throw new Error('LOCAL_DATETIME_INVALID');
  return value as LocalDateTime;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export const LOCAL_DATE_TIME_JSON_PATTERN =
  '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$';
