import { videoPrompts } from './src/skills/videoPrompt.js';
const p = videoPrompts({ description: 'a creator at a desk reacting to a chart spiking', style: 'moody cinematic, teal and orange', camera: 'slow push in', motion: 'low', mood: 'tense', duration_s: 4, negative: ['text', 'logos'] });
console.log(JSON.stringify(p, null, 2));
