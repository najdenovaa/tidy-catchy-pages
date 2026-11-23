/// <reference lib="webworker" />
import { runOptimizer, type ProgramInput, type OptimizerSettings } from '@/lib/cement-optimizer';
import type { OptimizerHardwareCatalog } from '@/lib/optimizer-hardware';
self.onmessage = async (event: MessageEvent<{input:ProgramInput;settings:OptimizerSettings;catalog:OptimizerHardwareCatalog}>) => {
  try {
    const { input, settings, catalog } = event.data;
    const result = await runOptimizer(input, settings, (done,total) => self.postMessage({type:'progress',done,total}), catalog, {timeBudgetMs:90000,onConfirmed:result=>self.postMessage({type:'confirmed',result})});
    self.postMessage({type:'result',result});
  } catch (error) {
    self.postMessage({type:'error',message:error instanceof Error?error.message:String(error)});
  }
};
