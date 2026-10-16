// Copies questions.json into js/questions.js so the game can load it from a local file
// (browsers block fetch() on file:// pages). Run after editing questions.json:
//   node tools/sync-questions.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const questions = JSON.parse(fs.readFileSync(path.join(root, 'questions.json'), 'utf8'));
const types = { fact: 0, majority: 0, minority: 0 };
for (const q of questions) {
  if (!(q.type in types)) throw new Error(`${q.id}: unknown type ${q.type}`);
  if (!Array.isArray(q.options) || q.options.length !== 4) throw new Error(`${q.id}: needs 4 options`);
  if (q.type === 'fact' && !(q.answer >= 0 && q.answer < 4)) throw new Error(`${q.id}: fact needs an answer 0-3`);
  types[q.type]++;
}
fs.writeFileSync(
  path.join(root, 'js', 'questions.js'),
  '// Generated from questions.json by tools/sync-questions.js. Edit questions.json, not this file.\n' +
    `window.FF_QUESTIONS = ${JSON.stringify(questions)};\n`,
);
console.log(`${questions.length} questions`, types);
