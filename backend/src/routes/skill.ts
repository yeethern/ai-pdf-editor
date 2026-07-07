import { Router, Request, Response } from 'express';
import { skillEngine } from '../services/skill/engine';
import fs from 'fs';
import path from 'path';

export const skillRouter = Router();

skillRouter.get('/', (_req: Request, res: Response) => {
  const skills = skillEngine.listSkills();
  res.json({ skills });
});

skillRouter.get('/:id', (req: Request, res: Response) => {
  const skill = skillEngine.getSkill(req.params.id);
  if (!skill) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }
  res.json({ skill });
});

skillRouter.post('/load', (req: Request, res: Response) => {
  try {
    const { content } = req.body;
    if (!content) {
      res.status(400).json({ error: 'Skill content is required' });
      return;
    }

    const skill = skillEngine.loadSkill(content);
    res.json({ success: true, skill });
  } catch (err) {
    console.error('Failed to load skill:', err);
    res.status(500).json({ error: 'Failed to load skill' });
  }
});

skillRouter.post('/transform', (req: Request, res: Response) => {
  try {
    const { text, skillId } = req.body;
    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    const result = skillEngine.applyRules(text, skillId);
    res.json(result);
  } catch (err) {
    console.error('Skill transform failed:', err);
    res.status(500).json({ error: 'Skill transformation failed' });
  }
});

skillRouter.post('/save', (req: Request, res: Response) => {
  try {
    const { content, filename } = req.body;
    if (!content) {
      res.status(400).json({ error: 'Content is required' });
      return;
    }

    const skillsDir = path.join(__dirname, '..', '..', '..', '..', 'skills');
    if (!fs.existsSync(skillsDir)) {
      fs.mkdirSync(skillsDir, { recursive: true });
    }

    const filePath = path.join(skillsDir, filename || 'product-code.md');
    fs.writeFileSync(filePath, content, 'utf-8');

    const skill = skillEngine.loadSkill(content);
    res.json({ success: true, skill, filePath });
  } catch (err) {
    console.error('Failed to save skill:', err);
    res.status(500).json({ error: 'Failed to save skill' });
  }
});
