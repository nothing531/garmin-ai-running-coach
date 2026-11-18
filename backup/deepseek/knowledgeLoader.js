import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT_DIR = path.resolve(__dirname, '..', '..');

const KNOWLEDGE_SOURCES = [
  {
    id: 'skill_800m',
    label: '800m 专项教练 Skill (.agents/skills/800m-running-coach/SKILL.md)',
    relPath: path.join('.agents', 'skills', '800m-running-coach', 'SKILL.md'),
    maxChars: 8500
  },
  {
    id: 'bible_800m',
    label: '800m 间歇生理与 ASR 圣经 (knowledge/800m-interval-bible.md)',
    relPath: path.join('knowledge', '800m-interval-bible.md'),
    maxChars: 15000
  },
  {
    id: 'bible_polarized',
    label: '双端极化训练原则 (knowledge/polarized-training-bible.md)',
    relPath: path.join('knowledge', 'polarized-training-bible.md'),
    maxChars: 9000
  },
  {
    id: 'session_catalog',
    label: '周期场地与力量课表决策卡库 (knowledge/interval-session-catalog.md)',
    relPath: path.join('knowledge', 'interval-session-catalog.md'),
    maxChars: 16000
  }
];

async function readSafeTrimmed(filePath, maxChars) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (raw.length <= maxChars) return raw.trim();
    return `${raw.slice(0, maxChars).trim()}\n\n[...已按长度截断，保留核心原则...]`;
  } catch {
    return null;
  }
}

/**
 * 动态加载本地 800m 专项知识库与 Skill，注入 LLM 教练系统提示词
 */
export async function loadCoachKnowledgeBundle(rootDir = DEFAULT_ROOT_DIR) {
  const sections = [];
  const loadedFiles = [];

  for (const src of KNOWLEDGE_SOURCES) {
    const fullPath = path.join(rootDir, src.relPath);
    const text = await readSafeTrimmed(fullPath, src.maxChars);
    if (text) {
      loadedFiles.push(src.relPath.replace(/\\/g, '/'));
      sections.push(`## ${src.label}\n${text}`);
    }
  }

  return {
    loadedFiles,
    systemKnowledgeText: sections.join('\n\n---\n\n')
  };
}
