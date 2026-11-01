import {defineConfig} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,testDir:'./test/visual',testMatch:'factory.visual.ts',workers:1,fullyParallel:false,reporter:'line'});
