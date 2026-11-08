'use strict';

const MAX_OUTPUT_CHARS = 64_000;

function trimOutput(text) {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `[начало вывода обрезано]\n${text.slice(-MAX_OUTPUT_CHARS)}`;
}

function formatStep(label, result) {
  const body = [result.stdout, result.stderr].map((part) => part.trim()).filter(Boolean).join('\n');
  const failure = result.ok
    ? ''
    : `\nОшибка: ${result.timedOut ? 'превышено время выполнения' : `код ${result.code}`}`;
  return `$ ${label}\n${body}${failure}`.trim();
}

module.exports = { trimOutput, formatStep, MAX_OUTPUT_CHARS };
