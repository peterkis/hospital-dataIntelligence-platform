const LOCAL_DATE_TIME_PATTERN =
  /^(?<date>\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))T(?<time>(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?)$/u;

export type LocalDateTime = string & { readonly __localDateTime: unique symbol };

export function parseLocalDateTime(value: string): LocalDateTime {
  if (!LOCAL_DATE_TIME_PATTERN.test(value)) {
    throw new Error('LOCAL_DATETIME_INVALID');
  }
  return value as LocalDateTime;
}

export const LOCAL_DATE_TIME_JSON_PATTERN =
  '^\\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])T(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d{1,6})?$';
