import { SkillFile, SkillRule, EntityDetection, TransformationResult } from '../../types';

interface RuleEntity {
  matched: string;
  replacement: string;
  index: number;
}
import fs from 'fs';
import path from 'path';

export class SkillEngine {
  private skills: Map<string, SkillFile> = new Map();

  constructor() {
    this.loadDefaultSkill();
  }

  private loadDefaultSkill(): void {
    const skillPath = path.join(__dirname, '..', '..', '..', '..', 'skills', 'product-code.md');
    if (fs.existsSync(skillPath)) {
      const content = fs.readFileSync(skillPath, 'utf-8');
      const parsed = this.parseSkillFile(content);
      if (parsed) {
        this.skills.set(parsed.id, parsed);
      }
    }
  }

  private parseSkillFile(content: string): SkillFile | null {
    try {
      const lines = content.split('\n');
      const rules: SkillRule[] = [];
      let currentRule: Partial<SkillRule> = {};
      let inRules = false;
      let id = 'unknown-skill';
      let name = 'Unnamed Skill';
      let version = '1.0.0';
      let description = '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const isH1 = trimmed.startsWith('# ') && !trimmed.startsWith('## ');
        const isH2 = trimmed.startsWith('## ') && !trimmed.startsWith('### ');
        const isH3 = trimmed.startsWith('### ');

        if (isH1) continue;

        if (isH2) {
          if (currentRule.pattern) {
            rules.push(currentRule as SkillRule);
            currentRule = {};
          }
          const sectionName = trimmed.replace(/^##\s+/, '').toLowerCase();
          inRules = sectionName.includes('rules') || sectionName.includes('transformations');
          continue;
        }

        if (isH3) {
          if (currentRule.pattern) {
            rules.push(currentRule as SkillRule);
            currentRule = {};
          }
          continue;
        }

        if (trimmed.startsWith('- **ID**')) {
          if (!inRules) {
            const m = trimmed.match(/`([^`]+)`/);
            if (m) id = m[1];
          } else {
            if (currentRule.pattern) {
              rules.push(currentRule as SkillRule);
              currentRule = {};
            }
            currentRule.id = trimmed.match(/`([^`]+)`/)?.[1] || uuid();
          }
        } else if (trimmed.startsWith('- **Name**') && !inRules) {
          const m = trimmed.match(/`([^`]+)`/);
          if (m) name = m[1];
        } else if (trimmed.startsWith('- **Version**') && !inRules) {
          const m = trimmed.match(/`([^`]+)`/);
          if (m) version = m[1];
        } else if (trimmed.startsWith('- **Description**') && !inRules) {
          const m = trimmed.match(/`([^`]+)`/);
          if (m) description = m[1];
        } else if (inRules) {
          if (trimmed.startsWith('- **Pattern**')) {
            currentRule.pattern = trimmed.match(/`([^`]+)`/)?.[1] || '';
          } else if (trimmed.startsWith('- **Replacement**')) {
            currentRule.replacement = trimmed.match(/`([^`]+)`/)?.[1] || '';
          } else if (trimmed.startsWith('- **Digit Shift**')) {
            const m = trimmed.match(/\+(\s*\d+)/);
            if (m) currentRule.digitShift = parseInt(m[1]);
          } else if (trimmed.startsWith('- **Preserve Segments**')) {
            const m = trimmed.match(/\[([^\]]+)\]/);
            if (m) {
              currentRule.preserveSegments = m[1].split(',').map(s => parseInt(s.trim()));
            }
          } else if (trimmed.startsWith('- **Shift Groups**')) {
            const m = trimmed.match(/\[([^\]]+)\]/);
            if (m) {
              currentRule.shiftGroups = m[1].split(',').map(s => parseInt(s.trim()));
            }
          } else if (trimmed.startsWith('- **Exceptions**')) {
            const m = trimmed.match(/`([^`]+)`/);
            if (m) currentRule.exceptions = [m[1]];
          } else if (trimmed.startsWith('- **Priority**')) {
            const m = trimmed.match(/(\d+)/);
            if (m) currentRule.priority = parseInt(m[1]);
          } else if (trimmed.startsWith('- **Description**') && inRules) {
            currentRule.description = trimmed.replace(/^- \*\*Description\*\*:?\s*/, '');
          }
        }
      }

      if (currentRule.pattern) {
        rules.push(currentRule as SkillRule);
      }

      return {
        id,
        name,
        version,
        description,
        rules: rules.sort((a, b) => (b.priority || 0) - (a.priority || 0)),
      };
    } catch (err) {
      console.error('Failed to parse skill file:', err);
      return null;
    }
  }

  loadSkill(content: string): SkillFile {
    const parsed = this.parseSkillFile(content);
    if (!parsed) throw new Error('Failed to parse skill file');
    this.skills.set(parsed.id, parsed);
    return parsed;
  }

  getSkill(id: string): SkillFile | undefined {
    return this.skills.get(id);
  }

  listSkills(): SkillFile[] {
    return Array.from(this.skills.values());
  }

  private shiftDigits(value: string, shift: number): string {
    return value.split('').map(char => {
      const digit = parseInt(char);
      if (isNaN(digit)) return char;
      return ((digit + shift) % 10).toString();
    }).join('');
  }

  applyRules(text: string, skillId?: string): TransformationResult {
    const skill = skillId ? this.skills.get(skillId) : this.skills.values().next().value;
    if (!skill) {
      return { original: text, transformed: text, entities: [], appliedRules: [] };
    }

    const entities: EntityDetection[] = [];
    const appliedRules: string[] = [];
    let transformed = text;

    for (const rule of skill.rules) {
      try {
        const regex = new RegExp(rule.pattern, 'g');
        const replacements: Array<{ from: string; to: string }> = [];

        let match;
        while ((match = regex.exec(transformed)) !== null) {
          const matchedText = match[0];

          if (entities.some(e => e.entity === matchedText)) continue;

          const groups: (string | undefined)[] = match.slice(1);
          let replacement = rule.replacement;

          for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            if (g === undefined) {
              replacement = replacement.replace(new RegExp(`\\$${i + 1}`, 'g'), '');
              continue;
            }
            const shiftIdx = rule.shiftGroups?.indexOf(i);
            const shouldShift = shiftIdx !== undefined && shiftIdx !== -1;

            if (shouldShift && rule.digitShift) {
              const shifted = g.split('').map(ch => {
                const d = parseInt(ch);
                return isNaN(d) ? ch : ((d + rule.digitShift! + 10) % 10).toString();
              }).join('');
              replacement = replacement.replace(new RegExp(`\\$${i + 1}`, 'g'), shifted);
            } else {
              replacement = replacement.replace(new RegExp(`\\$${i + 1}`, 'g'), g);
            }
          }

          if (replacement !== matchedText) {
            replacements.push({ from: matchedText, to: replacement });
            entities.push({
              entity: matchedText,
              type: 'product_code',
              confidence: 0.95,
              startIndex: match.index,
              endIndex: match.index + matchedText.length,
              suggestedTransformation: replacement,
            });
            appliedRules.push(rule.id || rule.name);
          }
        }

        for (const r of replacements) {
          transformed = transformed.replace(r.from, r.to);
        }

      } catch (err) {
        console.warn(`Rule ${rule.id} failed:`, err);
      }
    }

    return {
      original: text,
      transformed,
      entities,
      appliedRules: [...new Set(appliedRules)],
    };
  }
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export const skillEngine = new SkillEngine();
