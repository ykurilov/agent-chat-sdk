/** Значение из адреса для строки журнала: с управляющими символами — в кавычках и экранировано, чтобы не подделать строки. */
export const logValue = (value: string): string => (/[\p{Cc}\u2028\u2029]/u.test(value) ? JSON.stringify(value) : value);
