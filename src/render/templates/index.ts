import type { TemplateName } from '../template-options.js';
import { classic } from './classic.js';
import { elegant } from './elegant.js';
import { minimal } from './minimal.js';
import { modern } from './modern.js';
import type { Template } from './types.js';

export const TEMPLATES: Readonly<Record<TemplateName, Template>> = { classic, modern, minimal, elegant };
export type { Template, TemplateProps } from './types.js';
