import { Router, Request, Response } from 'express';
import { detectEntities, rewriteText, analyzeSelection } from '../services/ai/service';
import { skillEngine } from '../services/skill/engine';
import { AIRequest, TransformationResult } from '../types';

export const aiRouter = Router();

aiRouter.post('/detect', async (req: Request, res: Response) => {
  try {
    const { text } = req.body;

    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    const entities = await detectEntities(text);
    res.json({ entities });
  } catch (err) {
    console.error('Detection failed:', err);
    res.status(500).json({ error: 'Entity detection failed' });
  }
});

aiRouter.post('/transform', async (req: Request, res: Response) => {
  try {
    const { text, skillId, instruction } = req.body;

    if (!text) {
      res.status(400).json({ error: 'Text is required' });
      return;
    }

    let entities = await detectEntities(text);
    let skillResult = skillEngine.applyRules(text, skillId);

    if (entities.length > 0 || skillResult.entities.length > 0) {
      const mergedEntities = [
        ...skillResult.entities,
        ...entities.filter(
          e => !skillResult.entities.find(s => s.entity === e.entity)
        ),
      ];

      skillResult = {
        ...skillResult,
        entities: mergedEntities,
      };
    }

    const transformed = await rewriteText(text, skillResult, instruction);

    res.json({
      original: text,
      transformed,
      entities: skillResult.entities,
      appliedRules: skillResult.appliedRules,
    });
  } catch (err) {
    console.error('Transform failed:', err);
    res.status(500).json({ error: 'Transformation failed' });
  }
});

aiRouter.post('/analyze', async (req: Request, res: Response) => {
  try {
    const request = req.body as AIRequest;
    const result = await analyzeSelection(request);
    res.json(result);
  } catch (err) {
    console.error('Analysis failed:', err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});
