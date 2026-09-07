import { readFileSync } from 'node:fs';

const SKILL_FILES = [
  '../skills/caddyui-assistant/SKILL.md',
  '../skills/caddyui-assistant/references/caddyui-domain.md',
  '../skills/caddyui-assistant/references/proxy-workflows.md',
  '../skills/caddyui-assistant/references/operations-safety.md',
];

function loadSkillFile(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8').trim();
}

export const CADDYUI_ASSISTANT_SKILL_VERSION = 1;
export const CADDYUI_ASSISTANT_SKILL = [
  `<caddyui-assistant-skill version="${CADDYUI_ASSISTANT_SKILL_VERSION}">`,
  ...SKILL_FILES.map(loadSkillFile),
  '</caddyui-assistant-skill>',
].join('\n\n');

